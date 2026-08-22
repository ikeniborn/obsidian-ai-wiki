import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register } from "node:module";
import test from "node:test";
import OpenAI from "openai";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
import { fetch as undiciFetch } from "undici";
import { z } from "zod";
import type { LlmClient, NativeChatCompletionCreate, RunEvent } from "../src/types";
import { createNativeLlmClient } from "../src/native-llm-executor";
import { parseAnswerFrames, parseSentinelJson, parseSynthesisFrames } from "../src/phases/framed-output";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { parseWithRetry } = await import("../src/phases/parse-with-retry");
const {
  completionReasoning,
  computeSpeedText,
  runWithLiveEvents,
  shouldFallbackStreamToNonStream,
} = await import("../src/phases/llm-utils");
const {
  createLlmLifecycle,
  outputRetryOptions,
  runStructuredWithRetry,
  runStructuredStreaming,
  StructuredValidationError,
  StructuredOutputTruncatedError,
} = await import("../src/phases/structured-output");

function lifecycleFor(callSite: "query.seeds" | "query.answer") {
  return createLlmLifecycle(callSite === "query.answer"
    ? "answer_question"
    : "select_relevant_pages");
}

const SmallSchema = z.object({
  value: z.string(),
});

const AnswerSchema = z.object({
  reasoning: z.string(),
  answer_markdown: z.string(),
  citations: z.array(z.string()),
});

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(promptTokens: number = 2): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: 3, total_tokens: promptTokens + 3 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function llmFromChunks(chunks: OpenAI.Chat.ChatCompletionChunk[]): LlmClient {
  return {
    chat: {
      completions: {
        create: async () => (async function* () {
          for (const value of chunks) yield value;
        })(),
      },
    },
  } as unknown as LlmClient;
}

function llmFromAttempts(attempts: Array<string | Error>, seenParams: Record<string, unknown>[] = []): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          seenParams.push(params as Record<string, unknown>);
          const next = attempts[i++] ?? "";
          if (next instanceof Error) throw next;
          return (async function* () {
            if (next) yield chunk(next);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function isTestJsonModeError(e: unknown): boolean {
  return Boolean(
    e
      && typeof e === "object"
      && (e as { status?: unknown }).status === 400
      && String((e as { message?: unknown }).message ?? "").includes("response_format"),
  );
}

function jsonModeError(): Error & { status: number } {
  const err = new Error("response_format json_object is unsupported in json mode") as Error & { status: number };
  err.status = 400;
  return err;
}

test("json-zod valid JSON succeeds without structural error", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":"ok"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "ok");
  assert.equal(result.inputTokens, 2);
  assert.equal(events.some((ev) => ev.kind === "structural_error"), false);
  assert.equal(events.some((ev) => ev.kind === "llm_call_stats"), true);
});

test("structured transport defaults to streaming", async () => {
  const requests: Array<Record<string, unknown>> = [];

  await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":"ok"}'], requests),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].stream, true);
});

test("non-stream structured transport makes one direct request", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          return {
            id: "completion",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"value":"ok"}', refusal: null },
              logprobs: null,
            }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          };
        },
      },
    },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
    transport: "non-stream",
  });

  assert.equal(result.value.value, "ok");
  assert.equal(result.inputTokens, 2);
  assert.equal(result.outputTokens, 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].stream, false);
});

test("non-stream response-format fallback stays non-stream", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          if (requests.length === 1) throw jsonModeError();
          return {
            id: "completion",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"value":"fallback"}', refusal: null },
              logprobs: null,
            }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          };
        },
      },
    },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });

  assert.equal(result.value.value, "fallback");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.stream === false));
  assert.equal(
    (requests[0].response_format as { type?: string }).type,
    "json_schema",
  );
  assert.equal(
    (requests[1].response_format as { type?: string }).type,
    "json_object",
  );
  assert.ok(events.some((event) =>
    event.kind === "structural_error"
    && event.errorType === "response_format_fallback"));
});

test("usage-free streams keep prompt usage undefined", async () => {
  const events: RunEvent[] = [];
  const result = await runStructuredWithRetry({
    llm: llmFromChunks([chunk('{"value":"ok"}')]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  const stats = events.find((event) => event.kind === "llm_call_stats");
  assert.equal(result.inputTokens, undefined);
  assert.equal(stats?.kind === "llm_call_stats" ? stats.inputTokens : null, undefined);
});

test("an observed zero prompt usage remains zero", async () => {
  const result = await runStructuredWithRetry({
    llm: llmFromChunks([chunk('{"value":"ok"}'), usageChunk(0)]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.inputTokens, 0);
});

test("speed text reports unknown aggregate input usage as n/a", () => {
  const text = computeSpeedText([
    { inputTokens: 100, outputTokens: 20, ttftMs: 100, llmDurationMs: 1_000 },
    { outputTokens: 10, ttftMs: 200, llmDurationMs: 1_000 },
  ]);

  assert.equal(text, " in: n/a · out: 30 tok (15 tok/s) · latency: 200ms");
});

test("speed text preserves observed zero input usage", () => {
  const text = computeSpeedText([
    { inputTokens: 0, outputTokens: 5, ttftMs: 10, llmDurationMs: 1_000 },
  ]);

  assert.equal(text, " in: 0 tok (0 tok/s) · out: 5 tok (5 tok/s) · latency: 10ms");
});

test("speed text aggregates all-known input usage", () => {
  const text = computeSpeedText([
    { inputTokens: 100, outputTokens: 20, ttftMs: 100, llmDurationMs: 1_000 },
    { inputTokens: 50, outputTokens: 10, ttftMs: 200, llmDurationMs: 1_000 },
  ]);

  assert.equal(text, " in: 150 tok (75 tok/s) · out: 30 tok (15 tok/s) · latency: 200ms");
});

test("non-stream fallback returns prompt usage", async () => {
  let requests = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: { stream?: boolean }) => {
          requests += 1;
          if (params.stream) throw new Error("stream transport unavailable");
          return {
            id: "completion",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"value":"fallback"}', refusal: null },
              logprobs: null,
            }],
            usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
          };
        },
      },
    },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(requests, 2);
  assert.equal(result.value.value, "fallback");
  assert.equal(result.inputTokens, 11);
});

test("HTTP 502 structured failure is not replayed as non-stream", async () => {
  let requests = 0;
  const error = Object.assign(new Error("Bad Gateway"), { status: 502 });
  const llm = {
    chat: {
      completions: {
        create: async () => {
          requests += 1;
          throw error;
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  }), error);

  assert.equal(requests, 1);
});

test("OpenAI connection failures are not replayed as non-stream", async () => {
  for (const error of [
    new APIConnectionError({ message: "Connection failed" }),
    new APIConnectionTimeoutError({ message: "Connection timed out" }),
  ]) {
    let requests = 0;
    const llm = {
      chat: {
        completions: {
          create: async () => {
            requests += 1;
            throw error;
          },
        },
      },
    } as unknown as LlmClient;

    await assert.rejects(runStructuredWithRetry({
      llm,
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: {},
      profile: { kind: "json-zod", schema: SmallSchema },
      maxRetries: 0,
      callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
      signal: new AbortController().signal,
      onEvent: () => {},
    }), error);

    assert.equal(requests, 1, error.constructor.name);
  }
});

test("body-read transport failures are not eligible for non-stream fallback", () => {
  const undiciSocket = Object.assign(new Error("other side closed"), {
    name: "SocketError",
    code: "UND_ERR_SOCKET",
  });
  const cases: Error[] = [
    new TypeError("terminated", { cause: undiciSocket }),
    new TypeError("fetch failed"),
    Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
    new Error("socket disconnected"),
  ];

  for (const error of cases) {
    assert.equal(
      shouldFallbackStreamToNonStream(error),
      false,
      `${error.name}: ${error.message}`,
    );
  }
  assert.equal(
    shouldFallbackStreamToNonStream(new Error("stream transport unavailable")),
    true,
  );
});

test("actual OpenAI SSE disconnect after partial content is propagated without replay", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      id: "partial",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{
        index: 0,
        delta: { content: '{"value":"partial' },
        finish_reason: null,
      }],
    })}\n\n`);
    setImmediate(() => response.socket?.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const events: RunEvent[] = [];
  const client = new OpenAI({
    apiKey: "test",
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    maxRetries: 0,
    fetch: undiciFetch as unknown as typeof fetch,
  });

  try {
    await assert.rejects(runStructuredWithRetry({
      llm: client as unknown as LlmClient,
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: {},
      profile: { kind: "json-zod", schema: SmallSchema },
      maxRetries: 0,
      callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    }), (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /terminated|fetch failed/i);
      assert.equal((error.cause as { code?: string } | undefined)?.code, "UND_ERR_SOCKET");
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(
      events.some((event) =>
        event.kind === "assistant_text"
        && event.delta === '{"value":"partial'),
      true,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("finish_reason length rejects syntactically valid structured JSON without transport fallback", async () => {
  let requests = 0;
  const llm = {
    chat: { completions: { create: async () => {
      requests++;
      return (async function* () {
        yield {
          ...chunk('{"value":"complete"}'),
          choices: [{ index: 0, delta: { content: '{"value":"complete"}' }, finish_reason: "length" }],
        } as OpenAI.Chat.ChatCompletionChunk;
        yield usageChunk();
      })();
    } } },
  } as unknown as LlmClient;
  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  }), StructuredOutputTruncatedError);
  assert.equal(requests, 1);
});

test("non-stream length fallback rejects valid JSON after exactly two underlying requests", async () => {
  let requests = 0;
  const llm = {
    chat: { completions: { create: async (params: { stream?: boolean }) => {
      requests++;
      if (params.stream) throw new Error("stream transport unavailable");
      return {
        id: "completion", object: "chat.completion", created: 0, model: "m",
        choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: '{"value":"complete"}' } }],
        usage: { prompt_tokens: 13, completion_tokens: 4, total_tokens: 17 },
      };
    } } },
  } as unknown as LlmClient;
  await assert.rejects(runStructuredWithRetry({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }], opts: {},
    profile: { kind: "json-zod", schema: SmallSchema }, maxRetries: 0, callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal, onEvent: () => {},
  }), StructuredOutputTruncatedError);
  assert.equal(requests, 2);
});

test("context deadline errors retain normal stream-to-non-stream fallback", async () => {
  let requests = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: { stream?: boolean }) => {
          requests += 1;
          if (params.stream) throw new Error("context deadline exceeded");
          return {
            id: "completion",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"value":"fallback"}', refusal: null },
              logprobs: null,
            }],
          };
        },
      },
    },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(requests, 2);
  assert.equal(result.value.value, "fallback");
});

test("context errors bypass identical stream-to-non-stream fallback", async () => {
  let requests = 0;
  const contextError = Object.assign(
    new Error("prompt size 565000 exceeds maximum context 524288"),
    { code: "context_length_exceeded" },
  );
  const llm = {
    chat: {
      completions: {
        create: async () => {
          requests += 1;
          throw contextError;
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  }), contextError);

  assert.equal(requests, 1);
});

test("context overflow takes precedence over JSON-mode fallback", async () => {
  let requests = 0;
  const events: RunEvent[] = [];
  const contextError = Object.assign(
    new Error("response_format unsupported: prompt size 565000 exceeds maximum context 524288"),
    { status: 400 },
  );
  const llm = {
    chat: {
      completions: {
        create: async () => {
          requests += 1;
          throw contextError;
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  }), contextError);

  assert.equal(requests, 1);
  assert.equal(
    events.some((event) =>
      event.kind === "structural_error"
      && event.errorType === "response_format_fallback"),
    false,
  );
});

test("explicit input-count context errors also bypass transport fallback", async () => {
  let requests = 0;
  const contextError = new Error(
    "input token count 565000 exceeds maximum number of tokens allowed 524288",
  );
  const llm = {
    chat: {
      completions: {
        create: async () => {
          requests += 1;
          throw contextError;
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  }), contextError);

  assert.equal(requests, 1);
});

test("empty JSON output downgrades response formats and validates recovered JSON", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["", "", '{"value":"recovered"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 2,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "recovered");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "empty_output"),
    true,
  );
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object", "none"],
  );
});

test("output-cap empty response uses output_limit and a fresh compact retry with a dynamic ceiling", async () => {
  const events: RunEvent[] = [];
  const seen: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      seen.push(params);
      attempt += 1;
      const content = attempt === 1 ? "" : '{"value":"ok"}';
      const completionTokens = attempt === 1 ? 100 : 3;
      return {
        id: `completion-${attempt}`,
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 2, completion_tokens: completionTokens, total_tokens: 2 + completionTokens },
      };
    } } },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "Return a compact object." }],
    opts: { maxTokens: 100, outputRetryBudgetTokens: 300 } as never,
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });

  assert.equal(result.value.value, "ok");
  assert.equal(events.some((event) => event.kind === "structural_error" && event.errorType === "output_limit"), true);
  assert.deepEqual(seen.map((params) => params.max_completion_tokens), [100, 150]);
  const retryMessages = seen[1].messages as Array<{ role: string; content: string }>;
  assert.equal(retryMessages.some((message) => message.role === "assistant"), false);
  assert.match(retryMessages.at(-1)?.content ?? "", /output limit/i);
});

test("output-cap malformed response also bypasses replay and uses output_limit retry", async () => {
  const events: RunEvent[] = [];
  const seen: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      seen.push(params);
      attempt += 1;
      const content = attempt === 1 ? '{"value":' : '{"value":"ok"}';
      const completionTokens = attempt === 1 ? 100 : 3;
      return {
        id: `completion-${attempt}`,
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 2, completion_tokens: completionTokens, total_tokens: 2 + completionTokens },
      };
    } } },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "Return a compact object." }],
    opts: { maxTokens: 100, outputRetryBudgetTokens: 300 } as never,
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });

  assert.equal(result.value.value, "ok");
  assert.equal(events.some((event) => event.kind === "structural_error" && event.errorType === "output_limit"), true);
  const retryMessages = seen[1].messages as Array<{ role: string; content: string }>;
  assert.equal(retryMessages.some((message) => message.role === "assistant"), false);
  assert.equal(retryMessages.some((message) => message.content.includes('{"value":')), false);
});

test("backend json-mode error downgrades and recovers", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts([jsonModeError(), '{"value":"fallback"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "fallback");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object"],
  );
});

test("schema retry recovery emits succeeded structural_error event", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":42}', '{"value":"recovered"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "recovered");
  assert.equal(
    events.some((ev) =>
      ev.kind === "structural_error"
      && ev.errorType === "schema_validate"
      && ev.retryAttempt === 1
      && ev.succeeded === true
      && ev.message === "retry succeeded"),
    true,
  );
});

test("schema repair retry stays within input budget by compacting previous invalid output", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];
  // 12_000 characters of noise: the character-class rules price plain letters
  // near half the old flat rate, so the invalid output has to be larger to keep
  // the full repair above the budget the way this test intends.
  const largeInvalid = JSON.stringify({ value: 42, noise: "x".repeat(12_000) });

  // Rescaled twice for the token estimator: from a byte-era budget of 3_000,
  // then to 1_000 once the character-class rules priced the repair envelope
  // above the old flat rate. It is still smaller than the full repair (base +
  // verbatim invalid output), forcing the compact repair path.
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts([largeInvalid, '{"value":"recovered"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x".repeat(650) }],
    opts: { inputBudgetTokens: 1_000 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "recovered");
  assert.equal(seenParams.length, 2);
  const retryMessages = seenParams[1].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const retryText = JSON.stringify(retryMessages);
  assert.equal(retryText.includes("x".repeat(3_000)), false);
  assert.match(retryText, /Previous response was too large to include/);
  assert.equal(
    events.some((ev) =>
      ev.kind === "structural_error"
      && ev.errorType === "schema_validate"
      && ev.retryAttempt === 1
      && ev.succeeded === true),
    true,
  );
});

test("json-zod repair instruction is profile-local and absent by default", async () => {
  const defaultRequests: Record<string, unknown>[] = [];
  await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":42}', '{"value":"ok"}'], defaultRequests),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  const instructedRequests: Record<string, unknown>[] = [];
  await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":42}', '{"value":"ok"}'], instructedRequests),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: {
      kind: "json-zod",
      schema: SmallSchema,
      repairInstruction: "PROFILE-LOCAL-REPAIR",
    },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  const lastUserText = (request: Record<string, unknown>) =>
    ((request.messages as Array<{ role?: string; content?: unknown }>).filter(
      (message) => message.role === "user" && typeof message.content === "string",
    ).at(-1)?.content ?? "") as string;
  assert.doesNotMatch(lastUserText(defaultRequests[1]), /PROFILE-LOCAL-REPAIR/);
  assert.match(lastUserText(instructedRequests[1]), /PROFILE-LOCAL-REPAIR/);
});

test("json-zod with jsonMode unset starts with json_schema response_format", async () => {
  const seenParams: Record<string, unknown>[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal((seenParams[0]?.response_format as { type?: string } | undefined)?.type, "json_schema");
});

test("structured json calls ignore provider thinking controls", async () => {
  const seenParams: Record<string, unknown>[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema", thinkingBudgetTokens: 512 },
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal("thinking" in seenParams[0], false);
  assert.equal((seenParams[0]?.response_format as { type?: string } | undefined)?.type, "json_schema");
});

test("structured requests emit metadata-only request fingerprints", async () => {
  const events: RunEvent[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "SECRET_SOURCE" }],
    opts: { jsonMode: "json_schema", maxTokens: 4096, inputBudgetTokens: 16_384 },
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  const fingerprint = events.find((event) => event.kind === "llm_request_fingerprint");
  assert.ok(fingerprint && fingerprint.kind === "llm_request_fingerprint");
  assert.equal(fingerprint.callSite, "query.seeds");
  assert.equal(fingerprint.model, "m");
  assert.equal(fingerprint.transport, "stream");
  assert.equal(fingerprint.stream, true);
  assert.equal(fingerprint.outputBudget, 4096);
  assert.equal(fingerprint.responseFormatType, "json_schema");
  assert.equal(fingerprint.responseFormatName, "query_seeds");
  assert.equal(fingerprint.messageCharLengths.length, 2);
  assert.ok(fingerprint.messageCharLengths.every((length) => length > 0));
  assert.match(fingerprint.preparedMessagesHash, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(JSON.stringify(fingerprint).includes("SECRET_SOURCE"), false);
});

test("json-zod with jsonMode false sends no response_format", async () => {
  const seenParams: Record<string, unknown>[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: false },
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(seenParams[0]?.response_format, undefined);
});

test("runner emits response-format fallback without hidden client wrapper", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts([jsonModeError(), '{"value":"visible"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "visible");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object"],
  );
});

test("framed-zod parses parseAnswerFrames and validates schema", async () => {
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["<<<ANSWER>>>\nAnswer\n<<<CITATIONS>>>\n- wiki_a\n<<<END>>>"]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: {
      kind: "framed-zod",
      schema: AnswerSchema,
      parse: parseAnswerFrames,
      repairInstruction: "Return answer frames only.",
    },
    maxRetries: 1,
    callSite: "query.answer",
    lifecycle: lifecycleFor("query.answer"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.value.answer_markdown, "Answer");
  assert.deepEqual(result.value.citations, ["wiki_a"]);
});

test("parseSentinelJson parses framed JSON and accepts legacy raw JSON", () => {
  assert.deepEqual(
    parseSentinelJson('<<<JSON>>>\n{"value":"ok"}\n<<<END>>>'),
    { value: "ok" },
  );
  assert.deepEqual(parseSentinelJson('{"value":"ok"}'), { value: "ok" });
  assert.throws(
    () => parseSentinelJson('<<<JSON>>>\n{"value":"ok"}'),
    /missing <<<END>>>/,
  );
});

test("parseSynthesisFrames keeps create and patch markdown outside JSON", () => {
  const parsed = parseSynthesisFrames([
    "<<<REASONING>>>",
    "bounded result",
    "<<<CREATE>>>",
    "entityKey: alpha",
    "path: !Wiki/d/concept/wiki_d_alpha.md",
    "annotation: Alpha page",
    "<<<CONTENT>>>",
    "# Alpha",
    "",
    "```json",
    "{not required to be escaped}",
    "```",
    "<<<END_CREATE>>>",
    "<<<PATCH>>>",
    "entityKey: beta",
    "path: !Wiki/d/concept/wiki_d_beta.md",
    "expectedPageHash: page-hash",
    "<<<SECTION>>>",
    "operation: replace",
    "heading: ## Facts",
    "expectedSectionOrdinal: 0",
    "expectedSectionHash: section-hash",
    "<<<CONTENT>>>",
    "replacement with \"quotes\" and \\slashes",
    "<<<END_SECTION>>>",
    "<<<END_PATCH>>>",
    "<<<SKIP>>>",
    "entityKey: gamma",
    "reason: no change",
    "<<<END_SKIP>>>",
    "<<<END>>>",
  ].join("\n"));

  assert.equal(parsed.reasoning, "bounded result");
  assert.equal(parsed.actions[0].kind, "create");
  assert.match(parsed.actions[0].kind === "create" ? parsed.actions[0].content : "", /\{not required/);
  assert.equal(parsed.actions[1].kind, "patch");
  assert.equal(parsed.actions[1].kind === "patch" ? parsed.actions[1].sections[0].content : "", 'replacement with "quotes" and \\slashes');
  assert.deepEqual(parsed.skips, [{ entityKey: "gamma", reason: "no change" }]);
});

test("framed-zod invalid frames emit frame_parse and throw StructuredValidationError", async () => {
  const events: RunEvent[] = [];

  await assert.rejects(
    runStructuredWithRetry({
      llm: llmFromAttempts(["bad", "still bad"]),
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: {},
      profile: {
        kind: "framed-zod",
        schema: AnswerSchema,
        parse: parseAnswerFrames,
        repairInstruction: "Return answer frames only.",
      },
      maxRetries: 1,
      callSite: "query.answer",
    lifecycle: lifecycleFor("query.answer"),
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
    }),
    StructuredValidationError,
  );

  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "frame_parse"),
    true,
  );
});

function reasoningChunk(reasoning: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "r", object: "chat.completion.chunk", created: 0, model: "m",
    choices: [{ index: 0, delta: { reasoning } as unknown as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: null }],
  };
}

test("streaming structured call emits reasoning and content deltas live", async () => {
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async () => (async function* () {
      yield reasoningChunk("thinking hard");
      yield chunk('{"value":"ok"}');
      yield usageChunk();
    })() } },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }],
    opts: {}, profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1, callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal, onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "ok");
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && ev.isReasoning === true && ev.delta === "thinking hard"),
    true,
  );
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && !ev.isReasoning && ev.delta.includes('"value"')),
    true,
  );
});

test("streaming structured call aborts a pending iterator and closes it without waiting", async () => {
  const controller = new AbortController();
  const events: RunEvent[] = [];
  let nextStarted!: () => void;
  const pendingNext = new Promise<void>((resolve) => {
    nextStarted = resolve;
  });
  let returnCalls = 0;
  const iterator: AsyncIterator<OpenAI.Chat.ChatCompletionChunk> = {
    next: () => {
      nextStarted();
      return new Promise<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>(() => {});
    },
    return: () => {
      returnCalls++;
      return new Promise<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>(() => {});
    },
  };
  const llm = {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]: () => iterator,
        }),
      },
    },
  } as unknown as LlmClient;

  const operation = runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "aborted-call", action: "select_relevant_pages" },
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  }).then(
    () => "resolved",
    (error: unknown) => error instanceof Error ? error.name : "unknown-error",
  );

  await pendingNext;
  controller.abort();
  const outcome = await Promise.race([
    operation,
    new Promise<string>((resolve) => setTimeout(() => resolve("still-pending"), 100)),
  ]);

  assert.equal(outcome, "AbortError");
  assert.equal(returnCalls, 1);
  assert.equal(
    events.some((event) =>
      event.kind === "llm_lifecycle"
      && event.id === "aborted-call"
      && event.phase === "cancelled"),
    true,
  );
});

test("runStructuredStreaming yields events live and fills the sink", async () => {
  const seen: RunEvent[] = [];
  const sink: { value?: { value: string }; inputTokens?: number; outputTokens?: number; fullText?: string } = {};
  const llm = {
    chat: { completions: { create: async () => (async function* () {
      yield reasoningChunk("live reasoning");
      yield chunk('{"value":"ok"}');
      yield usageChunk();
    })() } },
  } as unknown as LlmClient;

  for await (const ev of runStructuredStreaming({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }],
    opts: {}, profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1, callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal, onEvent: () => {},
  }, sink)) {
    seen.push(ev);
  }

  assert.equal(sink.value?.value, "ok");
  assert.equal(sink.inputTokens, 2);
  assert.equal(seen.some((ev) => ev.kind === "assistant_text" && ev.isReasoning === true), true);
});

test("runStructuredStreaming keeps missing prompt usage undefined", async () => {
  const sink: { value?: { value: string }; inputTokens?: number } = {};

  for await (const _event of runStructuredStreaming({
    llm: llmFromChunks([chunk('{"value":"ok"}')]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  }, sink)) { /* drain */ }

  assert.equal(sink.value?.value, "ok");
  assert.equal(sink.inputTokens, undefined);
});

test("runStructuredStreaming propagates a structured failure", async () => {
  const sink: { value?: unknown } = {};
  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of runStructuredStreaming({
      llm: llmFromAttempts(["bad", "still bad"]),
      model: "m", baseMessages: [{ role: "user", content: "x" }],
      opts: {}, profile: { kind: "framed-zod", schema: AnswerSchema, parse: parseAnswerFrames, repairInstruction: "x" },
      maxRetries: 1, callSite: "query.answer",
      lifecycle: { id: "failed-call", action: "answer_question" },
      signal: new AbortController().signal, onEvent: () => {},
    }, sink)) {
      events.push(event);
    }
  }, StructuredValidationError);
  assert.equal(
    events.some((event) =>
      event.kind === "llm_lifecycle"
      && event.action === "answer_question"
      && event.phase === "failed"),
    true,
  );
});

test("structured non-stream abort after transport completion closes cancelled without returning data", async () => {
  const response = deferred<OpenAI.Chat.ChatCompletion>();
  const started = deferred<void>();
  const controller = new AbortController();
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: () => {
      started.resolve();
      return response.promise;
    } } },
  } as unknown as LlmClient;
  const operation = runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "post-transport-abort", action: "select_relevant_pages" },
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });

  await started.promise;
  controller.abort();
  response.resolve({
    id: "completion",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{
      index: 0,
      message: { role: "assistant", content: '{"value":"must-not-return"}', refusal: null },
      finish_reason: "stop",
      logprobs: null,
    }],
  });

  await assert.rejects(operation, { name: "AbortError" });
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(
    lifecycle.map((event) => event.phase),
    ["preparing", "sent", "waiting", "cancelled"],
  );
  const budgets = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].requestId, "post-transport-abort");
  assert.equal(
    lifecycle.find((event) => event.phase === "cancelled")?.id,
    budgets[0].requestId,
  );
  assert.ok(lifecycle.every((event) =>
    event.diagnostics?.callSite === "query.seeds"
    && event.diagnostics.transport === "non-stream"
    && event.diagnostics.attempt === 0));
});

test("runStructuredStreaming aborts background work when the consumer returns", async () => {
  const providerAborted = deferred<void>();
  const controller = new AbortController();
  const sink: { value?: { value: string } } = {};
  const llm = {
    chat: { completions: { create: (
      _params: unknown,
      options?: { signal?: AbortSignal },
    ) => new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        providerAborted.resolve();
        const error = new Error("provider aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }) } },
  } as unknown as LlmClient;
  const generator = runStructuredStreaming({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "abandoned-consumer", action: "select_relevant_pages" },
    signal: controller.signal,
    onEvent: () => {},
  }, sink);

  const first = await generator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.kind, "llm_lifecycle");
  await generator.return();
  await Promise.race([
    providerAborted.promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("background provider was not aborted")), 2_000)),
  ]);
  await Promise.resolve();

  assert.equal(controller.signal.aborted, false, "cleanup must not mutate the caller signal");
  assert.equal(sink.value, undefined);
  assert.deepEqual(await generator.next(), { done: true, value: undefined });
});

test("runWithLiveEvents preserves an undefined rejection as an error", async () => {
  const generator = runWithLiveEvents(
    async () => Promise.reject(undefined),
    new AbortController().signal,
  );
  await assert.rejects(async () => {
    for await (const _event of generator) {
      assert.fail("undefined rejection must not emit events");
    }
  }, /Live event work rejected without an error value/);
});

test("runWithLiveEvents aborts abandoned work and rejects late queue reuse", async () => {
  const caller = new AbortController();
  const providerAborted = deferred<void>();
  let localSignal: AbortSignal | undefined;
  const generator = runWithLiveEvents(
    async (emit, operationSignal) => {
      localSignal = operationSignal;
      emit({
        kind: "llm_lifecycle",
        id: "live-abandonment",
        action: "select_relevant_pages",
        phase: "preparing",
      });
      return await new Promise<never>((_resolve, reject) => {
        operationSignal.addEventListener("abort", () => {
          for (let i = 0; i < 100_000; i++) {
            emit({
              kind: "llm_lifecycle",
              id: `late-${i}`,
              action: "select_relevant_pages",
              phase: "waiting",
            });
          }
          providerAborted.resolve();
          reject(undefined);
        }, { once: true });
      });
    },
    caller.signal,
  );

  const first = await generator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.kind, "llm_lifecycle");
  await generator.return();
  await Promise.race([
    providerAborted.promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("abandoned live work was not aborted")), 2_000)),
  ]);
  await Promise.resolve();

  assert.equal(localSignal?.aborted, true);
  assert.equal(caller.signal.aborted, false, "cleanup must not abort the caller signal");
  assert.deepEqual(await generator.next(), { done: true, value: undefined });

  const { RunEventBridge } = await import("../src/run-event-bridge");
  const bridge = new RunEventBridge();
  const blocked = deferred<void>();
  const forwarding = bridge.forward(blocked.promise);
  bridge.push({
    kind: "llm_lifecycle",
    id: "bridge-abandonment",
    action: "select_relevant_pages",
    phase: "preparing",
  });
  assert.equal((await forwarding.next()).done, false);
  await forwarding.return();
  for (let i = 0; i < 100_000; i++) {
    bridge.push({
      kind: "llm_lifecycle",
      id: `bridge-late-${i}`,
      action: "select_relevant_pages",
      phase: "waiting",
    });
  }
  await assert.rejects(
    bridge.forward(Promise.resolve("must-not-reopen")).next(),
    /abandoned/,
  );
  blocked.resolve();
});

test("structured streaming emits the ordered nonterminal lifecycle on first visible model output", async () => {
  const sink: { value?: { value: string } } = {};
  const events: RunEvent[] = [];
  const roleOnly = {
    ...chunk(""),
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  } as OpenAI.Chat.ChatCompletionChunk;

  for await (const event of runStructuredStreaming({
    llm: llmFromChunks([
      roleOnly,
      usageChunk(),
      reasoningChunk(""),
      reasoningChunk("thinking"),
      chunk('{"value":"ok"}'),
    ]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "structured-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: () => {},
  }, sink)) {
    events.push(event);
  }

  assert.equal(sink.value?.value, "ok");
  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? event.phase : ""),
    ["preparing", "sent", "waiting", "producing", "validating"],
  );
  assert.ok(events
    .filter((event) => event.kind === "llm_lifecycle")
    .every((event) =>
      event.kind === "llm_lifecycle"
      && event.id === "structured-call"
      && event.action === "select_relevant_pages"));
});

test("non-stream structured completion exposes reasoning before validation", async () => {
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: '{"value":"ok"}',
              reasoning_content: "compat reasoning",
            },
          }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      },
    },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "non-stream-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });

  assert.equal(result.value.value, "ok");
  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? event.phase : ""),
    ["preparing", "sent", "waiting", "producing", "validating"],
  );
  assert.ok(events.some((event) =>
    event.kind === "assistant_text"
    && event.isReasoning
    && event.delta === "compat reasoning"));
});

test("OpenAI executor emits one ordered non-stream lifecycle", async () => {
  const completion = {
    id: "parity",
    object: "chat.completion" as const,
    created: 0,
    model: "m",
    choices: [{
      index: 0,
      finish_reason: "stop" as const,
      logprobs: null,
      message: { role: "assistant" as const, content: '{"value":"ok"}', refusal: null },
    }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
  const llm = createNativeLlmClient((async () => completion) as NativeChatCompletionCreate);
  const events: RunEvent[] = [];
  await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { nativeRequestRetries: 0, nativeRequestIdleTimeoutMs: 0 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "openai-lifecycle", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    transport: "non-stream",
  });
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(new Set(lifecycle.map((event) => event.id)).size, 1);
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating",
  ]);
});

test("structured repair closes the old lifecycle before opening a new ID", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["not json", '{"value":"ok"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: { id: "repair-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.value.value, "ok");
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  const firstRetry = lifecycle.findIndex((event) => event.phase === "retrying");
  assert.ok(firstRetry >= 0);
  assert.equal(lifecycle[firstRetry + 1]?.phase, "preparing");
  assert.notEqual(lifecycle[firstRetry]?.id, lifecycle[firstRetry + 1]?.id);
  assert.ok(lifecycle.every((event) => event.action === "select_relevant_pages"));
  const requestIds = events
    .filter((event) => event.kind === "prompt_budget")
    .map((event) => event.kind === "prompt_budget" ? event.requestId : undefined);
  assert.deepEqual(requestIds, ["repair-call", "repair-call:retry-1"]);
  assert.equal(new Set(requestIds).size, requestIds.length);
});

test("structured repair can use a larger repair input budget", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["not json", '{"value":"ok"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { inputBudgetTokens: 1_600, repairInputBudgetTokens: 4_096 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: { id: "repair-budget-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.value.value, "ok");
  const budgets = events.filter((event): event is Extract<RunEvent, { kind: "prompt_budget" }> =>
    event.kind === "prompt_budget");
  assert.deepEqual(budgets.map((event) => event.effectiveInputBudget), [1_600, 4_096]);
  assert.equal(
    events.some((event) =>
      event.kind === "structural_error"
      && event.succeeded === true),
    true,
  );
});

test("structured repair prefers compact prompt above profile threshold", async () => {
  // The threshold has to discriminate, so both sides are exercised against the
  // same fixture: the full repair of this response estimates around 85 tokens
  // and the compact one around 40, so 60 takes the compact path and 200 takes
  // the full one. It was 512 in the byte era and 122 under the flat token rate.
  const run = async (compactRepairThresholdTokens: number) => {
    const seen: Record<string, unknown>[] = [];
    const result = await runStructuredWithRetry({
      llm: llmFromAttempts([`{"value":${JSON.stringify("x".repeat(400))}}`, '{"value":"ok"}'], seen),
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: { inputBudgetTokens: 4_096, repairInputBudgetTokens: 8_192 },
      profile: {
        kind: "json-zod",
        schema: z.object({ value: z.literal("ok") }),
        compactRepairThresholdTokens,
      },
      maxRetries: 1,
      callSite: "query.seeds",
      lifecycle: { id: "compact-threshold-call", action: "select_relevant_pages" },
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    return { result, retry: seen[1].messages as Array<{ role: string; content: string }> };
  };

  const compact = await run(60);
  assert.equal(compact.result.value.value, "ok");
  assert.equal(compact.retry.some((message) => message.role === "assistant"), false);
  assert.match(compact.retry.at(-1)?.content ?? "", /too large to include/);

  const full = await run(200);
  assert.equal(full.result.value.value, "ok");
  assert.equal(full.retry.some((message) => message.role === "assistant"), true);
  assert.doesNotMatch(full.retry.at(-1)?.content ?? "", /too large to include/);
});

test("structured retries rebuild compact repair from original messages", async () => {
  const seen: Record<string, unknown>[] = [];
  const valid = [
    "<<<ANSWER>>>",
    "Answer",
    "<<<CITATIONS>>>",
    "- wiki_a",
    "<<<END>>>",
  ].join("\n");

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["first malformed frame", "second malformed frame", valid], seen),
    model: "m",
    baseMessages: [{ role: "user", content: "original request" }],
    opts: { inputBudgetTokens: 4_096, repairInputBudgetTokens: 8_192 },
    profile: {
      kind: "framed-zod",
      schema: AnswerSchema,
      parse: parseAnswerFrames,
      repairInstruction: "Return answer frames only.",
      compactRepairThresholdTokens: 0,
    },
    maxRetries: 2,
    callSite: "query.answer",
    lifecycle: lifecycleFor("query.answer"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.value.answer_markdown, "Answer");
  const originalMessages = seen[0].messages as Array<{ role: string; content: string }>;
  for (const request of seen.slice(1)) {
    const messages = request.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, originalMessages.length + 1);
    assert.deepEqual(messages.slice(0, originalMessages.length), originalMessages);
    assert.equal(messages.some((message) => message.role === "assistant"), false);
  }
  const finalRepair = (seen[2].messages as Array<{ content: string }>).at(-1)?.content ?? "";
  assert.doesNotMatch(finalRepair, /first malformed frame/);
});

test("empty output response-format fallback does not grow the retry prompt", async () => {
  const seen: Record<string, unknown>[] = [];
  const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "Return JSON only." },
    { role: "user", content: "x".repeat(4000) },
  ];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["", '{"value":"ok"}'], seen),
    model: "m",
    baseMessages,
    opts: { jsonMode: "json_schema", inputBudgetTokens: 8_192, repairInputBudgetTokens: 8_192 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: { id: "empty-fallback-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.value.value, "ok");
  assert.equal((seen[0].response_format as { type?: string }).type, "json_schema");
  assert.equal((seen[1].response_format as { type?: string }).type, "json_object");
  assert.deepEqual(seen[1].messages, seen[0].messages);
});

test("response-format fallback does not consume the only schema repair retry", async () => {
  const seen: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["", "not json", '{"value":"ok"}'], seen),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: { id: "fallback-plus-repair-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.value.value, "ok");
  assert.deepEqual(
    seen.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object", "json_object"],
  );
  assert.deepEqual(seen[1].messages, seen[0].messages);
  const repairMessages = seen[2].messages as Array<{ role: string; content: string }>;
  assert.equal(repairMessages.some((message) => message.role === "assistant"), true);
});

test("completionReasoning accepts native and compatibility completion fields", () => {
  assert.equal(completionReasoning({ reasoning: "native" }), "native");
  assert.equal(completionReasoning({ reasoning_content: "compat" }), "compat");
  assert.equal(completionReasoning({ reasoning: 1, reasoning_content: "compat fallback" }), "compat fallback");
  assert.equal(completionReasoning({ reasoning: 1, reasoning_content: null }), "");
});

test("structured lifecycle brackets parameter construction and request invocation", async () => {
  const order: string[] = [];
  const opts = {
    get maxTokens() {
      order.push("params");
      return 64;
    },
  };
  const llm = {
    chat: { completions: { create: () => {
      order.push("create");
      return Promise.reject(Object.assign(new Error("immediate failure"), { status: 502 }));
    } } },
  } as unknown as LlmClient;

  await assert.rejects(runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts,
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "timing-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => {
      if (event.kind === "llm_lifecycle") order.push(event.phase);
    },
  }), /immediate failure/);

  assert.deepEqual(order.slice(0, 6), [
    "preparing",
    "params",
    "sent",
    "waiting",
    "create",
    "failed",
  ]);
});

test("stream transport fallback closes the old ID before a new non-stream lifecycle", async () => {
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: { completions: { create: async () => {
      calls += 1;
      if (calls === 1) throw new Error("stream unavailable");
      return {
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: '{"value":"ok"}' },
        }],
      };
    } } },
  } as unknown as LlmClient;

  await runStructuredWithRetry({
    llm,
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: { id: "transport-call", action: "select_relevant_pages" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "retrying",
    "preparing", "sent", "waiting", "producing", "validating",
  ]);
  assert.notEqual(lifecycle[3]?.id, lifecycle[4]?.id);
  assert.equal(new Set(lifecycle.map((event) => event.id)).size, 2);
  for (const [index, id] of [...new Set(lifecycle.map((event) => event.id))].entries()) {
    const diagnostics = lifecycle
      .filter((event) => event.id === id)
      .map((event) => event.diagnostics);
    assert.ok(diagnostics.every((value) => value?.callSite === "query.seeds"));
    assert.ok(diagnostics.every((value) =>
      value?.transport === (index === 0 ? "stream" : "non-stream")));
    assert.ok(diagnostics.every((value) => value?.attempt === index));
  }
  const requestIds = events
    .filter((event) => event.kind === "prompt_budget")
    .map((event) => event.kind === "prompt_budget" ? event.requestId : undefined);
  assert.deepEqual(requestIds, ["transport-call", "transport-call:retry-1"]);
});

/**
 * One truncated reply, then a complete one. `seen` collects the raw request
 * params, so a test can assert what the second request actually asked for
 * instead of asserting on the pure retry helper.
 */
function truncatedThenCompleteLlm(
  transport: "stream" | "non-stream",
  seen: Record<string, unknown>[],
): LlmClient {
  let attempt = 0;
  return {
    chat: { completions: { create: async (params: Record<string, unknown>) => {
      seen.push(params);
      attempt += 1;
      const truncated = attempt === 1;
      const content = truncated ? '{"value":' : '{"value":"ok"}';
      const finishReason = truncated ? "length" : "stop";
      if (transport === "stream") {
        return (async function* () {
          yield {
            ...chunk(content),
            choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
          } as OpenAI.Chat.ChatCompletionChunk;
          yield usageChunk();
        })();
      }
      return {
        id: `completion-${attempt}`,
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{
          index: 0,
          finish_reason: finishReason,
          message: { role: "assistant", content, refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      };
    } } },
  } as unknown as LlmClient;
}

test("the output limit grows when the ceiling is above the current budget", () => {
  const next = outputRetryOptions({ maxTokens: 4_096, outputRetryBudgetTokens: 120_000 }, 4_096);
  assert.ok((next.maxTokens ?? 0) > 4_096, "a truncated generation must be retried with more room");
});

test("the output limit does not grow past the ceiling", () => {
  const next = outputRetryOptions({ maxTokens: 4_096, outputRetryBudgetTokens: 5_000 }, 4_096);
  assert.ok((next.maxTokens ?? 0) <= 5_000);
});

for (const transport of ["stream", "non-stream"] as const) {
  test(`a ${transport} truncation is retried with a larger output limit`, async () => {
    const seen: Record<string, unknown>[] = [];
    const events: RunEvent[] = [];

    const result = await runStructuredWithRetry({
      llm: truncatedThenCompleteLlm(transport, seen),
      model: "m",
      baseMessages: [{ role: "user", content: "Return a compact object." }],
      opts: { maxTokens: 4_096, contextWindowTokens: 131_072 },
      profile: { kind: "json-zod", schema: SmallSchema },
      maxRetries: 1,
      callSite: "query.seeds",
      lifecycle: lifecycleFor("query.seeds"),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      transport,
    });

    assert.equal(result.value.value, "ok");
    assert.equal(seen.length, 2, "a truncation must produce a second request");
    assert.ok(
      (seen[1].max_completion_tokens as number) > (seen[0].max_completion_tokens as number),
      "the retry must ask for more room",
    );
    assert.equal(
      events.some((event) => event.kind === "structural_error" && event.errorType === "output_limit"),
      true,
    );
  });
}

test("a truncation stops retrying once the packed prompt leaves no more room", async () => {
  const seen: Record<string, unknown>[] = [];

  await assert.rejects(runStructuredWithRetry({
    llm: truncatedThenCompleteLlm("non-stream", seen),
    model: "m",
    baseMessages: [{ role: "user", content: "Return a compact object." }],
    // The window is already fully claimed by the output budget, so the ceiling
    // computed from the packed prompt cannot exceed the current limit.
    opts: { maxTokens: 4_096, contextWindowTokens: 4_096 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 3,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
    transport: "non-stream",
  }), StructuredOutputTruncatedError);

  assert.equal(seen.length, 1, "an unreachable ceiling must not burn the retry budget");
});

test("a truncation without a known context window does not invent an output ceiling", async () => {
  const seen: Record<string, unknown>[] = [];

  await assert.rejects(runStructuredWithRetry({
    llm: truncatedThenCompleteLlm("non-stream", seen),
    model: "m",
    baseMessages: [{ role: "user", content: "Return a compact object." }],
    opts: { maxTokens: 4_096 },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
    transport: "non-stream",
  }), StructuredOutputTruncatedError);

  assert.equal(seen.length, 1);
});

test("a completed request reports the estimate it used against the provider's own count", async () => {
  const observe = async (tokenCalibration: number) => {
    const samples: Array<{ estimated: number; actual?: number; calibration: number }> = [];
    const events: RunEvent[] = [];
    const llm = {
      chat: { completions: { create: async () => ({
        id: "completion",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: '{"value":"ok"}', refusal: null },
          logprobs: null,
        }],
        usage: { prompt_tokens: 123, completion_tokens: 4, total_tokens: 127 },
      }) } },
    } as unknown as LlmClient;

    await runStructuredWithRetry({
      llm,
      model: "m",
      baseMessages: [{ role: "user", content: "Return a compact object." }],
      opts: {
        maxTokens: 4_096,
        contextWindowTokens: 131_072,
        tokenCalibration,
        onUsageObserved: (sample) => samples.push(sample),
        budgetTelemetry: {
          contextWindow: 131_072,
          inputSource: "discovered",
          outputSource: "default",
          calibration: tokenCalibration,
        },
      },
      profile: { kind: "json-zod", schema: SmallSchema },
      maxRetries: 0,
      callSite: "query.seeds",
      lifecycle: lifecycleFor("query.seeds"),
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      transport: "non-stream",
    });
    return { samples, events };
  };

  const plain = await observe(1);
  assert.equal(plain.samples.length, 1);
  assert.ok(plain.samples[0].estimated > 0);
  assert.equal(plain.samples[0].actual, 123);

  // The calibration factor is APPLIED to the estimate that is reported back, so
  // `calibration *= actual / calibratedEstimate` converges instead of oscillating.
  const doubled = await observe(2);
  assert.equal(doubled.samples[0].estimated, plain.samples[0].estimated * 2);
  // ...and the factor travels WITH the sample. `tokenCalibration` is fixed for the
  // whole run while the stored factor moves with every sample, so the store cannot
  // recover which factor sized this request unless the call reports it.
  assert.equal(plain.samples[0].calibration, 1);
  assert.equal(doubled.samples[0].calibration, 2);

  const budget = plain.events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.estimatedInputTokens, plain.samples[0].estimated);
  assert.equal(budget.actualInputTokens, 123);
  assert.equal(budget.contextWindow, 131_072);
  assert.equal(budget.inputSource, "discovered");
  assert.equal(budget.outputSource, "default");
  assert.equal(budget.calibration, 1);
});

test("a provider that reports no usage leaves the observed sample without a counterpart", async () => {
  const samples: Array<{ estimated: number; actual?: number; calibration: number }> = [];

  await runStructuredWithRetry({
    llm: llmFromChunks([chunk('{"value":"ok"}')]),
    model: "m",
    baseMessages: [{ role: "user", content: "Return a compact object." }],
    opts: {
      maxTokens: 4_096,
      contextWindowTokens: 131_072,
      tokenCalibration: 2,
      onUsageObserved: (sample) => samples.push(sample),
    },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 0,
    callSite: "query.seeds",
    lifecycle: lifecycleFor("query.seeds"),
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(samples.length, 1);
  assert.ok(samples[0].estimated > 0);
  assert.equal(samples[0].actual, undefined);
  // The streamed path reports the applied factor too, so a sample that does get a
  // counterpart is corrected against the factor that sized it.
  assert.equal(samples[0].calibration, 2);
});
