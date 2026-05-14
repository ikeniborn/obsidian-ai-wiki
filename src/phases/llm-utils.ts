import type OpenAI from "openai";
import type { LlmCallOptions } from "../types";
import baseContract from "../../prompts/base.md";

export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

/** Remove <think>...</think> blocks leaked into content by thinking models. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Parse structured JSON from LLM output.
 * Fast path: direct parse (works for json_schema / json_object mode).
 * Fallback: strip <think> tags, then find JSON block.
 * Throws if no valid JSON found.
 */
export function parseStructured(fullText: string): unknown {
  const text = fullText.trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const stripped = stripThinking(text);
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  return JSON.parse(match[0]);
}

/** Извлекает reasoning и content из одного streaming-чанка.
 *  Reasoning-модели (minimax, o1 и др.) возвращают думающий текст в нестандартном поле delta.reasoning.
 *  Модели без поддержки reasoning возвращают пустую строку — ошибок не возникает. */
export function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): { reasoning: string; content: string } {
  const delta = chunk.choices[0]?.delta;
  const rawReasoning = (delta as Record<string, unknown> | undefined)?.reasoning;
  return {
    reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
    content: typeof delta?.content === "string" ? delta.content : "",
  };
}

export function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  responseSchema?: StructuredOutputSchema,
): Record<string, unknown> {
  let msgs = prependBaseContract(messages);
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;

  if (responseSchema && opts.jsonMode === "json_schema") {
    params.response_format = {
      type: "json_schema",
      json_schema: { name: responseSchema.name, schema: responseSchema.schema, strict: true },
    };
  } else if (opts.jsonMode === "json_object") {
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
