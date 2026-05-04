import type OpenAI from "openai";
import type { LlmCallOptions } from "../types";

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
): Record<string, unknown> {
  const msgs = opts.systemPrompt ? injectSystemPrompt(messages, opts.systemPrompt) : messages;
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;
  return params;
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
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}\n\n${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}
