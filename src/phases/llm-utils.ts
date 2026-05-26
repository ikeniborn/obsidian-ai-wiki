import type OpenAI from "openai";
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import baseContract from "../../prompts/base.md";
import { jsonrepair } from "jsonrepair";

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
  let msgs = prependBaseContract(messages);
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
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

function prependBaseContract(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing: string = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content as string : "";
    updated[firstSystem] = { role: "system", content: `${baseContract}\n\n${existing}` };
    return updated;
  }
  return [{ role: "system", content: baseContract }, ...messages];
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

function hasContentDelta(chunk: OpenAI.Chat.ChatCompletionChunk): boolean {
  const c = chunk.choices?.[0]?.delta?.content;
  return typeof c === "string" && c.length > 0;
}

/** Two-stage response_format degradation: json_schema → json_object → nothing. */
function degradeResponseFormat(params: Record<string, unknown>): Record<string, unknown> {
  const rf = params.response_format as { type?: string } | undefined;
  if (rf?.type === "json_schema") {
    return { ...params, response_format: { type: "json_object" } };
  }
  const next = { ...params };
  delete next.response_format;
  return next;
}

/**
 * Decorator over LlmClient: if a request with `response_format` fails because the backend
 * doesn't support it (see {@link isJsonModeError}), retry once with `response_format` stripped.
 *
 * - Non-streaming: on caught json-mode error, transparently retry without `response_format`.
 * - Streaming: retry only if no content delta has been yielded yet. Reasoning chunks
 *   (`delta.reasoning`) do NOT count as content, so retry is still possible after them.
 * - When request has no `response_format`, behaves as pass-through.
 *
 * Trade-off: mid-stream retry replays reasoning chunks already yielded to the consumer.
 * Downstream parsers (parseStructured) tolerate `<think>` noise, so this is safe in practice.
 */
export function wrapWithJsonFallback(inner: LlmClient): LlmClient {
  const create = ((params: Record<string, unknown>, callOpts?: { signal?: AbortSignal }) => {
    const hasRf = params.response_format !== undefined;
    const isStream = params.stream === true;

    if (!hasRf) {
      return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
    }

    if (!isStream) {
      return (async () => {
        let current = params;
        while (current.response_format !== undefined) {
          try {
            return await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(current, callOpts);
          } catch (e) {
            if (!isJsonModeError(e)) throw e;
            current = degradeResponseFormat(current);
          }
        }
        return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(current, callOpts);
      })();
    }

    return (async () => {
      // Initial connection: loop through degradation levels until connected.
      let current = params;
      let upstream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | undefined;
      while (upstream === undefined) {
        try {
          upstream = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(current, callOpts);
        } catch (e) {
          if (!isJsonModeError(e) || current.response_format === undefined) throw e;
          current = degradeResponseFormat(current);
        }
      }
      const connectedParams = current;

      async function* gated(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
        let seenContent = false;
        try {
          for await (const chunk of upstream!) {
            if (hasContentDelta(chunk)) seenContent = true;
            yield chunk;
          }
        } catch (e) {
          if (seenContent || !isJsonModeError(e)) throw e;
          // Mid-stream error before any content: degrade one level from the params
          // that connected successfully (connectedParams), not from original params.
          const degraded = degradeResponseFormat(connectedParams);
          if (degraded.response_format === connectedParams.response_format) throw e;
          const retry = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(degraded, callOpts);
          for await (const c of retry) yield c;
        }
      }
      return gated();
    })();
  }) as unknown as LlmClient["chat"]["completions"]["create"];

  return { chat: { completions: { create } } };
}

function injectSystemPrompt(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (!systemPrompt) return messages;
  const section = `## Уточнение\n${systemPrompt}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing: string = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content as string : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${section}` };
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
  getStats(): LlmStreamStats | undefined;
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
    getStats(): LlmStreamStats | undefined {
      if (!yielded || ttftMs === undefined || llmDurationMs === undefined) return undefined;
      return { inputTokens, outputTokens, ttftMs, llmDurationMs };
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
  return ` in: ${inS} tok/s · out: ${outS} tok/s · latency: ${medTtft}ms`;
}
