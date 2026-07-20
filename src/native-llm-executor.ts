import type OpenAI from "openai";
import { APIConnectionTimeoutError, APIError } from "openai";

import { classifyNativeRetry, retryDelay } from "./native-request-retry";
import type {
  NativeChatCompletionCreate,
  NativeLlmExecutionInput,
  NativeRequestLifecycle,
  NativeRequestRetryContext,
  RunEvent,
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
}

interface AttemptScope {
  signal: AbortSignal;
  resetIdle(): void;
  clearIdle(): void;
  dispose(reason?: unknown): void;
  race<T>(work: Promise<T>): Promise<T>;
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
  let timer: number | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const onCallerAbort = () => controller.abort(abortReason(callerSignal));
  if (callerSignal.aborted) onCallerAbort();
  else callerSignal.addEventListener("abort", onCallerAbort, { once: true });

  const clearIdle = (): void => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
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
    timer = window.setTimeout(callback, idleTimeoutMs);
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
    connectionTimeoutMs: 0,
    idleTimeoutMs: retry.idleTimeoutMs,
    ...failure,
  };
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
  lifecycle: CloseOnceLifecycle = retry.lifecycle,
): Promise<FailureDetails | null> {
  const decision = classifyNativeRetry(error);
  const failure: FailureDetails = {
    errorClass: decision.errorClass,
    ...(decision.status === undefined ? {} : { status: decision.status }),
    ...(decision.providerRequestId === undefined
      ? {}
      : { providerRequestId: decision.providerRequestId }),
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
    try {
      retry.signal.throwIfAborted();
      retry.lifecycle.phase("sent");
      retry.lifecycle.phase("waiting");
      scope.resetIdle();
      const result = await scope.race(input.create(input.params, { signal: scope.signal }));
      scope.clearIdle();
      retry.signal.throwIfAborted();
      const meaningfulOutputSeen = meaningfulCompletion(result);
      if (meaningfulOutputSeen) retry.lifecycle.phase("producing");
      emitRecovered(retry, attempt, meaningfulOutputSeen, priorFailure);
      return result;
    } catch (error) {
      scope.clearIdle();
      if (retry.signal.aborted || isAbortError(error)) {
        retry.lifecycle.close("cancelled");
        throw retry.signal.aborted ? abortReason(retry.signal) : error;
      }
      const failure = await waitForRetry(retry, error, attempt, "non-stream", false);
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
        const buffered: OpenAI.Chat.ChatCompletionChunk[] = [];
        meaningfulOutputSeen = false;
        let attemptComplete = false;
        try {
          retry.signal.throwIfAborted();
          retry.lifecycle.phase("sent");
          retry.lifecycle.phase("waiting");
          scope.resetIdle();
          const stream = await scope.race(input.create(input.params, { signal: scope.signal }));
          iterator = stream[Symbol.asyncIterator]();
          let armIdleBeforeNext = true;
          while (true) {
            if (armIdleBeforeNext) {
              scope.resetIdle();
              armIdleBeforeNext = false;
            }
            const next = await scope.race(Promise.resolve(iterator.next()));
            if (next.done) {
              scope.clearIdle();
              iterator = undefined;
              for (const pending of buffered) yield pending;
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
            lifecycle,
          );
          if (failure === null) throw error;
          priorFailure = failure;
          attempt += 1;
        } finally {
          scope.dispose(attemptComplete
            ? undefined
            : new DOMException("Stream attempt closed", "AbortError"));
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
