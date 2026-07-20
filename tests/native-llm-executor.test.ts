import assert from "node:assert/strict";
import test from "node:test";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";

import { executeNativeLlmRequest } from "../src/native-llm-executor";
import {
  createReplacementAttemptLifecycle,
  lifecycleEvent,
} from "../src/llm-lifecycle";
import type {
  LlmLifecycleAction,
  NativeChatCompletionCreate,
  NativeRequestLifecycle,
  NativeRequestRetryContext,
  RunEvent,
} from "../src/types";

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

type NativeResult = OpenAI.Chat.ChatCompletion | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function apiError(
  status: number,
  headers: Record<string, string> = {},
): APIError {
  return APIError.generate(status, {}, undefined, new Headers(headers));
}

function completion(content: string): OpenAI.Chat.ChatCompletion {
  return {
    id: `completion-${content}`,
    object: "chat.completion",
    created: 0,
    model: "mock",
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content, refusal: null },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function chunk(
  delta: Record<string, unknown> = {},
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta, finish_reason: null }],
  } as OpenAI.Chat.ChatCompletionChunk;
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function streamOf(...chunks: OpenAI.Chat.ChatCompletionChunk[]): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield* chunks;
  })();
}

function failingStream(
  chunks: OpenAI.Chat.ChatCompletionChunk[],
  error: Error = new APIConnectionError({ message: "stream disconnected" }),
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield* chunks;
    throw error;
  })();
}

function sequence(
  results: Array<NativeResult | Error | ((signal: AbortSignal) => Promise<NativeResult>)>,
  seenParams: Array<object> = [],
  seenSignals: AbortSignal[] = [],
): NativeChatCompletionCreate {
  let index = 0;
  return (async (params: object, options: { signal: AbortSignal }) => {
    seenParams.push(params);
    seenSignals.push(options.signal);
    const result = results[index++];
    if (result instanceof Error) throw result;
    if (typeof result === "function") return result(options.signal);
    if (result === undefined) throw new Error("Unexpected native request attempt");
    return result;
  }) as NativeChatCompletionCreate;
}

function lifecycleRecorder(
  onEvent: (event: RunEvent) => void,
  initial: { id: string; action: LlmLifecycleAction } = {
    id: "attempt-0",
    action: "answer_question",
  },
): NativeRequestLifecycle {
  let current = initial;
  let active = false;
  return {
    begin(attempt, transport) {
      current = attempt === 0
        ? initial
        : createReplacementAttemptLifecycle(initial, attempt);
      active = true;
      onEvent(lifecycleEvent(current.id, current.action, "preparing", attempt, {
        callSite: "query.answer",
        transport,
        attempt,
      }));
    },
    phase(phase) {
      assert.equal(active, true);
      onEvent(lifecycleEvent(current.id, current.action, phase, 10));
    },
    close(phase) {
      if (!active) return;
      onEvent(lifecycleEvent(current.id, current.action, phase, 10));
      active = false;
    },
    current: () => current,
  };
}

function retryContext(
  overrides: Partial<NativeRequestRetryContext> = {},
): NativeRequestRetryContext {
  const signal = overrides.signal ?? new AbortController().signal;
  const onEvent = overrides.onEvent ?? (() => {});
  return {
    logicalRequestId: "logical-1",
    callSite: "query.answer",
    maxRetries: 1,
    idleTimeoutMs: 0,
    signal,
    onEvent,
    lifecycle: overrides.lifecycle ?? lifecycleRecorder(onEvent),
    delay: overrides.delay ?? (async () => {}),
    ...overrides,
  };
}

const nonStreamParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
  model: "mock",
  messages: [{ role: "user", content: "hello" }],
  stream: false,
};

const streamParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
  ...nonStreamParams,
  stream: true,
};

async function consume(
  pending: Promise<NativeResult>,
): Promise<OpenAI.Chat.ChatCompletionChunk[]> {
  const result = await pending;
  assert.equal(Symbol.asyncIterator in result, true);
  const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
  for await (const value of result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
    chunks.push(value);
  }
  return chunks;
}

function phases(events: RunEvent[]): string[] {
  return events
    .filter((event): event is Extract<RunEvent, { kind: "llm_lifecycle" }> =>
      event.kind === "llm_lifecycle")
    .map((event) => `${event.id}:${event.action}:${event.phase}`);
}

test("non-stream retries 502 and returns the one raw completion with identical params", async () => {
  const expected = completion("ok");
  const seenParams: object[] = [];
  const delays: number[] = [];
  const paramsSnapshot = structuredClone(nonStreamParams);
  const result = await executeNativeLlmRequest({
    create: sequence([apiError(502), expected], seenParams),
    params: nonStreamParams,
    retry: retryContext({
      maxRetries: 3,
      delay: async (ms) => { delays.push(ms); },
    }),
  });

  assert.equal(result, expected);
  assert.deepEqual(nonStreamParams, paramsSnapshot);
  assert.equal(seenParams.length, 2);
  assert.equal(seenParams[0], nonStreamParams);
  assert.equal(seenParams[1], nonStreamParams);
  assert.equal(delays.length, 1);
});

test("non-stream exhaustion throws the final error after maxRetries plus one attempts", async () => {
  const first = apiError(502);
  const final = apiError(503, { "x-request-id": "provider-final" });
  const events: RunEvent[] = [];
  let delayCalls = 0;
  await assert.rejects(
    executeNativeLlmRequest({
      create: sequence([first, final]),
      params: nonStreamParams,
      retry: retryContext({
        maxRetries: 1,
        onEvent: (event) => events.push(event),
        lifecycle: lifecycleRecorder((event) => events.push(event)),
        delay: async () => { delayCalls += 1; },
      }),
    }),
    (error) => error === final,
  );

  assert.equal(delayCalls, 1);
  const exhausted = events.find((event) => event.kind === "transport_retry_exhausted");
  assert.equal(exhausted?.kind, "transport_retry_exhausted");
  if (exhausted?.kind === "transport_retry_exhausted") {
    assert.equal(exhausted.attempt, 1);
    assert.equal(exhausted.maxRetries, 1);
    assert.equal(exhausted.status, 503);
    assert.equal(exhausted.providerRequestId, "provider-final");
  }
  assert.match(phases(events).at(-1) ?? "", /:failed$/);
});

test("maxRetries zero performs one non-stream attempt and never delays", async () => {
  const seenParams: object[] = [];
  let delayCalls = 0;
  const error = apiError(502);
  await assert.rejects(
    executeNativeLlmRequest({
      create: sequence([error], seenParams),
      params: nonStreamParams,
      retry: retryContext({
        maxRetries: 0,
        delay: async () => { delayCalls += 1; },
      }),
    }),
    (actual) => actual === error,
  );
  assert.equal(seenParams.length, 1);
  assert.equal(delayCalls, 0);
});

test("caller cancellation aborts an in-flight attempt and closes it as cancelled", async () => {
  const caller = new AbortController();
  const events: RunEvent[] = [];
  const seenSignals: AbortSignal[] = [];
  const started = deferred<void>();
  const operation = executeNativeLlmRequest({
    create: sequence([
      async () => {
        started.resolve(undefined);
        return new Promise<NativeResult>(() => {});
      },
    ], [], seenSignals),
    params: nonStreamParams,
    retry: retryContext({
      signal: caller.signal,
      onEvent: (event) => events.push(event),
      lifecycle: lifecycleRecorder((event) => events.push(event)),
    }),
  });

  await started.promise;
  caller.abort();
  await assert.rejects(operation, (error) => error instanceof Error && error.name === "AbortError");
  assert.equal(seenSignals.length, 1);
  assert.notEqual(seenSignals[0], caller.signal);
  assert.equal(seenSignals[0].aborted, true);
  assert.match(phases(events).at(-1) ?? "", /:cancelled$/);
});

test("caller cancellation during backoff cancels the prepared replacement and stops retries", async () => {
  const caller = new AbortController();
  const events: RunEvent[] = [];
  const delayStarted = deferred<AbortSignal>();
  const seenParams: object[] = [];
  const operation = executeNativeLlmRequest({
    create: sequence([apiError(502), completion("must-not-run")], seenParams),
    params: nonStreamParams,
    retry: retryContext({
      signal: caller.signal,
      onEvent: (event) => events.push(event),
      lifecycle: lifecycleRecorder((event) => events.push(event)),
      delay: async (_ms, signal) => {
        delayStarted.resolve(signal);
        return new Promise<void>(() => {});
      },
    }),
  });

  const delaySignal = await delayStarted.promise;
  caller.abort();
  await assert.rejects(operation, (error) => error instanceof Error && error.name === "AbortError");
  assert.equal(delaySignal.aborted, true);
  assert.equal(seenParams.length, 1);
  assert.deepEqual(phases(events).slice(-2), [
    "attempt-0:retry-1:retry_model_request:preparing",
    "attempt-0:retry-1:retry_model_request:cancelled",
  ]);
});

test("stream retries connection failure before the first chunk and exposes one iterable", async () => {
  const events: RunEvent[] = [];
  const pending = executeNativeLlmRequest({
    create: sequence([
      new APIConnectionError({ message: "connect failed" }),
      streamOf(chunk({ content: "ok" })),
    ]),
    params: streamParams,
    retry: retryContext({
      maxRetries: 1,
      onEvent: (event) => events.push(event),
      lifecycle: lifecycleRecorder((event) => events.push(event)),
    }),
  });
  const result = await pending;
  assert.equal(Symbol.asyncIterator in result, true);
  const values: OpenAI.Chat.ChatCompletionChunk[] = [];
  for await (const value of result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
    values.push(value);
  }

  assert.equal(values[0]?.choices[0]?.delta.content, "ok");
  assert.equal(events.filter((event) => event.kind === "transport_retry_recovered").length, 1);
});

test("role, usage, whitespace, and empty chunks do not block a pre-output stream retry", async () => {
  const seenParams: object[] = [];
  const values = await consume(executeNativeLlmRequest({
    create: sequence([
      failingStream([
        chunk({ role: "assistant" }),
        usageChunk(),
        chunk({ content: "   ", reasoning: "\n", reasoning_content: "\t" }),
        chunk(),
      ]),
      streamOf(chunk({ content: "ok" })),
    ], seenParams),
    params: streamParams,
    retry: retryContext({ maxRetries: 1 }),
  }));

  assert.equal(seenParams.length, 2);
  assert.equal(seenParams[0], streamParams);
  assert.equal(seenParams[1], streamParams);
  assert.deepEqual(values.map((value) => value.choices[0]?.delta.content), ["ok"]);
});

for (const field of ["reasoning", "reasoning_content", "content"] as const) {
  test(`nonblank ${field} marks meaningful stream output and fails closed`, async () => {
    let attempts = 0;
    const values: OpenAI.Chat.ChatCompletionChunk[] = [];
    const result = await executeNativeLlmRequest({
      create: (async (_params: object, _options: { signal: AbortSignal }) => {
        attempts += 1;
        return attempts === 1
          ? failingStream([chunk({ [field]: "partial" })])
          : streamOf(chunk({ content: "must-not-run" }));
      }) as NativeChatCompletionCreate,
      params: streamParams,
      retry: retryContext({ maxRetries: 1 }),
    });

    await assert.rejects(async () => {
      for await (const value of result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
        values.push(value);
      }
    }, APIConnectionError);
    assert.equal(attempts, 1);
    assert.equal(values.length, 1);
  });
}

test("retry telemetry keeps one logical ID, fresh lifecycle IDs, and provider request ID", async () => {
  const events: RunEvent[] = [];
  await executeNativeLlmRequest({
    create: sequence([
      apiError(502, { "x-request-id": "provider-502", "retry-after-ms": "25" }),
      completion("ok"),
    ]),
    params: nonStreamParams,
    retry: retryContext({
      maxRetries: 1,
      onEvent: (event) => events.push(event),
      lifecycle: lifecycleRecorder((event) => events.push(event)),
    }),
  });

  const retryEvents = events.filter((event) => event.kind.startsWith("transport_retry_")) as Array<
    Extract<RunEvent, { kind: "transport_retry_scheduled" | "transport_retry_recovered" }>
  >;
  assert.deepEqual(retryEvents.map((event) => event.kind), [
    "transport_retry_scheduled",
    "transport_retry_recovered",
  ]);
  assert.equal(retryEvents.every((event) => event.logicalRequestId === "logical-1"), true);
  assert.equal(retryEvents[0]?.lifecycleId, "attempt-0");
  assert.equal(retryEvents[1]?.lifecycleId, "attempt-0:retry-1");
  assert.equal(retryEvents[0]?.providerRequestId, "provider-502");
  assert.equal(retryEvents[1]?.providerRequestId, "provider-502");
  assert.equal(retryEvents[0]?.delayMs, 25);
  assert.equal(retryEvents[0]?.delaySource, "retry-after-ms");
  assert.equal("source" in retryEvents[0], false);
  assert.equal(retryEvents[0]?.status, 502);
  assert.equal(retryEvents[0]?.connectionTimeoutMs, 0);
  assert.deepEqual(phases(events), [
    "attempt-0:answer_question:preparing",
    "attempt-0:answer_question:sent",
    "attempt-0:answer_question:waiting",
    "attempt-0:answer_question:retrying",
    "attempt-0:retry-1:retry_model_request:preparing",
    "attempt-0:retry-1:retry_model_request:sent",
    "attempt-0:retry-1:retry_model_request:waiting",
    "attempt-0:retry-1:retry_model_request:producing",
  ]);
});

class FakeTimers {
  private nextId = 1;
  private nowMs = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(handle as unknown as number);
  };

  tick(ms: number): void {
    this.nowMs += ms;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.at <= this.nowMs)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, task] of due) {
      if (!this.tasks.delete(id)) continue;
      task.callback();
    }
  }

  activeCount(): number {
    return this.tasks.size;
  }
}

async function withFakeTimers<T>(run: (timers: FakeTimers) => Promise<T>): Promise<T> {
  const timers = new FakeTimers();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = timers.setTimeout as typeof setTimeout;
  globalThis.clearTimeout = timers.clearTimeout as typeof clearTimeout;
  try {
    return await run(timers);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test("valid model chunks reset idle timing while invalid transport heartbeats do not", async () => {
  await withFakeTimers(async (timers) => {
    const firstNext = deferred<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>();
    const secondNext = deferred<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>();
    const thirdNext = deferred<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>();
    const firstRequested = deferred<void>();
    const secondRequested = deferred<void>();
    const thirdRequested = deferred<void>();
    let nextCalls = 0;
    const modelStream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            nextCalls += 1;
            if (nextCalls === 1) {
              firstRequested.resolve(undefined);
              return firstNext.promise;
            }
            if (nextCalls === 2) {
              secondRequested.resolve(undefined);
              return secondNext.promise;
            }
            thirdRequested.resolve(undefined);
            return thirdNext.promise;
          },
        };
      },
    };
    const operation = consume(executeNativeLlmRequest({
      create: sequence([modelStream]),
      params: streamParams,
      retry: retryContext({ maxRetries: 0, idleTimeoutMs: 100 }),
    }));

    await firstRequested.promise;
    timers.tick(90);
    firstNext.resolve({ done: false, value: chunk({ role: "assistant" }) });
    await secondRequested.promise;
    timers.tick(90);
    assert.equal(timers.activeCount(), 1);
    secondNext.resolve({ done: false, value: { type: "heartbeat" } as unknown as OpenAI.Chat.ChatCompletionChunk });
    await thirdRequested.promise;
    timers.tick(10);
    await assert.rejects(operation, APIConnectionTimeoutError);
    assert.equal(timers.activeCount(), 0);
  });
});

test("non-stream success, permanent error, and retry exhaustion clear idle timers", async () => {
  await withFakeTimers(async (timers) => {
    const success = await executeNativeLlmRequest({
      create: sequence([completion("ok")]),
      params: nonStreamParams,
      retry: retryContext({ maxRetries: 0, idleTimeoutMs: 100 }),
    });
    assert.equal("choices" in success, true);
    assert.equal((success as OpenAI.Chat.ChatCompletion).choices[0]?.message.content, "ok");
    assert.equal(timers.activeCount(), 0);

    await assert.rejects(executeNativeLlmRequest({
      create: sequence([apiError(400)]),
      params: nonStreamParams,
      retry: retryContext({ maxRetries: 1, idleTimeoutMs: 100 }),
    }), APIError);
    assert.equal(timers.activeCount(), 0);

    await assert.rejects(executeNativeLlmRequest({
      create: sequence([apiError(502)]),
      params: nonStreamParams,
      retry: retryContext({ maxRetries: 0, idleTimeoutMs: 100 }),
    }), APIError);
    assert.equal(timers.activeCount(), 0);
  });
});

test("early iterator close clears timers, aborts the attempt, and never awaits hanging return", async () => {
  await withFakeTimers(async (timers) => {
    const events: RunEvent[] = [];
    let attemptSignal: AbortSignal | undefined;
    let returnCalls = 0;
    const underlying: AsyncIterator<OpenAI.Chat.ChatCompletionChunk> = {
      next: async () => ({ done: false, value: chunk({ content: "first" }) }),
      return: () => {
        returnCalls += 1;
        return new Promise<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>(() => {});
      },
    };
    const result = await executeNativeLlmRequest({
      create: sequence([
        async (signal) => {
          attemptSignal = signal;
          return { [Symbol.asyncIterator]: () => underlying };
        },
      ]),
      params: streamParams,
      retry: retryContext({
        maxRetries: 2,
        idleTimeoutMs: 100,
        onEvent: (event) => events.push(event),
        lifecycle: lifecycleRecorder((event) => events.push(event)),
      }),
    });
    const iterator = (result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>)[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.value?.choices[0]?.delta.content, "first");
    assert.equal(timers.activeCount(), 1);

    const closed = await iterator.return?.();
    assert.equal(closed?.done, true);
    assert.equal(returnCalls, 1);
    assert.equal(attemptSignal?.aborted, true);
    assert.equal(timers.activeCount(), 0);
    assert.match(phases(events).at(-1) ?? "", /:cancelled$/);
  });
});

test("caller abort while a stream yield is paused clears timers and closes lifecycle immediately", async () => {
  await withFakeTimers(async (timers) => {
    const caller = new AbortController();
    const events: RunEvent[] = [];
    let attemptSignal: AbortSignal | undefined;
    const underlying: AsyncIterator<OpenAI.Chat.ChatCompletionChunk> = {
      next: async () => ({ done: false, value: chunk({ content: "first" }) }),
      return: async () => ({ done: true, value: undefined }),
    };
    const result = await executeNativeLlmRequest({
      create: sequence([
        async (signal) => {
          attemptSignal = signal;
          return { [Symbol.asyncIterator]: () => underlying };
        },
      ]),
      params: streamParams,
      retry: retryContext({
        maxRetries: 1,
        idleTimeoutMs: 100,
        signal: caller.signal,
        onEvent: (event) => events.push(event),
        lifecycle: lifecycleRecorder((event) => events.push(event)),
      }),
    });
    const iterator = (result as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>)[Symbol.asyncIterator]();
    await iterator.next();
    assert.equal(timers.activeCount(), 1);

    caller.abort();
    await Promise.resolve();
    assert.equal(attemptSignal?.aborted, true);
    assert.equal(timers.activeCount(), 0);
    assert.match(phases(events).at(-1) ?? "", /:cancelled$/);
    await iterator.return?.();
  });
});
