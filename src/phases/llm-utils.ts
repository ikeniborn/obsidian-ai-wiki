import type OpenAI from "openai";
import type { LlmCallOptions, LlmClient } from "../types";
import baseContract from "../../prompts/base.md";

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
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  return JSON.parse(match[0]);
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  return fenced ? fenced[1].trim() : text;
}

/** Извлекает reasoning, content и usage.completion_tokens из одного streaming-чанка.
 *  Reasoning-модели (minimax, o1 и др.) возвращают думающий текст в нестандартном поле delta.reasoning.
 *  outputTokens приходит только в финальном чанке при stream_options.include_usage=true. */
export function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): { reasoning: string; content: string; outputTokens?: number } {
  const delta = chunk.choices[0]?.delta;
  const rawReasoning = (delta as Record<string, unknown> | undefined)?.reasoning;
  const usage = (chunk as unknown as { usage?: { completion_tokens?: number } }).usage;
  const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  return {
    reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
    content: typeof delta?.content === "string" ? delta.content : "",
    outputTokens,
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
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;
  if (stream) params.stream_options = { include_usage: true };

  if (opts.jsonMode === "json_object") {
    params.response_format = { type: "json_object" };
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

function stripResponseFormat(params: Record<string, unknown>): Record<string, unknown> {
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
        try {
          return await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
        } catch (e) {
          if (!isJsonModeError(e)) throw e;
          return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(stripResponseFormat(params), callOpts);
        }
      })();
    }

    return (async () => {
      let upstream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      try {
        upstream = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(params, callOpts);
      } catch (e) {
        if (!isJsonModeError(e)) throw e;
        return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(stripResponseFormat(params), callOpts);
      }

      async function* gated(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
        let seenContent = false;
        try {
          for await (const chunk of upstream) {
            if (hasContentDelta(chunk)) seenContent = true;
            yield chunk;
          }
        } catch (e) {
          if (seenContent || !isJsonModeError(e)) throw e;
          const retry = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(stripResponseFormat(params), callOpts);
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
