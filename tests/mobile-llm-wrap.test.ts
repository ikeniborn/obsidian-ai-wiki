import { describe, it, expect, vi } from "vitest";
import { wrapMobileNoStream } from "../src/mobile-llm-wrap";
import type { LlmClient } from "../src/types";
import type OpenAI from "openai";

function makeCompletion(content: string, reasoning?: string): OpenAI.Chat.ChatCompletion {
  return {
    id: "cmpl-1",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(reasoning ? { reasoning } : {}),
      } as OpenAI.Chat.ChatCompletionMessage,
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function makeInner(completion: OpenAI.Chat.ChatCompletion): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(completion),
      },
    },
  } as unknown as LlmClient;
}

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("wrapMobileNoStream", () => {
  it("rewrites stream:true to stream:false and yields content + final chunk", async () => {
    const inner = makeInner(makeCompletion("hello world"));
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "hi" }], stream: true } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    );
    const chunks = await drain(result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello world");
    expect(chunks[1].choices[0].finish_reason).toBe("stop");
    expect(chunks[1].usage?.total_tokens).toBe(30);
    const createMock = inner.chat.completions.create as ReturnType<typeof vi.fn>;
    const callArgs = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.stream).toBe(false);
    expect(callArgs.stream_options).toBeUndefined();
  });

  it("yields reasoning chunk before content when reasoning present", async () => {
    const inner = makeInner(makeCompletion("answer", "thinking..."));
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [], stream: true } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    );
    const chunks = await drain(result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>);
    expect(chunks).toHaveLength(3);
    expect((chunks[0].choices[0].delta as { reasoning?: string }).reasoning).toBe("thinking...");
    expect(chunks[1].choices[0].delta.content).toBe("answer");
    expect(chunks[2].choices[0].finish_reason).toBe("stop");
  });

  it("passes non-stream calls through unchanged", async () => {
    const completion = makeCompletion("plain");
    const inner = makeInner(completion);
    const wrapped = wrapMobileNoStream(inner);
    const result = await wrapped.chat.completions.create(
      { model: "m", messages: [], stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    expect(result).toBe(completion);
  });
});
