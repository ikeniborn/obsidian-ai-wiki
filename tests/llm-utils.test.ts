import { describe, it, expect } from "vitest";
import { buildChatParams, stripThinking, parseStructured, extractStreamDeltas, extractUsage, isJsonModeError, wrapWithJsonFallback, wrapStreamWithStats, buildLlmCallStatsEvent, computeSpeedText } from "../src/phases/llm-utils";
import type { LlmStreamStats } from "../src/phases/llm-utils";
import type OpenAI from "openai";
import type { LlmClient } from "../src/types";
import baseContract from "../prompts/base.md";

describe("buildChatParams — User prompt injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("appends User prompt as ## Уточнение section", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "Используй формальный стиль." });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(
      `${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nИспользуй формальный стиль.`,
    );
  });

  it("does not modify messages when systemPrompt is empty", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("does not modify messages when systemPrompt is absent", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("creates system message when none exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, { systemPrompt: "note" });
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(`${baseContract}\n\n## Уточнение\nnote`);
  });
});

describe("buildChatParams — base contract injection", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Phase system prompt." },
    { role: "user", content: "question" },
  ];

  it("prepends base contract before phase prompt", () => {
    const params = buildChatParams("m", messages, {});
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.`);
  });

  it("base contract is first: before phase prompt and before Уточнение", () => {
    const params = buildChatParams("m", messages, { systemPrompt: "note" });
    const sys = (params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0];
    expect(sys.content).toBe(`${baseContract}\n\nPhase system prompt.\n\n## Уточнение\nnote`);
  });

  it("prepends base contract when no system message exists", () => {
    const noSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "q" },
    ];
    const params = buildChatParams("m", noSystem, {});
    const msgs = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(baseContract);
  });
});

describe("stripThinking", () => {
  it("returns text unchanged when no think tags", () => {
    expect(stripThinking('{"key": "val"}')).toBe('{"key": "val"}');
  });

  it("removes single <think> block and returns only JSON", () => {
    const input = '<think>\nsome reasoning {temp: 1}\n</think>\n{"key": "val"}';
    expect(stripThinking(input)).toBe('{"key": "val"}');
  });

  it("removes multiple <think> blocks", () => {
    const input = '<think>first</think> middle <think>second</think> end';
    expect(stripThinking(input)).toBe('middle  end');
  });

  it("does not corrupt JSON when { inside <think>", () => {
    const input = '<think>Could be {"temp": 1} or other</think>\n{"real": true}';
    expect(stripThinking(input)).toBe('{"real": true}');
  });
});

describe("parseStructured", () => {
  it("parses clean JSON directly", () => {
    expect(parseStructured('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips <think> and parses JSON after", () => {
    const input = '<think>{"fake": true}\n</think>\n{"real": 42}';
    expect(parseStructured(input)).toEqual({ real: 42 });
  });

  it("throws when no JSON object found", () => {
    expect(() => parseStructured("no json here")).toThrow("No JSON object found");
  });

  it("handles nested objects correctly", () => {
    const input = '{"outer": {"inner": [1, 2]}}';
    expect(parseStructured(input)).toEqual({ outer: { inner: [1, 2] } });
  });

  it("strips ```json fences and parses", () => {
    const input = "```json\n{\"a\": 1}\n```";
    expect(parseStructured(input)).toEqual({ a: 1 });
  });

  it("strips plain ``` fences without language and parses", () => {
    const input = "```\n{\"b\": 2}\n```";
    expect(parseStructured(input)).toEqual({ b: 2 });
  });

  it("strips <think>...</think> followed by fenced JSON", () => {
    const input = "<think>reasoning</think>\n```json\n{\"c\": 3}\n```";
    expect(parseStructured(input)).toEqual({ c: 3 });
  });

  it("strips fences around top-level JSON array (regex fallback would fail)", () => {
    const input = "```json\n[1, 2, 3]\n```";
    expect(parseStructured(input)).toEqual([1, 2, 3]);
  });
});

describe("buildChatParams — response_format", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: "q" },
  ];

  it("sets response_format json_object when jsonMode=json_object", () => {
    const params = buildChatParams("m", messages, { jsonMode: "json_object" });
    expect((params.response_format as { type: string }).type).toBe("json_object");
  });

  it("no response_format when jsonMode absent", () => {
    const params = buildChatParams("m", messages, {});
    expect(params.response_format).toBeUndefined();
  });
});

describe("buildChatParams — stream_options.include_usage", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: "q" }];

  it("adds stream_options.include_usage when stream=true", () => {
    const params = buildChatParams("m", messages, {}, true);
    expect(params.stream_options).toEqual({ include_usage: true });
  });

  it("omits stream_options when stream=false (default)", () => {
    const params = buildChatParams("m", messages, {});
    expect(params.stream_options).toBeUndefined();
  });
});

describe("extractStreamDeltas — usage", () => {
  it("returns outputTokens from chunk.usage.completion_tokens", () => {
    const chunk = {
      choices: [{ delta: { content: "x" }, index: 0, finish_reason: null }],
      usage: { completion_tokens: 123, prompt_tokens: 10, total_tokens: 133 },
    } as unknown as OpenAI.Chat.ChatCompletionChunk;
    const r = extractStreamDeltas(chunk);
    expect(r.outputTokens).toBe(123);
    expect(r.content).toBe("x");
  });

  it("returns undefined outputTokens when usage absent", () => {
    const chunk = {
      choices: [{ delta: { content: "y" }, index: 0, finish_reason: null }],
    } as unknown as OpenAI.Chat.ChatCompletionChunk;
    const r = extractStreamDeltas(chunk);
    expect(r.outputTokens).toBeUndefined();
  });
});

describe("extractUsage — non-stream", () => {
  it("returns completion_tokens from response.usage", () => {
    const resp = {
      choices: [{ message: { content: "x", role: "assistant" }, finish_reason: "stop", index: 0 }],
      usage: { completion_tokens: 42, prompt_tokens: 10, total_tokens: 52 },
    } as unknown as OpenAI.Chat.ChatCompletion;
    expect(extractUsage(resp)).toBe(42);
  });

  it("returns undefined when usage absent", () => {
    const resp = {
      choices: [{ message: { content: "x", role: "assistant" }, finish_reason: "stop", index: 0 }],
    } as unknown as OpenAI.Chat.ChatCompletion;
    expect(extractUsage(resp)).toBeUndefined();
  });
});

describe("isJsonModeError", () => {
  it("true for status 400 with response_format keyword", () => {
    const e = Object.assign(new Error("response_format not supported"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for status 422 with json_object keyword", () => {
    const e = Object.assign(new Error("Unsupported json_object mode"), { status: 422 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for keyword 'json mode'", () => {
    const e = Object.assign(new Error("provider does not support json mode"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for keyword 'unsupported'", () => {
    const e = Object.assign(new Error("Unsupported response format"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("false for 401/403/429/500", () => {
    for (const status of [401, 403, 429, 500]) {
      const e = Object.assign(new Error("response_format unsupported"), { status });
      expect(isJsonModeError(e)).toBe(false);
    }
  });
  it("false for 400 without trigger keyword", () => {
    const e = Object.assign(new Error("Invalid prompt token"), { status: 400 });
    expect(isJsonModeError(e)).toBe(false);
  });
  it("false for non-Error values", () => {
    expect(isJsonModeError("string error")).toBe(false);
    expect(isJsonModeError(null)).toBe(false);
  });
});

function makeMockLlm(handler: (params: Record<string, unknown>) => unknown): LlmClient {
  return {
    chat: {
      completions: {
        create: ((params: Record<string, unknown>) => Promise.resolve(handler(params))) as unknown as LlmClient["chat"]["completions"]["create"],
      },
    },
  };
}

describe("wrapWithJsonFallback — non-streaming", () => {
  it("retries without response_format on json-mode error", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner = makeMockLlm((params) => {
      calls.push(params);
      if (params.response_format) {
        const e = Object.assign(new Error("response_format unsupported"), { status: 400 });
        throw e;
      }
      return { choices: [{ message: { content: "ok", role: "assistant" }, index: 0, finish_reason: "stop" }] };
    });
    const wrapped = wrapWithJsonFallback(inner);
    const resp = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    expect(calls.length).toBe(2);
    expect(calls[0].response_format).toBeDefined();
    expect(calls[1].response_format).toBeUndefined();
    expect((resp as OpenAI.Chat.ChatCompletion).choices[0].message.content).toBe("ok");
  });

  it("rethrows non-json-mode errors without retry", async () => {
    let count = 0;
    const inner = makeMockLlm(() => {
      count++;
      throw Object.assign(new Error("quota exceeded"), { status: 429 });
    });
    const wrapped = wrapWithJsonFallback(inner);
    await expect(wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)).rejects.toThrow("quota exceeded");
    expect(count).toBe(1);
  });

  it("passes through when no response_format", async () => {
    let count = 0;
    const inner = makeMockLlm(() => {
      count++;
      return { choices: [{ message: { content: "x", role: "assistant" }, index: 0, finish_reason: "stop" }] };
    });
    const wrapped = wrapWithJsonFallback(inner);
    await wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    expect(count).toBe(1);
  });
});

// Helper: create async iterable from array of partial chunks
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

describe("wrapWithJsonFallback — streaming", () => {
  it("retries when stream rejects at create()", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.reject(Object.assign(new Error("response_format not supported"), { status: 400 }));
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "hello" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as unknown as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
  });

  it("retries when stream throws before first content chunk", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.resolve((async function* () {
            yield { choices: [{ delta: { role: "assistant" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
            throw Object.assign(new Error("json_object unsupported"), { status: 400 });
          })());
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "fallback ok" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as unknown as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks.some((c) => c.choices[0].delta.content === "fallback ok")).toBe(true);
  });

  it("does NOT retry after first content delta", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "partial" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
          throw Object.assign(new Error("response_format unsupported"), { status: 400 });
        })());
      }) as unknown as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    await expect((async () => {
      for await (const _ of stream) { /* drain */ }
    })()).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it("reasoning-only chunks don't count as content (retry still possible)", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.resolve((async function* () {
            yield { choices: [{ delta: { reasoning: "thinking..." }, index: 0, finish_reason: null }] } as unknown as OpenAI.Chat.ChatCompletionChunk;
            throw Object.assign(new Error("json_object not supported"), { status: 400 });
          })());
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "after-retry" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as unknown as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks.some((c) => c.choices[0].delta.content === "after-retry")).toBe(true);
  });
});

describe("extractStreamDeltas — inputTokens", () => {
  it("extracts prompt_tokens as inputTokens from usage chunk", () => {
    const chunk = {
      choices: [{ delta: {} }],
      usage: { completion_tokens: 20, prompt_tokens: 100 },
    } as unknown as OpenAI.Chat.ChatCompletionChunk;
    const result = extractStreamDeltas(chunk);
    expect(result.inputTokens).toBe(100);
  });

  it("returns undefined inputTokens when usage absent", () => {
    const chunk = {
      choices: [{ delta: { content: "hi" } }],
    } as OpenAI.Chat.ChatCompletionChunk;
    const result = extractStreamDeltas(chunk);
    expect(result.inputTokens).toBeUndefined();
  });
});

describe("wrapStreamWithStats", () => {
  it("yields all chunks from wrapped stream", async () => {
    const chunks = [
      { choices: [{ delta: { content: "hello" } }] },
      { choices: [{ delta: { content: " world" } }] },
      { choices: [{ delta: {} }], usage: { completion_tokens: 5, prompt_tokens: 10 } },
    ];
    const { stream } = wrapStreamWithStats(makeStream(chunks), Date.now());
    const received: unknown[] = [];
    for await (const c of stream) received.push(c);
    expect(received).toHaveLength(3);
  });

  it("getStats() returns undefined when stream yields no chunks", async () => {
    const { stream, getStats } = wrapStreamWithStats(makeStream([]), Date.now());
    for await (const _ of stream) { /* drain */ }
    expect(getStats()).toBeUndefined();
  });

  it("getStats() returns stats after stream is drained", async () => {
    const chunks = [
      { choices: [{ delta: { content: "a" } }] },
      { choices: [{ delta: {} }], usage: { completion_tokens: 7, prompt_tokens: 15 } },
    ];
    const before = Date.now();
    const { stream, getStats } = wrapStreamWithStats(makeStream(chunks), before);
    for await (const _ of stream) { /* drain */ }
    const stats = getStats();
    expect(stats).toBeDefined();
    expect(stats!.outputTokens).toBe(7);
    expect(stats!.inputTokens).toBe(15);
    expect(stats!.ttftMs).toBeGreaterThanOrEqual(0);
    expect(stats!.llmDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("computeSpeedText", () => {
  it("returns empty string for empty stats array", () => {
    expect(computeSpeedText([])).toBe("");
  });

  it("returns empty string when total llmDurationMs is 0", () => {
    const stats = [{ inputTokens: 100, outputTokens: 50, ttftMs: 100, llmDurationMs: 0 }];
    expect(computeSpeedText(stats)).toBe("");
  });

  it("formats single call correctly with token counts", () => {
    // 200 in / 2s = 100 in tok/s; 100 out / 2s = 50 out tok/s; median ttft = 300ms
    const stats = [{ inputTokens: 200, outputTokens: 100, ttftMs: 300, llmDurationMs: 2000 }];
    expect(computeSpeedText(stats)).toBe(" in: 200 tok (100 tok/s) · out: 100 tok (50 tok/s) · latency: 300ms");
  });

  it("aggregates multiple calls and uses median TTFT", () => {
    const stats = [
      { inputTokens: 100, outputTokens: 50, ttftMs: 500, llmDurationMs: 1000 },
      { inputTokens: 100, outputTokens: 50, ttftMs: 200, llmDurationMs: 1000 },
      { inputTokens: 100, outputTokens: 50, ttftMs: 300, llmDurationMs: 1000 },
    ];
    // sorted ttftMs: [200, 300, 500], median index = floor(3/2) = 1 → 300ms
    // total: 300 in / 3s = 100 tok/s; 150 out / 3s = 50 tok/s
    const result = computeSpeedText(stats);
    expect(result).toContain("latency: 300ms");
    expect(result).toContain("in: 300 tok (100 tok/s)");
    expect(result).toContain("out: 150 tok (50 tok/s)");
  });
});

describe("buildLlmCallStatsEvent", () => {
  it("computes tok/s from duration", () => {
    const s: LlmStreamStats = { inputTokens: 200, outputTokens: 100, ttftMs: 300, llmDurationMs: 2000 };
    const ev = buildLlmCallStatsEvent(s);
    expect(ev.kind).toBe("llm_call_stats");
    expect(ev.inTokPerSec).toBe(100);  // 200 / 2
    expect(ev.outTokPerSec).toBe(50);  // 100 / 2
  });

  it("returns 0 tok/s when llmDurationMs is 0", () => {
    const s: LlmStreamStats = { inputTokens: 100, outputTokens: 50, ttftMs: 100, llmDurationMs: 0 };
    const ev = buildLlmCallStatsEvent(s);
    expect(ev.inTokPerSec).toBe(0);
    expect(ev.outTokPerSec).toBe(0);
  });
});
