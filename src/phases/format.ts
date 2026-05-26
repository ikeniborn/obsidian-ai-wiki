import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient, ChatMessage } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage, parseStructured, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import formatTemplate from "../../prompts/format.md";
import formatSchemaDefault from "../../templates/_format_schema.md";
import { render } from "./template";
import { missingTokensWithContext, looksTruncated, appendMissingLines } from "./format-utils";
import { GLOBAL_FORMAT_SCHEMA_PATH } from "../wiki-path";
import { fixWikiLinks } from "../wiki-link-validator";
import { FormatOutputSchema } from "./zod-schemas";
import { structuralErrorCounter } from "../structural-error-counter";

function parseFormatOutput(text: string): { report: string; formatted: string } | null {
  let raw: unknown;
  try {
    raw = parseStructured(text);
  } catch {
    structuralErrorCounter.record(false, 0);
    return null;
  }
  const result = FormatOutputSchema.safeParse(raw);
  if (result.success) {
    structuralErrorCounter.record(true, 0);
    return result.data;
  }
  structuralErrorCounter.record(false, 0);
  return null;
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

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
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
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const filePath = args[0];

  if (!filePath) {
    yield { kind: "error", message: "Format: file path is required" };
    return;
  }
  if (signal.aborted) return;

  const original = await vaultTools.read(filePath);
  if (!original) {
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

  const systemContent = render(formatTemplate, {
    format_schema: formatSchema,
    has_vision: String(hasVision),
  });

  const userInitial = `Исходный файл: ${filePath}\n---\n${original}`;

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
    { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
    ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
  ];

  yield { kind: "assistant_text", delta: `Анализ файла ${filePath}...\n` };

  const baseParams = { ...buildChatParams(model, messages, opts, true), response_format: { type: "json_object" } };

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

  let fullText = yield* callOnce(baseParams);
  if (signal.aborted) return;

  let parsed = parseFormatOutput(fullText);
  const truncated = !parsed && (lastFinishReason === "length" || looksTruncated(fullText));
  if (!parsed && truncated) {
    yield { kind: "error", message: `Format: ответ обрезан по лимиту вывода модели — сократите страницу или ${truncationHint(backend)}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }
  if (!parsed) {
    yield { kind: "assistant_text", delta: "\n[JSON невалиден — повторяю запрос]\n" };
    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent + "\n\nКРИТИЧЕСКИ ВАЖНО: верни ТОЛЬКО JSON-объект {\"report\": \"...\", \"formatted\": \"...\"} без markdown-обёртки, без ```json fence, без пояснений. Все спецсимволы внутри строк должны быть экранированы (\\n, \\\", \\\\)." },
      { role: "user", content: userContent } as OpenAI.Chat.ChatCompletionMessageParam,
      ...chatHistory.map((m) => ({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    ];
    const retryParams = { ...buildChatParams(model, retryMessages, opts, true), response_format: { type: "json_object" } };
    fullText = yield* callOnce(retryParams);
    if (signal.aborted) return;
    parsed = parseFormatOutput(fullText);
  }
  if (!parsed) {
    const retryTruncated = lastFinishReason === "length" || looksTruncated(fullText);
    const msg = retryTruncated
      ? `Format: ответ обрезан по лимиту вывода модели (после retry) — сократите страницу или ${truncationHint(backend)}`
      : "Format: LLM вернул невалидный JSON (после retry)";
    yield { kind: "error", message: msg };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }

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
        content: `ВОССТАНОВИ ТОКЕНЫ: следующие значения из оригинала отсутствуют в форматированном тексте. Верни полный JSON {report, formatted} где formatted содержит все перечисленные токены без изменения форматирования остального текста.\nПропущенные: ${tokenList}`,
      },
    ];
    const restoreParams = { ...buildChatParams(model, restoreMessages, opts, true), response_format: { type: "json_object" } };
    const fullText2 = yield* callOnce(restoreParams);
    if (!signal.aborted) {
      const parsed2 = parseFormatOutput(fullText2);
      if (parsed2) {
        finalFormatted = parsed2.formatted;
        finalReport = parsed2.report;
      }
    }
    const missing2 = missingTokensWithContext(original, finalFormatted);
    if (missing2.length > 0) {
      finalFormatted = appendMissingLines(finalFormatted, missing2);
    }
  }

  const wlFix = fixWikiLinks(new Map([[filePath, finalFormatted]]), wikiLinkValidationRetries);
  finalFormatted = wlFix.fixed.get(filePath) ?? finalFormatted;

  try {
    await vaultTools.write(tempPath, finalFormatted);
  } catch (e) {
    yield { kind: "error", message: `Format: запись формата не удалась — ${(e as Error).message}` };
    return;
  }

  if (wlFix.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFix.warnings };
  }

  const missingFinal = missingTokensWithContext(original, finalFormatted);
  yield { kind: "format_preview", tempPath, report: finalReport, missingTokens: missingFinal };
  yield { kind: "result", durationMs: Date.now() - start, text: finalReport, outputTokens: outputTokens || undefined };
}
