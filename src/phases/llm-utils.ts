import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent } from "../types";
import { estimatePreparedMessages, PromptBudgetExceededError } from "../prompt-budget";
import { compressionInstruction } from "../semantic-compression";
import baseContract from "../../prompts/base.md";
import { jsonrepair } from "jsonrepair";
import { resolveLang, resolveReasoningLang } from "../i18n";

/** Maps a concrete output language to a reply directive for the system prompt. */
export function langInstruction(lang: "ru" | "en" | "es"): string {
  switch (lang) {
    case "ru": return "Write the entire response in Russian. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "en": return "Write the entire response in English. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
    case "es": return "Write the entire response in Spanish. Do not switch to the source language, even when the notes, user input, or quoted text are in another language.";
  }
}

/**
 * Mandatory + optional wiki section headings, rendered in the configured output language.
 * Fed into `_wiki_schema.md` via the `{{section_conventions}}` placeholder so generated
 * pages use headings that match the selected language. `auto` falls back to Russian,
 * preserving the historical default.
 */
export function wikiSections(lang: "ru" | "en" | "es"): string {
  const headings = {
    ru: {
      mandatory: "## Основные характеристики",
      usage: "## Применение в контексте [Домен]",
      examples: "## Примеры",
      limitations: "## Ограничения",
      best: "## Best Practices",
    },
    en: {
      mandatory: "## Key characteristics",
      usage: "## Usage in the [Domain] context",
      examples: "## Examples",
      limitations: "## Limitations",
      best: "## Best Practices",
    },
    es: {
      mandatory: "## Características principales",
      usage: "## Uso en el contexto de [Dominio]",
      examples: "## Ejemplos",
      limitations: "## Limitaciones",
      best: "## Best Practices",
    },
  };
  const h = lang === "en" ? headings.en : lang === "es" ? headings.es : headings.ru;
  return [
    "Page structure (mandatory order). The headings below are already in the configured output language — use them verbatim:",
    "1. Frontmatter (YAML)",
    "2. H1 heading — the page title",
    `3. ${h.mandatory} — key properties and parameters (MANDATORY on every page)`,
    "",
    "Optional sections (include only when relevant, use these exact headings):",
    `- ${h.usage}`,
    `- ${h.examples}`,
    `- ${h.limitations}`,
    `- ${h.best}`,
    "- ## Related — outgoing wiki links as one `- [[stem]]` bullet per line (fixed heading, not localized; no frontmatter link fields anymore)",
    "- ## External links — outgoing URLs as one `- [text](url)` bullet per line (fixed heading, not localized)",
  ].join("\n");
}

/** Remove <think>...</think> blocks leaked into content by thinking models. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Parse structured JSON from LLM output.
 * Fast path: direct parse (works for json_object mode).
 * Fallback: strip <think> tags and markdown fences, retry parse, then regex-extract JSON block.
 * Throws if no valid JSON found.
 */
export function parseStructured(fullText: string): unknown {
  const text = fullText.trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const stripped = stripFences(stripThinking(text));
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  if (stripped.includes("{")) {
    try { return JSON.parse(jsonrepair(stripped)); } catch { /* fall through */ }
  }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  try { return JSON.parse(match[0]); } catch (e) {
    // "Unexpected non-whitespace character after JSON at position N" —
    // greedy regex captured trailing garbage after valid JSON closing brace.
    // Slice to error position and retry.
    const posMatch = String((e as Error).message).match(/at position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      if (pos > 0) return JSON.parse(match[0].slice(0, pos));
    }
    throw e;
  }
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  return fenced ? fenced[1].trim() : text;
}

/** Извлекает reasoning, content и usage.completion_tokens из одного streaming-чанка.
 *  Reasoning-модели (minimax, o1 и др.) возвращают думающий текст в нестандартном поле delta.reasoning.
 *  outputTokens приходит только в финальном чанке при stream_options.include_usage=true. */
export function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): { reasoning: string; content: string; outputTokens?: number; inputTokens?: number } {
  const delta = chunk.choices[0]?.delta;
  const rawReasoning = (delta as Record<string, unknown> | undefined)?.reasoning
    ?? (delta as Record<string, unknown> | undefined)?.reasoning_content;
  const usage = (chunk as unknown as { usage?: { completion_tokens?: number; prompt_tokens?: number } }).usage;
  const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  return {
    reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
    content: typeof delta?.content === "string" ? delta.content : "",
    outputTokens,
    inputTokens,
  };
}

/** Извлекает completion_tokens из non-stream ответа OpenAI. */
export function extractUsage(resp: OpenAI.Chat.ChatCompletion): number | undefined {
  const tok = resp.usage?.completion_tokens;
  return typeof tok === "number" ? tok : undefined;
}

export function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  stream: boolean = false,
): Record<string, unknown> {
  const msgs = prepareChatMessages(messages, opts);
  if (opts.inputBudgetTokens !== undefined) {
    const estimated = estimatePreparedMessages(msgs);
    if (estimated > opts.inputBudgetTokens) {
      throw new PromptBudgetExceededError(opts.inputBudgetTokens, estimated, []);
    }
  }
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (stream) params.stream_options = { include_usage: true };

  if (opts.jsonMode === "json_schema" && opts.jsonSchema) {
    params.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: false },
    };
  } else if (opts.jsonMode === "json_object") {
    params.response_format = { type: "json_object" };
  }

  if (opts.thinkingBudgetTokens && opts.thinkingBudgetTokens > 0) {
    params.thinking = { type: "enabled", budget_tokens: opts.thinkingBudgetTokens };
    delete params.response_format;
    delete params.temperature;
    delete params.top_p;
  }

  return params;
}

export function prepareChatMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let msgs = prependBaseContract(messages);
  if (opts.outputLanguage) msgs = injectLanguageDirective(msgs, resolveLang(opts.outputLanguage));
  msgs = injectReasoningDirective(msgs, resolveReasoningLang(opts.reasoningLanguage, opts.outputLanguage));
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
  if (opts.semanticCompression) msgs = appendSystemSection(msgs, compressionInstruction(opts.semanticCompression));
  return msgs;
}

function prependBaseContract(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing: string = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { ...updated[firstSystem], role: "system", content: `${baseContract}\n\n${existing}` };
    return updated;
  }
  return [{ role: "system", content: baseContract }, ...messages];
}

/** Appends `## Language\n<directive>` to the first system message. */
function injectLanguageDirective(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lang: "ru" | "en" | "es",
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const directive = `## Language\n${langInstruction(lang)}`;
  return appendSystemSection(messages, directive);
}

const REASONING_LANG_NAME: Record<"ru" | "en" | "es", string> = {
  ru: "Russian",
  en: "English",
  es: "Spanish",
};

/**
 * The reasoning-language section, shared by `buildChatParams` (via
 * `injectReasoningDirective`) and the vision path. Returns the full section
 * including its heading so both call sites embed identical text.
 */
export function reasoningDirective(lang: "ru" | "en" | "es"): string {
  const name = REASONING_LANG_NAME[lang];
  return [
    "## Reasoning language",
    `Reason and think exclusively in ${name}.`,
    `Do not switch the reasoning language to match the source notes, user input, or quoted text, even when those are written in another language.`,
    `This rule also governs the \`reasoning\` field of any JSON output: write that field in ${name} as well.`,
  ].join("\n");
}

/** Appends the shared reasoning directive to the first system message. */
function injectReasoningDirective(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  lang: "ru" | "en" | "es",
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return appendSystemSection(messages, reasoningDirective(lang));
}

const JSON_MODE_KEYWORDS = ["response_format", "json_object", "json mode", "unsupported"];

/**
 * Heuristic: detect if an LLM error means the backend doesn't support `response_format`.
 * True iff: status 400 or 422 AND message contains one of the keywords
 * ("response_format", "json_object", "json mode", "unsupported").
 * False for non-object inputs and for any other status (401/403/429/500/etc.).
 *
 * Note: "unsupported" alone is intentionally broad — may produce false positives on
 * other 400s mentioning unsupported features. Cost is one extra retry, acceptable.
 */
export function isJsonModeError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: unknown }).status;
  if (status !== 400 && status !== 422) return false;
  const msg = String((e as { message?: unknown }).message ?? "").toLowerCase();
  return JSON_MODE_KEYWORDS.some((kw) => msg.includes(kw));
}

function injectSystemPrompt(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (!systemPrompt) return messages;
  return appendSystemSection(messages, `## Clarification\n${systemPrompt}`);
}

function appendSystemSection(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  section: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { ...updated[firstSystem], role: "system", content: `${existing}\n\n${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}

export interface LlmStreamStats {
  inputTokens: number;
  outputTokens: number;
  ttftMs: number;
  llmDurationMs: number;
}

export function wrapStreamWithStats(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  requestStartMs: number,
): {
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  getStats(this: void): LlmStreamStats | undefined;
} {
  let ttftMs: number | undefined;
  let firstChunkMs: number | undefined;
  let llmDurationMs: number | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let yielded = false;

  async function* wrapped(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    for await (const chunk of stream) {
      if (!yielded) {
        ttftMs = Date.now() - requestStartMs;
        firstChunkMs = Date.now();
        yielded = true;
      }
      const { outputTokens: tok, inputTokens: inTok } = extractStreamDeltas(chunk);
      if (tok !== undefined) outputTokens = tok;
      if (inTok !== undefined) inputTokens = inTok;
      yield chunk;
    }
    if (yielded && firstChunkMs !== undefined) {
      llmDurationMs = Date.now() - firstChunkMs;
    }
  }

  const wrappedStream = wrapped();

  return {
    stream: wrappedStream,
    getStats(this: void): LlmStreamStats | undefined {
      if (!yielded || ttftMs === undefined || llmDurationMs === undefined) return undefined;
      // Non-streaming emulation (mobile): chunks arrive synchronously in <10ms.
      // Use ttftMs (full HTTP round-trip) as effective duration for tok/s calculation.
      const effectiveDurationMs = llmDurationMs < 10 ? ttftMs : llmDurationMs;
      return { inputTokens, outputTokens, ttftMs, llmDurationMs: effectiveDurationMs };
    },
  };
}

export function buildLlmCallStatsEvent(s: LlmStreamStats): RunEvent {
  const durS = s.llmDurationMs / 1000;
  return {
    kind: "llm_call_stats",
    ...s,
    inTokPerSec: durS > 0 ? Math.round(s.inputTokens / durS) : 0,
    outTokPerSec: durS > 0 ? Math.round(s.outputTokens / durS) : 0,
  };
}

export function computeSpeedText(stats: Array<{
  inputTokens: number; outputTokens: number;
  ttftMs: number; llmDurationMs: number;
}>): string {
  if (!stats.length) return "";
  const totalIn = stats.reduce((s, x) => s + x.inputTokens, 0);
  const totalOut = stats.reduce((s, x) => s + x.outputTokens, 0);
  const totalDurS = stats.reduce((s, x) => s + x.llmDurationMs, 0) / 1000;
  const sorted = [...stats.map(x => x.ttftMs)].sort((a, b) => a - b);
  const medTtft = sorted[Math.floor(sorted.length / 2)];
  if (totalDurS <= 0) return "";
  const inS = Math.round(totalIn / totalDurS);
  const outS = Math.round(totalOut / totalDurS);
  return ` in: ${totalIn} tok (${inS} tok/s) · out: ${totalOut} tok (${outS} tok/s) · latency: ${medTtft}ms`;
}
