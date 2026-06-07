import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import formatTemplate from "../../prompts/format.md";
import restoreTokensTemplate from "../../prompts/format-restore-tokens.md";
import formatSchemaDefault from "../../templates/_format_schema.md";
import { render } from "./template";
import { missingTokensWithContext, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds, parseSentinelOutput } from "./format-utils";
import { GLOBAL_FORMAT_SCHEMA_PATH } from "../wiki-path";
import { fixWikiLinks } from "../wiki-link-validator";
import { FormatBaseSchema, FormatWithVisionSchema } from "./zod-schemas";
import { structuralErrorCounter } from "../structural-error-counter";
import { extractObsidianEmbedPaths, analyzeSingleAttachment } from "./attachment-analyzer";

function parseFormatOutput(
  text: string,
  hasVisionDescriptions: boolean,
): { data: import("./zod-schemas").FormatOutput | null; hint: string; truncated: boolean } {
  const sentinel = parseSentinelOutput(text, hasVisionDescriptions);
  if (!sentinel) {
    structuralErrorCounter.record(false, 0);
    return { data: null, hint: "sentinel markers not found", truncated: false };
  }
  const raw = hasVisionDescriptions
    ? {
        report: sentinel.report,
        formatted: sentinel.formatted,
        vision_blocks_count: sentinel.visionCount ?? 0,
        embeds_preserved: sentinel.embeds ?? [],
      }
    : { report: sentinel.report, formatted: sentinel.formatted };

  const schema = hasVisionDescriptions ? FormatWithVisionSchema : FormatBaseSchema;
  const result = schema.safeParse(raw);
  if (result.success) {
    structuralErrorCounter.record(true, 0);
    return { data: result.data, hint: "", truncated: sentinel.truncated };
  }
  structuralErrorCounter.record(false, 0);
  const hint = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { data: null, hint, truncated: sentinel.truncated };
}

function extractImagePaths(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1].trim();
    if (!url.startsWith("http")) out.push(url);
  }
  return out;
}

function truncationHint(backend: "claude-agent" | "native-agent"): string {
  return backend === "claude-agent"
    ? "увеличьте лимит: env CLAUDE_CODE_MAX_OUTPUT_TOKENS в iclaude.sh"
    : "увеличьте лимит: Settings → per-operation → format → maxTokens";
}

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
  visionSettings: { enabled: boolean; model: string; language?: "auto" | "ru" | "en" | "es" } = { enabled: false, model: "" },
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

  const formatSchemaPath = GLOBAL_FORMAT_SCHEMA_PATH;
  let formatSchema: string;
  try {
    formatSchema = await vaultTools.read(formatSchemaPath);
  } catch {
    formatSchema = formatSchemaDefault;
    try { await vaultTools.write(formatSchemaPath, formatSchemaDefault); } catch { /* не блокируем */ }
  }
  yield { kind: "tool_result", ok: true, preview: `${original.length} chars` };

  const visionDescriptions = new Map<string, string>();
  if (visionSettings.enabled && visionSettings.model) {
    const embedPaths = [...new Set(extractObsidianEmbedPaths(original))];
    if (embedPaths.length > 0) {
      const lang = visionSettings.language ?? "auto";
      for (const path of embedPaths) {
        if (signal.aborted) break;
        const filename = path.split("/").pop() ?? path;
        yield { kind: "tool_use", name: "Vision", input: { file_path: filename, model: visionSettings.model } };
        try {
          const description = await analyzeSingleAttachment(path, vaultTools, llm, visionSettings.model, signal, filePath, lang);
          if (description !== null) {
            visionDescriptions.set(path, description);
            yield { kind: "tool_result", ok: true, preview: description };
          } else {
            yield { kind: "tool_result", ok: false, preview: "unknown extension" };
            yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
          }
        } catch (e) {
          yield { kind: "tool_result", ok: false, preview: (e as Error)?.message ?? "failed" };
          yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [path] };
        }
      }
    }
  }

  const visionDescBlock = visionDescriptions.size > 0
    ? [
        "При наличии описаний вложений добавь после <<<FORMATTED>>> дополнительные маркеры:",
        "<<<VISION_COUNT>>>",
        "<количество описаний, целое число>",
        "<<<EMBEDS>>>",
        "<пути через |: img/a.png|img/b.png>",
        "Эти маркеры ставь ПОСЛЕ formatted и ДО <<<END>>>.",
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
    visionBlock = `\n---\nОПИСАНИЯ ВЛОЖЕНИЙ (vision-распознавание; интегрируй СРАЗУ ПОД соответствующей вставкой \`![[путь]]\` как структурированный markdown — таблица/список/код по форме исходника; для ДИАГРАММ сохрани оба элемента: сначала текстовое описание, затем блок \`\`\`mermaid\`\`\` — не выбрасывай ни описание, ни mermaid; НЕ оборачивай в blockquote, НЕ добавляй маркер [Vision], НЕ цитируй пути):\n${items.join("\n\n")}`;
  }

  const userInitial = `Исходный файл: ${filePath}\n---\n${original}${visionBlock}`;

  const imagePaths = hasVision ? extractImagePaths(original) : [];

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

  yield { kind: "assistant_text", delta: `Анализ файла ${filePath}...\n` };

  const baseParams = buildChatParams(model, messages, opts, true);

  let lastFinishReason: string | null = null;
  let outputTokens = 0;

  async function* callOnce(p: Record<string, unknown>): AsyncGenerator<RunEvent, string> {
    let acc = "";
    lastFinishReason = null;
    try {
      const requestStartMs = Date.now();
      const rawStream = await llm.chat.completions.create(
        { ...p, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
      for await (const chunk of stream) {
        const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { acc += content; yield { kind: "assistant_text", delta: content }; }
        if (tok !== undefined) outputTokens += tok;
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      }
      const callStats = getStats();
      if (callStats) yield buildLlmCallStatsEvent(callStats);
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return acc;
      const resp = await llm.chat.completions.create(
        { ...p, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      acc = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      if (tok !== undefined) outputTokens += tok;
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
    }
    return acc;
  }

  yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
  let fullText = yield* callOnce(baseParams);
  if (signal.aborted) return;

  let parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
  let parsed = parsedResult.data;

  if (parsedResult.truncated) {
    yield {
      kind: "info_text", icon: "⚠️",
      summary: "Format: ответ обрезан — salvage",
      details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
    };
  }

  const truncated = !parsed && lastFinishReason === "length";
  if (!parsed && truncated) {
    yield { kind: "tool_result", ok: false, preview: "response truncated" };
    yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }

  if (!parsed) {
    yield { kind: "tool_result", ok: false, preview: "invalid sentinel — retrying" };
    yield { kind: "assistant_text", delta: "\n[Sentinel невалиден — повторяю запрос]\n" };
    const zodHint = parsedResult.hint;
    const retrySystemContent = systemContent + `\n\nПредыдущая попытка не прошла: ${zodHint}. Исправь и верни заново используя маркеры <<<REPORT>>>...<<<END>>>.`;
    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: retrySystemContent },
      { role: "user", content: userContent },
    ];
    const retryParams = buildChatParams(model, retryMessages, opts, true);
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
    fullText = yield* callOnce(retryParams);
    if (signal.aborted) return;
    parsedResult = parseFormatOutput(fullText, visionDescriptions.size > 0);
    parsed = parsedResult.data;
    if (parsedResult.truncated) {
      yield {
        kind: "info_text", icon: "⚠️",
        summary: "Format: retry ответ обрезан — salvage",
        details: ["Маркер <<<END>>> отсутствует; использован частичный вывод."],
      };
    }
  }

  if (!parsed) {
    const retryTruncated = lastFinishReason === "length";
    const msg = retryTruncated
      ? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
      : "Format: LLM вернул невалидный sentinel (после retry)";
    yield { kind: "tool_result", ok: false, preview: msg };
    yield { kind: "error", message: msg };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: `${parsed.formatted.length} chars` };

  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
  const baseName = (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath).replace(/\.md$/, "") || "page";
  const tempPath = dir ? `${dir}/${baseName}.formatted.md` : `${baseName}.formatted.md`;

  // Token-retry: if first response lost tokens — one multi-turn correction call.
  let finalFormatted = parsed.formatted;
  let finalReport = parsed.report;
  const missing1 = missingTokensWithContext(original, parsed.formatted);

  if (missing1.length > 0 && !signal.aborted) {
    const tokenList = missing1.map((m) => `\`${m.token}\``).join(", ");
    const restoreMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: fullText },
      {
        role: "user",
        content: render(restoreTokensTemplate, { tokens: tokenList }),
      },
    ];
    const restoreParams = buildChatParams(model, restoreMessages, opts, true);
    yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
    const fullText2 = yield* callOnce(restoreParams);
    if (!signal.aborted) {
      const parsed2Result = parseFormatOutput(fullText2, visionDescriptions.size > 0);
      const parsed2 = parsed2Result.data;
      if (parsed2) {
        finalFormatted = parsed2.formatted;
        finalReport = parsed2.report;
      }
      yield { kind: "tool_result", ok: true, preview: "tokens restored" };
    }
    const missing2 = missingTokensWithContext(original, finalFormatted);
    if (missing2.length > 0) {
      finalFormatted = appendMissingLines(finalFormatted, missing2);
    }
  }

  finalFormatted = restoreObsidianEmbeds(original, finalFormatted);
  const embedWarnings = missingObsidianEmbeds(original, finalFormatted);

  const wlFix = fixWikiLinks(new Map([[filePath, finalFormatted]]), wikiLinkValidationRetries);
  finalFormatted = wlFix.fixed.get(filePath) ?? finalFormatted;

  try {
    await vaultTools.write(tempPath, finalFormatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
    return;
  }

  if (embedWarnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "Embed warnings", details: embedWarnings.map(e => `Not restored: ${e}`) };
  }
  if (wlFix.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFix.warnings };
  }

  const missingFinal = missingTokensWithContext(original, finalFormatted);
  yield { kind: "format_preview", tempPath, report: finalReport, missingTokens: missingFinal };
  yield { kind: "result", durationMs: Date.now() - start, text: finalReport, outputTokens: outputTokens || undefined };
}
