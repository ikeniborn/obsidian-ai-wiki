import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseWithRetry } from "../src/phases/parse-with-retry";
import type { LlmClient, RunEvent } from "../src/types";
import type OpenAI from "openai";

function makeStream(chunks: Partial<OpenAI.Chat.ChatCompletionChunk>[]): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { done: true as const, value: undefined };
          return { done: false as const, value: chunks[i++] as OpenAI.Chat.ChatCompletionChunk };
        },
      };
    },
  };
}

function makeLlm(chunks: Partial<OpenAI.Chat.ChatCompletionChunk>[]): LlmClient {
  return {
    chat: {
      completions: {
        create: async () => makeStream(chunks) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
      } as LlmClient["chat"]["completions"],
    },
  };
}

describe("parseWithRetry — llm_call_stats emission", () => {
  it("emits llm_call_stats event on successful parse", async () => {
    const chunks = [
      { choices: [{ delta: { content: '{"x":1}' } }] },
      { choices: [{ delta: {} }], usage: { completion_tokens: 10, prompt_tokens: 8 } },
    ];
    const events: RunEvent[] = [];
    const result = await parseWithRetry({
      llm: makeLlm(chunks),
      model: "m",
      baseMessages: [{ role: "user", content: "q" }],
      opts: {},
      schema: z.object({ x: z.number() }),
      maxRetries: 0,
      callSite: "query.seeds",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
    });
    expect(result.value).toEqual({ x: 1 });
    const statsEvents = events.filter(e => e.kind === "llm_call_stats");
    expect(statsEvents).toHaveLength(1);
    const s = statsEvents[0] as Extract<RunEvent, { kind: "llm_call_stats" }>;
    expect(s.outputTokens).toBe(10);
    expect(s.inputTokens).toBe(8);
  });

  it("does not emit llm_call_stats when stream throws (non-streaming fallback used)", async () => {
    const errorLlm: LlmClient = {
      chat: {
        completions: {
          create: ((params: Record<string, unknown>) => {
            if (params.stream) throw new Error("stream error");
            return Promise.resolve({
              choices: [{ message: { content: '{"x":2}' }, finish_reason: "stop" }],
              usage: { completion_tokens: 5 },
            });
          }) as LlmClient["chat"]["completions"]["create"],
        },
      },
    };
    const events: RunEvent[] = [];
    await parseWithRetry({
      llm: errorLlm,
      model: "m",
      baseMessages: [{ role: "user", content: "q" }],
      opts: {},
      schema: z.object({ x: z.number() }),
      maxRetries: 0,
      callSite: "query.seeds",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
    });
    const statsEvents = events.filter(e => e.kind === "llm_call_stats");
    expect(statsEvents).toHaveLength(0);
  });
});
