import type OpenAI from "openai";
import { APIConnectionTimeoutError, APIError } from "openai";

import { classifyNativeRetry, retryDelay } from "./native-request-retry";
import { createReplacementAttemptLifecycle, lifecycleEvent } from "./llm-lifecycle";
import {
  NATIVE_TRANSPORT_ATTEMPT_SIGNAL,
  NATIVE_TRANSPORT_CLIENT_REQUEST_ID,
  NATIVE_TRANSPORT_TRACEPARENT,
} from "./types";
import type {
  LlmCallOptions,
  LlmClient,
  LlmLifecycleAction,
  NativeChatCompletionCreate,
  NativeLlmExecutionInput,
  NativeRequestLifecycle,
  NativeRequestRetryContext,
  RunEvent,
  StructuredCallSite,
} from "./types";

type NativeResult = OpenAI.Chat.ChatCompletion | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
type NativeStreamingInput = {
  create: NativeChatCompletionCreate;
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming;
  retry: NativeRequestRetryContext;
};
type NativeNonStreamingInput = {
  create: NativeChatCompletionCreate;
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  retry: NativeRequestRetryContext;
};
type RetryMetadata = Omit<
  Extract<RunEvent, { kind: "transport_retry_scheduled" }>,
  "kind" | "delayMs" | "delaySource"
>;

interface FailureDetails {
  errorClass: string;
  status?: number;
  providerRequestId?: string;
  clientRequestId?: string;
  traceparent?: string;
}

interface AttemptScope {
  signal: AbortSignal;
  resetIdle(): void;
  clearIdle(): void;
  dispose(reason?: unknown): void;
  race<T>(work: Promise<T>): Promise<T>;
}

type NativeTimer = ReturnType<typeof setTimeout>;
let clientRequestCounter = 0;

function scheduleTimer(callback: () => void, delayMs: number): NativeTimer {
  // eslint-disable-next-line obsidianmd/prefer-window-timers -- Shared production seam must also run without window in Node.
  return setTimeout(callback, delayMs);
}

function cancelTimer(timer: NativeTimer): void {
  // eslint-disable-next-line obsidianmd/prefer-window-timers -- Shared production seam must also run without window in Node.
  clearTimeout(timer);
}

export function isNativeLlmClient(llm: LlmClient): boolean {
  return llm.nativeRequestExecutor === true;
}

export function createNativeLlmClient(
  create: NativeChatCompletionCreate,
  connectionTimeoutMs: number = 15_000,
): LlmClient {
  const execute = (async (
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming
      | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    options?: { signal?: AbortSignal; retry?: NativeRequestRetryContext },
  ) => {
    if (!options?.retry) {
      throw new TypeError("Native completion requires NativeRequestRetryContext");
    }
    return executeNativeLlmRequest({
      create,
      params,
      retry: options.retry,
    } as NativeLlmExecutionInput);
  }) as LlmClient["chat"]["completions"]["create"];
  return {
    nativeRequestExecutor: true,
    nativeConnectionTimeoutMs: connectionTimeoutMs,
    chat: { completions: { create: execute } },
  };
}

export function createNativeRequestLifecycle(input: {
  initial: { id: string; action: LlmLifecycleAction };
  callSite: StructuredCallSite;
  onEvent: (event: RunEvent) => void;
  attemptOffset?: number;
}): NativeRequestLifecycle {
  let current = input.initial;
  let active = false;
  const emit = (phase: Parameters<NativeRequestLifecycle["phase"]>[0]
    | Parameters<NativeRequestLifecycle["close"]>[0]
    | "preparing"): void => {
    input.onEvent(lifecycleEvent(current.id, current.action, phase, Date.now()));
  };
  return {
    begin(attempt, transport) {
      current = attempt === 0
        ? input.initial
        : createReplacementAttemptLifecycle(input.initial, attempt);
      active = true;
      input.onEvent(lifecycleEvent(
        current.id,
        current.action,
        "preparing",
        Date.now(),
        {
          callSite: input.callSite,
          transport,
          attempt: (input.attemptOffset ?? 0) + attempt,
        },
      ));
    },
    phase(phase) {
      if (active) emit(phase);
    },
    close(phase) {
      if (!active) return;
      emit(phase);
      active = false;
    },
    current: () => current,
  };
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = scheduleTimer(finish, ms);
    const onAbort = () => {
      cancelTimer(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    function finish(): void {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createNativeRequestRetryContext(input: {
  llm: LlmClient;
  callSite: StructuredCallSite;
  opts: LlmCallOptions;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
  lifecycle: NativeRequestLifecycle;
  logicalRequestId?: string;
}): NativeRequestRetryContext {
  return {
    logicalRequestId: input.logicalRequestId ?? input.lifecycle.current().id,
    traceId: createTraceId(),
    callSite: input.callSite,
    maxRetries: input.opts.nativeRequestRetries ?? 0,
    connectionTimeoutMs: input.llm.nativeRequestExecutor
      ? input.llm.nativeConnectionTimeoutMs ?? 15_000
      : 0,
    idleTimeoutMs: input.opts.nativeRequestIdleTimeoutMs ?? 0,
    signal: input.signal,
    onEvent: input.onEvent,
    lifecycle: input.lifecycle,
    nativeTransportDiagnostic: input.llm.nativeTransportDiagnostic,
    consumeNativeHttpResponseDiagnostic: input.llm.consumeNativeHttpResponseDiagnostic,
    consumeNativeTransportTrace: input.llm.consumeNativeTransportTrace,
    delay: abortableDelay,
  };
}

type CloseOnceLifecycle = Pick<NativeRequestLifecycle, "begin" | "close">;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function attemptScope(callerSignal: AbortSignal, idleTimeoutMs: number): AttemptScope {
  const controller = new AbortController();
  let timer: NativeTimer | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const onCallerAbort = () => controller.abort(abortReason(callerSignal));
  if (callerSignal.aborted) onCallerAbort();
  else callerSignal.addEventListener("abort", onCallerAbort, { once: true });

  const clearIdle = (): void => {
    if (timer === undefined) return;
    cancelTimer(timer);
    timer = undefined;
  };
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAttemptAbort = () => {
    clearIdle();
    rejectAbort?.(abortReason(controller.signal));
  };
  if (controller.signal.aborted) onAttemptAbort();
  else controller.signal.addEventListener("abort", onAttemptAbort, { once: true });

  const resetIdle = (): void => {
    clearIdle();
    if (idleTimeoutMs <= 0 || controller.signal.aborted) return;
    const callback = () => {
      timer = undefined;
      controller.abort(new APIConnectionTimeoutError({
        message: `LLM idle timeout after ${idleTimeoutMs}ms`,
      }));
    };
    timer = scheduleTimer(callback, idleTimeoutMs);
  };
  const dispose = (reason?: unknown): void => {
    clearIdle();
    callerSignal.removeEventListener("abort", onCallerAbort);
    controller.signal.removeEventListener("abort", onAttemptAbort);
    if (!controller.signal.aborted && reason !== undefined) controller.abort(reason);
  };
  return {
    signal: controller.signal,
    resetIdle,
    clearIdle,
    dispose,
    race: <T>(work: Promise<T>) => Promise.race([work, abortPromise]),
  };
}

function closeOnceLifecycle(lifecycle: NativeRequestLifecycle): CloseOnceLifecycle {
  let open = false;
  return {
    begin(attempt, transport) {
      lifecycle.begin(attempt, transport);
      open = true;
    },
    close(phase) {
      if (!open) return;
      open = false;
      lifecycle.close(phase);
    },
  };
}

function retryHeaders(error: unknown): Headers | undefined {
  if (!(error instanceof APIError)) return undefined;
  const headers: unknown = error.headers;
  return headers !== null
    && typeof headers === "object"
    && "get" in headers
    && typeof headers.get === "function"
    ? headers as Headers
    : undefined;
}

function validModelChunk(value: unknown): value is OpenAI.Chat.ChatCompletionChunk {
  return value !== null
    && typeof value === "object"
    && "choices" in value
    && Array.isArray(value.choices);
}

function meaningfulChunk(chunk: OpenAI.Chat.ChatCompletionChunk): boolean {
  for (const choice of chunk.choices) {
    const delta = choice.delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
      reasoning?: unknown;
      reasoning_content?: unknown;
    };
    for (const value of [delta.reasoning, delta.reasoning_content, delta.content]) {
      if (typeof value === "string" && value.trim() !== "") return true;
    }
  }
  return false;
}

function meaningfulCompletion(completion: OpenAI.Chat.ChatCompletion): boolean {
  for (const choice of completion.choices) {
    const message = choice.message as OpenAI.Chat.ChatCompletionMessage & {
      reasoning?: unknown;
      reasoning_content?: unknown;
    };
    for (const value of [message.reasoning, message.reasoning_content, message.content]) {
      if (typeof value === "string" && value.trim() !== "") return true;
    }
  }
  return false;
}

function metadata(
  retry: NativeRequestRetryContext,
  attempt: number,
  meaningfulOutputSeen: boolean,
  failure?: FailureDetails,
): RetryMetadata {
  return {
    logicalRequestId: retry.logicalRequestId,
    lifecycleId: retry.lifecycle.current().id,
    callSite: retry.callSite,
    attempt,
    maxRetries: retry.maxRetries,
    meaningfulOutputSeen,
    connectionTimeoutMs: retry.connectionTimeoutMs,
    idleTimeoutMs: retry.idleTimeoutMs,
    ...failure,
  };
}

function createClientRequestId(): string {
  clientRequestCounter = (clientRequestCounter + 1) % Number.MAX_SAFE_INTEGER;
  const randomSource = `${Date.now().toString(36)}-${clientRequestCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
  const sanitized = randomSource.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 96);
  return `aiwiki-${sanitized}`;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const crypto = typeof window === "undefined" ? undefined : window.crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nonZeroRandomHex(byteLength: number): string {
  let value = randomHex(byteLength);
  if (/^0+$/.test(value)) value = `1${value.slice(1)}`;
  return value;
}

function createTraceId(): string {
  return nonZeroRandomHex(16);
}

function createTraceparent(traceId: string): string {
  return `00-${traceId}-${nonZeroRandomHex(8)}-01`;
}

function emitNativeTransportCorrelation(
  retry: NativeRequestRetryContext,
  attempt: number,
  transport: "stream" | "non-stream",
  clientRequestId: string,
  traceparent: string,
): void {
  const diagnostic = retry.nativeTransportDiagnostic;
  if (!diagnostic?.endpointPath || !diagnostic.transport) return;
  retry.onEvent({
    kind: "native_transport_correlation",
    logicalRequestId: retry.logicalRequestId,
    lifecycleId: retry.lifecycle.current().id,
    callSite: retry.callSite,
    transport,
    attempt,
    endpointPath: diagnostic.endpointPath,
    networkTransport: diagnostic.transport,
    diagnosticMode: diagnostic.diagnosticMode,
    connectionTimeoutMs: retry.connectionTimeoutMs,
    idleTimeoutMs: retry.idleTimeoutMs,
    clientRequestId,
    traceparent,
  });
}

function emitNativeHttpResponse(
  retry: NativeRequestRetryContext,
  signal: AbortSignal,
  attempt: number,
  transport: "stream" | "non-stream",
): void {
  const consumed = retry.consumeNativeHttpResponseDiagnostic?.(signal);
  const diagnostic = consumed?.status === undefined
    ? { ...retry.nativeTransportDiagnostic, ...consumed, status: 200 }
    : consumed;
  if (!diagnostic?.endpointPath || !diagnostic.transport || diagnostic.status === undefined) return;
  retry.onEvent({
    kind: "native_http_response",
    logicalRequestId: retry.logicalRequestId,
    lifecycleId: retry.lifecycle.current().id,
    callSite: retry.callSite,
    transport,
    attempt,
    status: diagnostic.status,
    endpointPath: diagnostic.endpointPath,
    networkTransport: diagnostic.transport,
    connectionTimeoutMs: retry.connectionTimeoutMs,
    idleTimeoutMs: retry.idleTimeoutMs,
    ...(diagnostic.providerRequestId === undefined
      ? {}
      : { providerRequestId: diagnostic.providerRequestId }),
    ...(diagnostic.clientRequestId === undefined
      ? {}
      : { clientRequestId: diagnostic.clientRequestId }),
    ...(diagnostic.traceparent === undefined
      ? {}
      : { traceparent: diagnostic.traceparent }),
  });
}

function flushNativeTransportTrace(
  retry: NativeRequestRetryContext,
  signal: AbortSignal,
  attempt: number,
  transport: "stream" | "non-stream",
  sdkCompletedAtMs?: number,
): void {
  const snapshot = retry.consumeNativeTransportTrace?.(signal);
  if (!snapshot || snapshot.events.length === 0) return;
  const correlation = {
    logicalRequestId: retry.logicalRequestId,
    lifecycleId: retry.lifecycle.current().id,
    callSite: retry.callSite,
    transport,
    attempt,
    connectionTimeoutMs: retry.connectionTimeoutMs,
    idleTimeoutMs: retry.idleTimeoutMs,
  };
  for (const event of snapshot.events) {
    retry.onEvent({ kind: "native_transport_trace", ...correlation, ...event });
  }
  if (sdkCompletedAtMs === undefined) return;
  const first = snapshot.events[0];
  const finalTransportElapsedMs = snapshot.events.at(-1)?.elapsedMs ?? 0;
  retry.onEvent({
    kind: "native_transport_trace",
    ...correlation,
    stage: "sdk_complete",
    networkTransport: first.networkTransport,
    endpointPath: first.endpointPath,
    diagnosticMode: first.diagnosticMode,
    elapsedMs: Math.max(
      finalTransportElapsedMs,
      boundedElapsed(snapshot.startedAtMs, sdkCompletedAtMs),
    ),
    ...(first.clientRequestId === undefined ? {} : { clientRequestId: first.clientRequestId }),
    ...(first.traceparent === undefined ? {} : { traceparent: first.traceparent }),
  });
}

function boundedElapsed(startedAtMs: number, finishedAtMs: number): number {
  return Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, Math.floor(finishedAtMs - startedAtMs)),
  );
}

function emitRecovered(
  retry: NativeRequestRetryContext,
  attempt: number,
  meaningfulOutputSeen: boolean,
  failure: FailureDetails | undefined,
): void {
  if (attempt === 0 || failure === undefined) return;
  retry.onEvent({
    kind: "transport_retry_recovered",
    ...metadata(retry, attempt, meaningfulOutputSeen, failure),
  });
}

function safeReturn(iterator: AsyncIterator<unknown> | undefined): void {
  if (!iterator?.return) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => {});
  } catch {
    // Iterator cleanup is best-effort; the attempt signal is the cancellation owner.
  }
}

async function waitForRetry(
  retry: NativeRequestRetryContext,
  error: unknown,
  attempt: number,
  transport: "stream" | "non-stream",
  meaningfulOutputSeen: boolean,
  clientRequestId?: string,
  traceparent?: string,
  lifecycle: CloseOnceLifecycle = retry.lifecycle,
): Promise<FailureDetails | null> {
  const decision = classifyNativeRetry(error);
  const failure: FailureDetails = {
    errorClass: decision.errorClass,
    ...(decision.status === undefined ? {} : { status: decision.status }),
    ...(decision.providerRequestId === undefined
      ? {}
      : { providerRequestId: decision.providerRequestId }),
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    ...(traceparent === undefined ? {} : { traceparent }),
  };
  const canRetry = decision.retryable
    && !meaningfulOutputSeen
    && attempt < retry.maxRetries;
  if (!canRetry) {
    lifecycle.close(retry.signal.aborted || isAbortError(error) ? "cancelled" : "failed");
    if (decision.retryable) {
      retry.onEvent({
        kind: "transport_retry_exhausted",
        ...metadata(retry, attempt, meaningfulOutputSeen, failure),
      });
    }
    return null;
  }

  const delay = retryDelay(retryHeaders(error), attempt + 1);
  lifecycle.close("retrying");
  retry.onEvent({
    kind: "transport_retry_scheduled",
    ...metadata(retry, attempt, meaningfulOutputSeen, failure),
    delayMs: delay.delayMs,
    delaySource: delay.source,
  });
  lifecycle.begin(attempt + 1, transport);
  try {
    await raceWithAbort(retry.delay(delay.delayMs, retry.signal), retry.signal);
  } catch (delayError) {
    lifecycle.close(retry.signal.aborted || isAbortError(delayError) ? "cancelled" : "failed");
    throw delayError;
  }
  return failure;
}

function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

async function executeNonStream(
  input: NativeNonStreamingInput,
): Promise<OpenAI.Chat.ChatCompletion> {
  const { retry } = input;
  let attempt = 0;
  let priorFailure: FailureDetails | undefined;
  retry.lifecycle.begin(0, "non-stream");
  while (true) {
    const scope = attemptScope(retry.signal, retry.idleTimeoutMs);
    const clientRequestId = createClientRequestId();
    const traceparent = createTraceparent(retry.traceId);
    try {
      retry.signal.throwIfAborted();
      emitNativeTransportCorrelation(retry, attempt, "non-stream", clientRequestId, traceparent);
      retry.lifecycle.phase("sent");
      retry.lifecycle.phase("waiting");
      scope.resetIdle();
      const result = await scope.race(input.create(input.params, {
        signal: scope.signal,
        fetchOptions: {
          [NATIVE_TRANSPORT_ATTEMPT_SIGNAL]: scope.signal,
          [NATIVE_TRANSPORT_CLIENT_REQUEST_ID]: clientRequestId,
          [NATIVE_TRANSPORT_TRACEPARENT]: traceparent,
        },
      }));
      const sdkCompletedAtMs = Date.now();
      emitNativeHttpResponse(retry, scope.signal, attempt, "non-stream");
      flushNativeTransportTrace(retry, scope.signal, attempt, "non-stream", sdkCompletedAtMs);
      scope.clearIdle();
      retry.signal.throwIfAborted();
      const meaningfulOutputSeen = meaningfulCompletion(result);
      if (meaningfulOutputSeen) retry.lifecycle.phase("producing");
      emitRecovered(retry, attempt, meaningfulOutputSeen, priorFailure);
      return result;
    } catch (error) {
      scope.clearIdle();
      flushNativeTransportTrace(retry, scope.signal, attempt, "non-stream");
      if (retry.signal.aborted || isAbortError(error)) {
        retry.lifecycle.close("cancelled");
        throw retry.signal.aborted ? abortReason(retry.signal) : error;
      }
      const failure = await waitForRetry(
        retry,
        error,
        attempt,
        "non-stream",
        false,
        clientRequestId,
        traceparent,
      );
      if (failure === null) throw error;
      priorFailure = failure;
      attempt += 1;
    } finally {
      scope.dispose();
    }
  }
}

function executeStream(
  input: NativeStreamingInput,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  const { retry } = input;
  return (async function* () {
    let attempt = 0;
    let priorFailure: FailureDetails | undefined;
    let scope: AttemptScope | undefined;
    let iterator: AsyncIterator<OpenAI.Chat.ChatCompletionChunk> | undefined;
    let meaningfulOutputSeen = false;
    let requestCompleted = false;
    const lifecycle = closeOnceLifecycle(retry.lifecycle);
    lifecycle.begin(0, "stream");
    const onCallerAbort = () => lifecycle.close("cancelled");
    if (retry.signal.aborted) onCallerAbort();
    else retry.signal.addEventListener("abort", onCallerAbort, { once: true });
    try {
      while (true) {
        scope = attemptScope(retry.signal, retry.idleTimeoutMs);
        const clientRequestId = createClientRequestId();
        const traceparent = createTraceparent(retry.traceId);
        const buffered: OpenAI.Chat.ChatCompletionChunk[] = [];
        meaningfulOutputSeen = false;
        let attemptComplete = false;
        let attemptCleanedUp = false;
        try {
          retry.signal.throwIfAborted();
          emitNativeTransportCorrelation(retry, attempt, "stream", clientRequestId, traceparent);
          retry.lifecycle.phase("sent");
          retry.lifecycle.phase("waiting");
          scope.resetIdle();
          const stream = await scope.race(input.create(input.params, {
            signal: scope.signal,
            fetchOptions: {
              [NATIVE_TRANSPORT_ATTEMPT_SIGNAL]: scope.signal,
              [NATIVE_TRANSPORT_CLIENT_REQUEST_ID]: clientRequestId,
              [NATIVE_TRANSPORT_TRACEPARENT]: traceparent,
            },
          }));
          emitNativeHttpResponse(retry, scope.signal, attempt, "stream");
          iterator = stream[Symbol.asyncIterator]();
          let armIdleBeforeNext = true;
          while (true) {
            if (armIdleBeforeNext) {
              scope.resetIdle();
              armIdleBeforeNext = false;
            }
            const next = await scope.race(Promise.resolve(iterator.next()));
            if (next.done) {
              const sdkCompletedAtMs = Date.now();
              scope.clearIdle();
              iterator = undefined;
              for (const pending of buffered) yield pending;
              flushNativeTransportTrace(
                retry,
                scope.signal,
                attempt,
                "stream",
                sdkCompletedAtMs,
              );
              emitRecovered(retry, attempt, meaningfulOutputSeen, priorFailure);
              attemptComplete = true;
              requestCompleted = true;
              return;
            }
            if (!validModelChunk(next.value)) continue;
            scope.clearIdle();
            armIdleBeforeNext = true;
            if (!meaningfulOutputSeen && meaningfulChunk(next.value)) {
              meaningfulOutputSeen = true;
              retry.lifecycle.phase("producing");
              for (const pending of buffered) yield pending;
              buffered.length = 0;
            }
            if (meaningfulOutputSeen) yield next.value;
            else buffered.push(next.value);
          }
        } catch (error) {
          scope.clearIdle();
          safeReturn(iterator);
          iterator = undefined;
          const closingSignal = scope.signal;
          scope.dispose(new DOMException("Stream attempt closed", "AbortError"));
          flushNativeTransportTrace(
            retry,
            closingSignal,
            attempt,
            "stream",
          );
          attemptCleanedUp = true;
          if (retry.signal.aborted || isAbortError(error)) {
            lifecycle.close("cancelled");
            throw retry.signal.aborted ? abortReason(retry.signal) : error;
          }
          const failure = await waitForRetry(
            retry,
            error,
            attempt,
            "stream",
            meaningfulOutputSeen,
            clientRequestId,
            traceparent,
            lifecycle,
          );
          if (failure === null) throw error;
          priorFailure = failure;
          attempt += 1;
        } finally {
          if (!attemptCleanedUp) {
            const closingSignal = scope.signal;
            scope.dispose(attemptComplete
              ? undefined
              : new DOMException("Stream attempt closed", "AbortError"));
            flushNativeTransportTrace(
              retry,
              closingSignal,
              attempt,
              "stream",
            );
          }
          scope = undefined;
        }
      }
    } finally {
      retry.signal.removeEventListener("abort", onCallerAbort);
      if (!requestCompleted) lifecycle.close("cancelled");
      safeReturn(iterator);
      scope?.dispose(new DOMException("Stream iterator closed", "AbortError"));
    }
  })();
}

export function executeNativeLlmRequest(
  input: NativeLlmExecutionInput,
): Promise<NativeResult> {
  if (input.params.stream === true) {
    return Promise.resolve(executeStream(
      input as NativeStreamingInput,
    ));
  }
  return executeNonStream(
    input as NativeNonStreamingInput,
  );
}
