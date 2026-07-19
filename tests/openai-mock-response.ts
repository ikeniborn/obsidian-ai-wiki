import type OpenAI from "openai";

export function mockChatResponse(
  params: unknown,
  content: string,
  usage: { promptTokens?: number; completionTokens?: number } = {},
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion {
  const promptTokens = usage.promptTokens ?? 10;
  const completionTokens = usage.completionTokens ?? 5;
  if ((params as { stream?: boolean }).stream === false) {
    return {
      id: "completion",
      object: "chat.completion",
      created: 0,
      model: "mock",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content, refusal: null },
        logprobs: null,
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
  return (async function* () {
    yield {
      id: "content",
      object: "chat.completion.chunk",
      created: 0,
      model: "mock",
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
    } as OpenAI.Chat.ChatCompletionChunk;
    yield {
      id: "usage",
      object: "chat.completion.chunk",
      created: 0,
      model: "mock",
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    } as OpenAI.Chat.ChatCompletionChunk;
  })();
}
