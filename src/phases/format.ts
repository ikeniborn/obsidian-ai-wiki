import type OpenAI from "openai";
import type {
  ChatMessage,
  CompressionProfile,
  LlmCallOptions,
  LlmClient,
  RunEvent,
} from "../types";
import type { FormatProgress } from "../i18n";
import type { VaultTools } from "../vault-tools";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  completionReasoning,
  extractStreamDeltas,
  extractUsage,
  shouldFallbackStreamToNonStream,
  wrapStreamWithStats,
} from "./llm-utils";
import { classifyContextError, createPromptBudgetEvent, estimatePreparedMessages, PromptBudgetExceededError } from "../prompt-budget";
import { createLlmLifecycle } from "./structured-output";
import { lifecycleEvent } from "../llm-lifecycle";
import formatTemplate from "../../prompts/format.md";
import formatSegmentTemplate from "../../prompts/format-segment.md";
import { promptVersionOf, visionPromptVersionOf } from "../prompt-version";
import restoreTokensTemplate from "../../prompts/format-restore-tokens.md";
import formatSchemaDefault from "../../templates/_format_schema.md";
import { render } from "./template";
import { missingTokensWithContext, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds, stripSentinelMarkers } from "./format-utils";
import { fixWikiLinks } from "../wiki-link-validator";
import { restoreSourceFrontmatter } from "../utils/raw-frontmatter";
import { FormatOutputSchema, FormatSegmentOutputSchema, FormatWithVisionSchema } from "./zod-schemas";
import { parseFormatFrames } from "./framed-output";
import { structuralErrorCounter } from "../structural-error-counter";
import { extractObsidianEmbedPaths, analyzeSingleAttachment } from "./attachment-analyzer";
import type { VisionTempStore } from "./vision-temp-store";
import type { DomainEntry } from "../domain";
import { collectDomainTags, renderTagRegistryBlock, DEFAULT_MAX_TAG_CATEGORIES } from "../utils/tag-registry";
import { domainWikiFolder } from "../wiki-path";
import { reassembleFormatSegments, segmentFormatInput, splitFormatSegment, type FormatSegment } from "./format-segments";

function parseFormatOutput(
  text: string,
  hasVisionDescriptions: boolean,
): { data: import("./zod-schemas").FormatOutput | null; hint: string; truncated: boolean } {
  let parsedFrames: ReturnType<typeof parseFormatFrames>;
  try {
    parsedFrames = parseFormatFrames(text, hasVisionDescriptions);
  } catch (e) {
    structuralErrorCounter.record(false, 0);
    return { data: null, hint: (e as Error).message || "sentinel markers not found", truncated: false };
  }

  const schema = hasVisionDescriptions ? FormatWithVisionSchema : FormatOutputSchema;
  const result = schema.safeParse(parsedFrames.raw);
  if (result.success) {
    structuralErrorCounter.record(true, 0);
    return { data: result.data, hint: "", truncated: parsedFrames.truncated };
  }
  structuralErrorCounter.record(false, 0);
  const hint = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { data: null, hint, truncated: parsedFrames.truncated };
}

function parseFormatSegmentOutput(
  text: string,
): { data: import("./zod-schemas").FormatSegmentModelOutput | null; hint: string; truncated: boolean } {
  const endIdx = text.indexOf("<<<END>>>");
  const segmentIdIdx = text.indexOf("<<<SEGMENT_ID>>>");
  const reportIdx = text.indexOf("<<<REPORT>>>");
  const formattedIdx = text.indexOf("<<<FORMATTED>>>");
  if (segmentIdIdx === -1 || reportIdx === -1 || formattedIdx === -1) {
    return { data: null, hint: "segment sentinel markers not found", truncated: endIdx === -1 };
  }
  const formattedEnd = endIdx === -1 ? text.length : endIdx;
  const raw = {
    segmentId: cleanFrameScalar(text.slice(segmentIdIdx + "<<<SEGMENT_ID>>>".length, reportIdx)),
    report: cleanFrameScalar(text.slice(reportIdx + "<<<REPORT>>>".length, formattedIdx)),
    formatted: cleanFrameContent(text.slice(formattedIdx + "<<<FORMATTED>>>".length, formattedEnd)),
  };
  const result = FormatSegmentOutputSchema.safeParse(raw);
  if (result.success) return { data: result.data, hint: "", truncated: endIdx === -1 };
  return {
    data: null,
    hint: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    truncated: endIdx === -1,
  };
}

function cleanFrameScalar(text: string): string {
  return text.trim();
}

function cleanFrameContent(text: string): string {
  let out = text;
  if (out.startsWith("\n")) out = out.slice(1);
  if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

function extractImagePaths(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1].trim();
    if (!url.startsWith("http")) out.push(url);
  }
  return out;
}

function rawFrontmatter(text: string): string | null {
  return /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] ?? null;
}

function restoreRawSourceFrontmatter(original: string, formatted: string): string {
  const raw = rawFrontmatter(original);
  if (!raw) return formatted;
  const body = formatted.slice(rawFrontmatter(formatted)?.length ?? 0);
  return `${raw}${body}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreSegmentedBasenameEmbeds(original: string, formatted: string): string {
  let result = formatted;
  for (const match of original.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const embedSrc = match[0];
    if (result.includes(embedSrc)) continue;
    const innerPath = match[1];
    const pipeIdx = innerPath.indexOf("|");
    const filePath = pipeIdx >= 0 ? innerPath.slice(0, pipeIdx) : innerPath;
    const baseName = filePath.split("/").pop() ?? filePath;
    if (!baseName || baseName === filePath) continue;
    result = result.replace(new RegExp(`!\\[\\[${escapeRegExp(baseName)}(?:\\|[^\\]]+)?\\]\\]`, "g"), embedSrc);
  }
  return result;
}

function truncationHint(backend: "claude-agent" | "native-agent", p: FormatProgress): string {
  return backend === "claude-agent" ? p.truncationHintEnv : p.truncationHintSettings;
}

// English fallback so runFormat is usable without an explicit bundle.
// Mirrors `en.formatProgress` in i18n.ts — keep the two in sync (format.ts must not
// import the runtime i18n bundle, only the FormatProgress type, to keep phases/ obsidian-free).
const enFormatProgressFallback: FormatProgress = {
  analysing: (path: string) => `Analysing file ${path}...\n`,
  truncatedSalvageSummary: "Format: response truncated — salvage",
  truncatedSalvageRetrySummary: "Format: retry response truncated — salvage",
  truncatedSalvageDetail: "Marker <<<END>>> missing; partial output used.",
  outputTruncated: (hint: string) =>
    `Format: response truncated by the model output limit — shorten the page or ${hint}`,
  outputTruncatedAfterRetry: (hint: string) =>
    `Format: response truncated by the model output limit (after retry) — shorten the page or ${hint}`,
  sentinelInvalidRetry: "\n[Sentinel invalid — retrying]\n",
  sentinelInvalidAfterRetry: "Format: LLM returned an invalid sentinel (after retry)",
  writeFailed: (err: string) => `Format: writing the formatted file failed — ${err}`,
  truncationHintEnv: "raise the limit: env CLAUDE_CODE_MAX_OUTPUT_TOKENS in iclaude.sh",
  truncationHintSettings: "raise the limit: Settings → per-operation → format → maxTokens",
};

export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
  wikiVaultPath?: string,
  wikiLinkValidationRetries: number = 3,
  visionSettings: {
    enabled: boolean;
    model: string;
    language?: "auto" | "ru" | "en" | "es";
    imageOnly?: boolean;
    compressionProfile?: CompressionProfile;
  } = { enabled: false, model: "" },
  visionTempStore?: VisionTempStore,
  progress: FormatProgress = enFormatProgressFallback,
  formatDomain?: DomainEntry,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const filePath = args[0];

  if (!filePath) {
    yield { kind: "error", message: "Format: file path is required" };
    return;
  }
  if (signal.aborted) return;

  yield { kind: "tool_use", name: "Read", input: { file_path: filePath } };
  let original: string;
  try {
    original = await vaultTools.read(filePath);
  } catch {
    yield { kind: "tool_result", ok: false, preview: "cannot read file" };
    yield { kind: "error", message: `Format: cannot read ${filePath}` };
    return;
  }
  if (!original) {
    yield { kind: "tool_result", ok: false, preview: "empty file" };
    yield { kind: "error", message: `Format: cannot read ${filePath}` };
    return;
  }

  const formatSchema = formatSchemaDefault;
  yield { kind: "tool_result", ok: true, preview: `${original.length} chars` };

  const visionDescriptions = new Map<string, string>();
  const usedVisionTemplates = new Set<string>();
  if (visionSettings.enabled && visionSettings.model) {
    const embedPaths = [...new Set(extractObsidianEmbedPaths(original))];
    if (embedPaths.length > 0) {
      const lang = visionSettings.language ?? "auto";
      for (const path of embedPaths) {
        if (signal.aborted) break;
        const filename = path.split("/").pop() ?? path;
        yield { kind: "tool_use", name: "Vision", input: { file_path: filename, model: visionSettings.model } };
        const cached = await visionTempStore?.getDescription(path);
        if (cached != null) {
          visionDescriptions.set(path, cached);
          yield { kind: "tool_result", ok: true, preview: cached };
          continue;
        }
        const visionEvents: RunEvent[] = [];
        let visionEventsEmitted = false;
        try {
          const description = await analyzeSingleAttachment(
            path,
            vaultTools,
            llm,
            visionSettings.model,
            signal,
            filePath,
            lang,
            opts.reasoningLanguage,
            visionTempStore,
            visionSettings.imageOnly ?? false,
            usedVisionTemplates,
            {
              inputBudgetTokens: opts.inputBudgetTokens,
              maxTokens: opts.maxTokens,
              compressionProfile:
                visionSettings.compressionProfile
                ?? opts.semanticCompression?.profile
                ?? "balanced",
              onEvent: (event) => visionEvents.push(event),
            },
          );
          for (const event of visionEvents) yield event;
          visionEventsEmitted = true;
          if (description !== null) {
            visionDescriptions.set(path, description);
            await visionTempStore?.putDescription(path, description);
            yield { kind: "tool_result", ok: true, preview: description };
          } else {
            const why = (visionSettings.imageOnly ?? false) ? "unsupported on mobile" : "unknown extension";
            yield { kind: "tool_result", ok: false, preview: why };
            yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [`${path} — ${why}`] };
          }
        } catch (e) {
          if (!visionEventsEmitted) {
            for (const event of visionEvents) yield event;
          }
          yield { kind: "tool_result", ok: false, preview: (e as Error)?.message ?? "failed" };
          yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
        }
      }
    }
  }

  const visionDescBlock = visionDescriptions.size > 0
    ? [
        "If there are attachment descriptions, add extra markers after <<<FORMATTED>>>:",
        "<<<VISION_COUNT>>>",
        "<number of descriptions, an integer>",
        "<<<EMBEDS>>>",
        "<paths separated by |: img/a.png|img/b.png>",
        "Place these markers AFTER formatted and BEFORE <<<END>>>.",
      ].join("\n")
    : "";

  const systemContent = render(formatTemplate, {
    format_schema: formatSchema,
    has_vision: String(hasVision),
    has_vision_descriptions: String(visionDescriptions.size > 0),
    has_vision_descriptions_block: visionDescBlock,
  });

  let visionBlock = "";
  if (visionDescriptions.size > 0) {
    const items: string[] = [];
    for (const [path, desc] of visionDescriptions) {
      items.push(`### ![[${path}]]\n${desc}`);
    }
    visionBlock = `\n---\nATTACHMENT DESCRIPTIONS (vision recognition; integrate IMMEDIATELY BELOW the corresponding \`![[path]]\` embed as structured markdown — table/list/code following the source's form; for DIAGRAMS keep both elements: first the text description, then a \`\`\`mermaid\`\`\` block — do not drop either the description or the mermaid; do NOT wrap in a blockquote, do NOT add a [Vision] marker, do NOT quote the paths):\n${items.join("\n\n")}`;
  }

  let tagRegistryBlock = "";
  if (formatDomain) {
    try {
      const registry = await collectDomainTags(
        vaultTools,
        domainWikiFolder(formatDomain.wiki_folder),
        formatDomain.source_paths ?? [],
      );
      tagRegistryBlock = renderTagRegistryBlock(
        registry,
        (formatDomain.entity_types ?? []).map((e) => e.type),
        formatDomain.max_tag_categories ?? DEFAULT_MAX_TAG_CATEGORIES,
      );
    } catch {
      /* no registry — format degrades to current behavior */
    }
  }

  const userInitial = `Source file: ${filePath}\n---\n${original}${visionBlock}${tagRegistryBlock ? `\n---\n${tagRegistryBlock}` : ""}`;

  const directImagePaths = extractImagePaths(original);
  const imagePaths = hasVision ? directImagePaths : [];

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] | string =
    imagePaths.length > 0
      ? [
          { type: "text", text: userInitial },
          ...imagePaths.map<OpenAI.Chat.ChatCompletionContentPart>((p) => ({
            type: "image_url",
            image_url: { url: p },
          })),
        ]
      : userInitial;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
  ];
  const formatOpts: LlmCallOptions = {
    ...opts,
    jsonMode: false,
    jsonSchema: undefined,
    semanticCompression: undefined,
  };

  yield { kind: "assistant_text", delta: progress.analysing(filePath) };

  let lastFinishReason: string | null = null;
  let outputTokens = 0;
  let lastInputTokens: number | undefined;
  let activeFormatLifecycle: ReturnType<typeof createLlmLifecycle> | null = null;
  const closeActiveFormatLifecycle = (
    phase: "retrying" | "failed" | "cancelled",
  ): RunEvent | null => {
    const current = activeFormatLifecycle;
    if (!current) return null;
    activeFormatLifecycle = null;
    return lifecycleEvent(current.id, current.action, phase);
  };

  async function* callOnce(
    p: Record<string, unknown>,
    fallback: { allowContextFallback: boolean } = { allowContextFallback: true },
  ): AsyncGenerator<RunEvent, string> {
    if (activeFormatLifecycle) {
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "applying");
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "completed");
    }
    activeFormatLifecycle = createLlmLifecycle("format_note");
    yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "preparing");
    let acc = "";
    lastFinishReason = null;
    lastInputTokens = undefined;
    const requestStartMs = Date.now();
    let streamChunkConsumed = false;
    try {
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "sent");
      const request = llm.chat.completions.create(
        { ...p, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "waiting");
      const rawStream = await request;
      const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, signal);
      let producing = false;
      for await (const chunk of stream) {
        streamChunkConsumed = true;
        const { reasoning, content, outputTokens: tok, inputTokens: inTok } = extractStreamDeltas(chunk);
        if (!producing && (reasoning.trim() || content.trim())) {
          yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "producing");
          producing = true;
        }
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { acc += content; yield { kind: "assistant_text", delta: content }; }
        if (tok !== undefined) outputTokens += tok;
        if (inTok !== undefined) lastInputTokens = inTok;
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      }
      const callStats = getStats();
      if (callStats) yield buildLlmCallStatsEvent(callStats);
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "cancelled");
        activeFormatLifecycle = null;
        return acc;
      }
      if (streamChunkConsumed) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "failed");
        activeFormatLifecycle = null;
        throw e;
      }
      if (!fallback.allowContextFallback && classifyContextError(e) !== null) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "retrying");
        activeFormatLifecycle = null;
        throw e;
      }
      if (!shouldFallbackStreamToNonStream(e, signal)) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "failed");
        activeFormatLifecycle = null;
        throw e;
      }
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "retrying");
      activeFormatLifecycle = createLlmLifecycle("format_note");
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "preparing");
      const fallbackStartMs = Date.now();
      let resp: OpenAI.Chat.ChatCompletion;
      try {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "sent");
        const pending = llm.chat.completions.create(
          { ...p, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
          { signal },
        );
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "waiting");
        resp = await pending;
      } catch (fallbackError) {
        yield lifecycleEvent(
          activeFormatLifecycle.id,
          activeFormatLifecycle.action,
          signal.aborted || (fallbackError as Error).name === "AbortError"
            ? "cancelled"
            : classifyContextError(fallbackError) !== null
              ? "retrying"
              : "failed",
        );
        activeFormatLifecycle = null;
        throw fallbackError;
      }
      const fallbackMessage = resp.choices[0]?.message;
      const fallbackReasoning = completionReasoning(fallbackMessage);
      acc = fallbackMessage?.content ?? "";
      if (fallbackReasoning.trim() || acc.trim()) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "producing");
      }
      if (fallbackReasoning) {
        yield { kind: "assistant_text", delta: fallbackReasoning, isReasoning: true };
      }
      const completionTokens = extractUsage(resp);
      const promptTokens = resp.usage?.prompt_tokens;
      if (completionTokens !== undefined) outputTokens += completionTokens;
      if (promptTokens !== undefined) lastInputTokens = promptTokens;
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
      if (completionTokens !== undefined) {
        const elapsed = Math.max(1, Date.now() - fallbackStartMs);
        yield buildLlmCallStatsEvent({
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          ttftMs: fallbackStartMs - requestStartMs,
          llmDurationMs: elapsed,
        });
      }
    }
    if (activeFormatLifecycle) {
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "validating");
    }
    return acc;
  }

  function segmentMessagesWithHint(segment: FormatSegment, retryHint = ""): OpenAI.Chat.ChatCompletionMessageParam[] {
    const segmentVisionBlock = segment.visionDescriptions.size > 0
      ? [
          "",
          "---",
          "ATTACHMENT DESCRIPTIONS FOR THIS SEGMENT ONLY:",
          ...[...segment.visionDescriptions].map(([path, desc]) => `### ![[${path}]]\n${desc}`),
        ].join("\n")
      : "";
    const headingPath = segment.headingPath.length > 0 ? segment.headingPath.join(" > ") : "(preamble)";
    const segmentUser = [
      `Source file: ${filePath}`,
      `Segment ID: ${segment.id}`,
      `Segment ordinal: ${segment.ordinal + 1}`,
      `Source lines: ${segment.startLine}-${segment.endLine}`,
      `Heading path: ${headingPath}`,
      "Format only the bounded source segment below.",
      "<<<SOURCE_SEGMENT>>>",
      `${segment.markdown}`,
      "<<<END_SOURCE_SEGMENT>>>",
      segmentVisionBlock,
      tagRegistryBlock ? `---\n${tagRegistryBlock}` : "",
    ].filter((part) => part.length > 0).join("\n");
    const system = retryHint
      ? `${render(formatSegmentTemplate, { format_schema: formatSchema })}\n\nThe previous segment attempt failed: ${retryHint}. Return the same segment again using the exact segment id and markers.`
      : render(formatSegmentTemplate, { format_schema: formatSchema });
    return [
      { role: "system", content: system },
      { role: "user", content: segmentUser },
      ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
    ];
  }

  function emitSegmentBudgetEvent(
    segment: FormatSegment,
    params: Record<string, unknown>,
    sourceChunks: number,
    retryReason?: "preflight_budget_exceeded" | "provider_context_error",
  ): RunEvent {
    return createPromptBudgetEvent({
      callSite: "format.segment",
      configuredInputBudget: opts.inputBudgetTokens ?? 0,
      effectiveInputBudget: opts.inputBudgetTokens ?? 0,
      estimatedInputTokens: estimatePreparedMessages(params.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
      actualInputTokens: retryReason ? undefined : lastInputTokens,
      outputBudget: opts.maxTokens,
      compressionProfile: "balanced",
      contextUnits: 1,
      sourceChunks,
      reductionDepth: Math.max(0, segment.id.split("-").length - 2),
      retryReason,
    });
  }

  function buildSegmentParams(
    segment: FormatSegment,
    retryHint = "",
  ): Record<string, unknown> {
    const params = buildChatParams(model, segmentMessagesWithHint(segment, retryHint), formatOpts, true);
    return params;
  }

  async function* splitSegmentAfterProviderContext(
    segment: FormatSegment,
    params: Record<string, unknown>,
    maxMarkdownChars: number,
    sourceChunks: number,
  ): AsyncGenerator<RunEvent, import("./zod-schemas").FormatSegmentModelOutput> {
    yield createPromptBudgetEvent({
      callSite: "format.segment",
      configuredInputBudget: opts.inputBudgetTokens ?? 0,
      effectiveInputBudget: opts.inputBudgetTokens ?? 0,
      estimatedInputTokens: estimatePreparedMessages(params.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
      outputBudget: opts.maxTokens,
      compressionProfile: "balanced",
      contextUnits: 1,
      sourceChunks,
      reductionDepth: Math.max(0, segment.id.split("-").length - 2),
      retryReason: "provider_context_error",
    });
    const nextMaxMarkdownChars = Math.max(1, Math.floor(maxMarkdownChars / 2));
    const children = splitFormatSegment(segment, nextMaxMarkdownChars);
    if (children.length <= 1) {
      throw new Error(`Format: segment ${segment.id} hit provider context limit and cannot be split further`);
    }
    const childOutputs = [];
    for (const child of children) childOutputs.push(yield* formatSegmentRecursive(child, nextMaxMarkdownChars, sourceChunks));
    return {
      segmentId: segment.id,
      report: childOutputs.map((output) => output.report).join("\n"),
      formatted: childOutputs.map((output) => output.formatted).join(""),
    };
  }

  async function* formatSegmentRecursive(
    segment: FormatSegment,
    maxMarkdownChars: number,
    sourceChunks: number,
  ): AsyncGenerator<RunEvent, import("./zod-schemas").FormatSegmentModelOutput> {
    let params: Record<string, unknown>;
    try {
      params = buildSegmentParams(segment);
    } catch (e) {
      if (!(e instanceof PromptBudgetExceededError)) throw e;
      yield createPromptBudgetEvent({
        callSite: "format.segment",
        configuredInputBudget: opts.inputBudgetTokens ?? 0,
        effectiveInputBudget: opts.inputBudgetTokens ?? 0,
        estimatedInputTokens: e.estimated,
        outputBudget: opts.maxTokens,
        compressionProfile: "balanced",
        contextUnits: 1,
        sourceChunks,
        reductionDepth: Math.max(0, segment.id.split("-").length - 2),
        retryReason: "preflight_budget_exceeded",
      });
      const children = splitFormatSegment(segment, Math.max(1, Math.floor(maxMarkdownChars / 2)));
      if (children.length <= 1) {
        throw new Error(`Format: segment ${segment.id} exceeds the configured input budget; raise format inputBudgetTokens`);
      }
      const childOutputs = [];
      for (const child of children) childOutputs.push(yield* formatSegmentRecursive(child, Math.max(1, Math.floor(maxMarkdownChars / 2)), sourceChunks));
      return {
        segmentId: segment.id,
        report: childOutputs.map((output) => output.report).join("\n"),
        formatted: childOutputs.map((output) => output.formatted).join(""),
      };
    }

    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath, segment: segment.id } };
    let text: string;
    try {
      text = yield* callOnce(params, { allowContextFallback: false });
    } catch (e) {
      if (classifyContextError(e) === null) throw e;
      return yield* splitSegmentAfterProviderContext(segment, params, maxMarkdownChars, sourceChunks);
    }
    yield emitSegmentBudgetEvent(segment, params, sourceChunks);
    if (signal.aborted) {
      if (activeFormatLifecycle) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "cancelled");
        activeFormatLifecycle = null;
      }
      return { segmentId: segment.id, report: "aborted", formatted: segment.markdown };
    }
    const parsedSegment = parseFormatSegmentOutput(text);
    if (parsedSegment.data && parsedSegment.data.segmentId === segment.id && !parsedSegment.truncated) {
      yield { kind: "tool_result", ok: true, preview: `${segment.id}: ${parsedSegment.data.formatted.length} chars` };
      return parsedSegment.data;
    }

    const shouldSplit = parsedSegment.truncated || lastFinishReason === "length";
    if (shouldSplit) {
      const children = splitFormatSegment(segment, Math.max(1, Math.floor(maxMarkdownChars / 2)));
      if (children.length > 1) {
        if (activeFormatLifecycle) {
          yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "retrying");
          activeFormatLifecycle = null;
        }
        yield { kind: "tool_result", ok: false, preview: `${segment.id}: response truncated — splitting` };
        const childOutputs = [];
        for (const child of children) childOutputs.push(yield* formatSegmentRecursive(child, Math.max(1, Math.floor(maxMarkdownChars / 2)), sourceChunks));
        return {
          segmentId: segment.id,
          report: childOutputs.map((output) => output.report).join("\n"),
          formatted: childOutputs.map((output) => output.formatted).join(""),
        };
      }
      if (activeFormatLifecycle) {
        yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "failed");
        activeFormatLifecycle = null;
      }
      throw new Error(`Format: segment ${segment.id} response was truncated and cannot be split further`);
    }

    const hint = parsedSegment.data && parsedSegment.data.segmentId !== segment.id
      ? `segment id mismatch: expected ${segment.id}, got ${parsedSegment.data.segmentId}`
      : parsedSegment.hint;

    const retryParams = buildSegmentParams(segment, hint);
    if (activeFormatLifecycle) {
      yield lifecycleEvent(activeFormatLifecycle.id, activeFormatLifecycle.action, "retrying");
      activeFormatLifecycle = null;
    }
    yield { kind: "tool_result", ok: false, preview: `${segment.id}: invalid sentinel — retrying` };
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath, segment: segment.id, retry: 1 } };
    let retryText: string;
    try {
      retryText = yield* callOnce(retryParams, { allowContextFallback: false });
    } catch (e) {
      if (classifyContextError(e) === null) throw e;
      return yield* splitSegmentAfterProviderContext(segment, retryParams, maxMarkdownChars, sourceChunks);
    }
    yield emitSegmentBudgetEvent(segment, retryParams, sourceChunks);
    const retryParsed = parseFormatSegmentOutput(retryText);
    if (retryParsed.data && retryParsed.data.segmentId === segment.id && !retryParsed.truncated) {
      yield { kind: "tool_result", ok: true, preview: `${segment.id}: ${retryParsed.data.formatted.length} chars` };
      return retryParsed.data;
    }
    const retryHint = retryParsed.data && retryParsed.data.segmentId !== segment.id
      ? `segment id mismatch: expected ${segment.id}, got ${retryParsed.data.segmentId}`
      : retryParsed.hint;
    const failedEvent = closeActiveFormatLifecycle("failed");
    if (failedEvent) yield failedEvent;
    throw new Error(`Format: segment ${segment.id} failed: ${retryHint || hint}`);
  }

  let fullText = "";
  let parsed: import("./zod-schemas").FormatOutput | null = null;
  let segmented = false;

  async function* runSegmentedFormatting(): AsyncGenerator<RunEvent, import("./zod-schemas").FormatOutput | null> {
    try {
      const initialMaxMarkdownChars = Math.max(120, Math.floor((opts.inputBudgetTokens ?? original.length) / 4));
      let segments = segmentFormatInput(original, visionDescriptions, initialMaxMarkdownChars);
      if (segments.length === 1 && segments[0].markdown === original) {
        segments = segmentFormatInput(original, visionDescriptions, Math.max(1, Math.floor(original.length / 2)));
      }
      const outputs = [];
      for (const segment of segments) outputs.push(yield* formatSegmentRecursive(segment, initialMaxMarkdownChars, segments.length));
      return reassembleFormatSegments(original, segments, outputs);
    } catch (e) {
      const msg = (e as Error).message || "Format: segmented formatting failed";
      yield { kind: "tool_result", ok: false, preview: msg };
      yield { kind: "error", message: msg };
      yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
      return null;
    }
  }

  let baseParams: Record<string, unknown> | null = null;
  try {
    baseParams = buildChatParams(model, messages, formatOpts, true);
  } catch (e) {
    if (!(e instanceof PromptBudgetExceededError)) throw e;
    if (directImagePaths.length > 0) {
      const msg = "Format: note exceeds the format input budget and contains direct Markdown image attachments; segmentation is disabled for this vision path";
      yield { kind: "tool_result", ok: false, preview: msg };
      yield { kind: "error", message: msg };
      yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
      return;
    }
    segmented = true;
  }

  if (baseParams) {
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
    try {
      fullText = yield* callOnce(baseParams, { allowContextFallback: false });
    } catch (e) {
      if (classifyContextError(e) === null) throw e;
      if (directImagePaths.length > 0) {
        const msg = "Format: note hit the provider context limit and contains direct Markdown image attachments; segmentation is disabled for this vision path";
        yield { kind: "tool_result", ok: false, preview: msg };
        yield { kind: "error", message: msg };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }
      yield createPromptBudgetEvent({
        callSite: "format.output",
        configuredInputBudget: opts.inputBudgetTokens ?? 0,
        effectiveInputBudget: opts.inputBudgetTokens ?? 0,
        estimatedInputTokens: estimatePreparedMessages(baseParams.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
        outputBudget: opts.maxTokens,
        compressionProfile: "balanced",
        contextUnits: 1,
        retryReason: "provider_context_error",
      });
      segmented = true;
      parsed = yield* runSegmentedFormatting();
      if (!parsed) return;
    }
    if (signal.aborted) {
      const cancelledEvent = closeActiveFormatLifecycle("cancelled");
      if (cancelledEvent) yield cancelledEvent;
      return;
    }

    if (!segmented) {
      let parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
      parsed = parsedResult.data;

      if (parsedResult.truncated) {
        yield {
          kind: "info_text", icon: "⚠️",
          summary: progress.truncatedSalvageSummary,
          details: [progress.truncatedSalvageDetail],
        };
        yield { kind: "rule_fired", ruleId: "formatSalvage", count: 1 };
      }

      const truncated = !parsed && lastFinishReason === "length";
      if (!parsed && truncated) {
        const failedEvent = closeActiveFormatLifecycle("failed");
        if (failedEvent) yield failedEvent;
        yield { kind: "tool_result", ok: false, preview: "response truncated" };
        yield { kind: "error", message: progress.outputTruncated(truncationHint(backend, progress)) };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }

      if (!parsed) {
        const retryEvent = closeActiveFormatLifecycle("retrying");
        if (retryEvent) yield retryEvent;
        yield { kind: "tool_result", ok: false, preview: "invalid sentinel — retrying" };
        yield { kind: "assistant_text", delta: progress.sentinelInvalidRetry };
        const zodHint = parsedResult.hint;
        const retrySystemContent = systemContent + `\n\nThe previous attempt failed: ${zodHint}. Fix it and return again using the markers <<<REPORT>>>...<<<END>>>.`;
        const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: retrySystemContent },
          { role: "user", content: userContent },
        ];
        const retryParams = buildChatParams(model, retryMessages, formatOpts, true);
        yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
        fullText = yield* callOnce(retryParams);
        if (signal.aborted) {
          const cancelledEvent = closeActiveFormatLifecycle("cancelled");
          if (cancelledEvent) yield cancelledEvent;
          return;
        }
        parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
        parsed = parsedResult.data;
        if (parsedResult.truncated) {
          yield {
            kind: "info_text", icon: "⚠️",
            summary: progress.truncatedSalvageRetrySummary,
            details: [progress.truncatedSalvageDetail],
          };
          yield { kind: "rule_fired", ruleId: "formatSalvage", count: 1 };
        }
      }

      if (!parsed) {
        const retryTruncated = lastFinishReason === "length";
        const msg = retryTruncated
          ? progress.outputTruncatedAfterRetry(truncationHint(backend, progress))
          : progress.sentinelInvalidAfterRetry;
        const failedEvent = closeActiveFormatLifecycle("failed");
        if (failedEvent) yield failedEvent;
        yield { kind: "tool_result", ok: false, preview: msg };
        yield { kind: "error", message: msg };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }
    }
  } else if (segmented) {
    parsed = yield* runSegmentedFormatting();
    if (!parsed) return;
  }

  if (!parsed) return;
  yield { kind: "tool_result", ok: true, preview: `${parsed.formatted.length} chars` };

  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
  const baseName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).replace(/\.md$/, "") || "page";
  const tempPath = dir ? `${dir}/${baseName}.formatted.md` : `${baseName}.formatted.md`;

  // Token-retry: if first response lost tokens — one multi-turn correction call.
  let finalFormatted = parsed.formatted;
  let finalReport = parsed.report;
  const missing1 = missingTokensWithContext(original, parsed.formatted);

  if (missing1.length > 0 && segmented) {
    finalFormatted = appendMissingLines(finalFormatted, missing1);
  } else if (missing1.length > 0 && !signal.aborted) {
    const tokenList = missing1.map((m) => `\`${m.token}\``).join(", ");
    const restoreMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: fullText },
      {
        role: "user",
        content: render(restoreTokensTemplate, { tokens: tokenList }),
      },
    ];
    let restoreParams: Record<string, unknown>;
    try {
      signal.throwIfAborted();
      restoreParams = buildChatParams(model, restoreMessages, formatOpts, true);
    } catch (e) {
      const aborted = signal.aborted || (e as Error).name === "AbortError";
      const terminal = closeActiveFormatLifecycle(aborted ? "cancelled" : "failed");
      if (terminal) yield terminal;
      if (!aborted) {
        const message = `Format: token restoration request failed — ${(e as Error).message}`;
        yield { kind: "error", message };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
      }
      return;
    }
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
    const fullText2 = yield* callOnce(restoreParams);
    if (signal.aborted) return;
    const parsed2Result = parseFormatOutput(fullText2, visionDescriptions.size > 0);
    const parsed2 = parsed2Result.data;
    if (parsed2) {
      finalFormatted = parsed2.formatted;
      finalReport = parsed2.report;
    }
    yield { kind: "tool_result", ok: true, preview: "tokens restored" };
    const missing2 = missingTokensWithContext(original, finalFormatted);
    if (missing2.length > 0) {
      finalFormatted = appendMissingLines(finalFormatted, missing2);
    }
  }

  finalFormatted = restoreObsidianEmbeds(original, finalFormatted);

  const wlFix = fixWikiLinks(new Map([[filePath, finalFormatted]]), wikiLinkValidationRetries);
  finalFormatted = wlFix.fixed.get(filePath) ?? finalFormatted;
  if (segmented) finalFormatted = restoreSegmentedBasenameEmbeds(original, restoreObsidianEmbeds(original, finalFormatted));
  const embedWarnings = missingObsidianEmbeds(original, finalFormatted);

  finalFormatted = segmented
    ? restoreRawSourceFrontmatter(original, finalFormatted)
    : restoreSourceFrontmatter(original, finalFormatted);

  // Final defensive sweep: no sentinel marker may reach the written note.
  const swept = stripSentinelMarkers(finalFormatted);
  finalFormatted = swept.clean;
  if (swept.removed.length > 0) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: "Sentinel markers stripped",
      details: swept.removed,
    };
    yield { kind: "rule_fired", ruleId: "stripSentinelMarkers", count: swept.removed.length };
  }

  try {
    await vaultTools.write(tempPath, finalFormatted);
  } catch (e) {
    const failedEvent = closeActiveFormatLifecycle("failed");
    if (failedEvent) yield failedEvent;
    yield { kind: "error", message: progress.writeFailed((e as Error).message) };
    return;
  }

  if (embedWarnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "Embed warnings", details: embedWarnings.map(e => `Not restored: ${e}`) };
  }
  if (wlFix.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFix.warnings };
  }

  const missingFinal = missingTokensWithContext(original, finalFormatted);
  const previewLifecycle = activeFormatLifecycle as ReturnType<typeof createLlmLifecycle> | null;
  if (previewLifecycle) {
    yield lifecycleEvent(previewLifecycle.id, previewLifecycle.action, "applying");
  }
  yield { kind: "format_preview", tempPath, report: finalReport, missingTokens: missingFinal, visionCount: visionDescriptions.size };
  if (previewLifecycle) {
    yield lifecycleEvent(previewLifecycle.id, previewLifecycle.action, "completed");
    activeFormatLifecycle = null;
  }
  const visionOn = visionDescriptions.size > 0;
  yield {
    kind: "eval_meta",
    fields: {
      source_path: filePath,
      vision: visionOn ? "on" : "off",
      visionCount: visionDescriptions.size,
      visionModel: visionOn ? (visionSettings.model || undefined) : undefined,
      promptVersion: promptVersionOf(formatTemplate),
      visionPromptVersion: visionOn ? visionPromptVersionOf([...usedVisionTemplates]) : undefined,
    },
  };
  yield { kind: "result", durationMs: Date.now() - start, text: finalReport, outputTokens: outputTokens || undefined };
}
