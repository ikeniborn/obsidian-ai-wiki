import type { LlmClient } from "./types";
import type OpenAI from "openai";

/**
 * Mobile-only wrapper: forces stream:false (requestUrl/mobileFetch не поддерживает
 * incremental SSE). Эмулирует AsyncIterable из non-stream completion для совместимости
 * с phase-кодом, который ожидает chunk-stream.
 */
export function wrapMobileNoStream(inner: LlmClient): LlmClient {
  const create = (async (
    params: Record<string, unknown>,
    callOpts?: { signal?: AbortSignal },
  ) => {
    if (params.stream !== true) {
      return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
    }
    const noStreamParams = { ...params, stream: false } as Record<string, unknown>;
    delete noStreamParams.stream_options;
    const resp = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<OpenAI.Chat.ChatCompletion>)(
      noStreamParams,
      callOpts,
    );
    return completionToAsyncIterable(resp);
  }) as unknown as LlmClient["chat"]["completions"]["create"];
  return { chat: { completions: { create } } };
}

async function* completionToAsyncIterable(
  c: OpenAI.Chat.ChatCompletion,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const choice = c.choices[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const reasoning = (choice?.message as { reasoning?: string } | undefined)?.reasoning;

  if (reasoning) {
    yield mkChunk(c, { reasoning } as Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>);
  }
  if (content) {
    yield mkChunk(c, { content });
  }
  yield mkChunk(c, {}, choice?.finish_reason ?? "stop", c.usage ?? null);
}

function mkChunk(
  base: OpenAI.Chat.ChatCompletion,
  delta: Partial<OpenAI.Chat.ChatCompletionChunk.Choice.Delta>,
  finish_reason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"] | null = null,
  usage: OpenAI.CompletionUsage | null = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: base.id,
    object: "chat.completion.chunk",
    created: base.created,
    model: base.model,
    choices: [{
      index: 0,
      delta: delta,
      finish_reason,
      logprobs: null,
    }],
    usage: usage ?? undefined,
  };
}
