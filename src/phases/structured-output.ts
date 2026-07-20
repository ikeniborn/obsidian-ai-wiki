import type OpenAI from "openai";
import type { z } from "zod";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  LlmCallOptions,
  LlmClient,
  LlmLifecycleAction,
  RunEvent,
  StructuredCallSite,
} from "../types";
import { lifecycleEvent } from "../llm-lifecycle";
import {
  classifyContextError,
  createPromptBudgetEvent,
  estimatePreparedMessages,
  PromptBudgetExceededError,
} from "../prompt-budget";
import { RunEventBridge } from "../run-event-bridge";
import { structuralErrorCounter } from "../structural-error-counter";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  completionReasoning,
  extractStreamDeltas,
  extractUsage,
  isJsonModeError,
  parseStructured,
  shouldFallbackStreamToNonStream,
  wrapStreamWithStats,
} from "./llm-utils";
import { render } from "./template";

const repairJson = [
  "{{detail}}",
  "",
  "Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.",
].join("\n");

export type { StructuredCallSite } from "../types";

type ResponseFormatMode = "json_schema" | "json_object" | "none";
let lifecycleSequence = 0;

export function createLlmLifecycle(action: LlmLifecycleAction): {
  id: string;
  action: LlmLifecycleAction;
} {
  lifecycleSequence += 1;
  return {
    id: `llm-${Date.now().toString(36)}-${lifecycleSequence.toString(36)}`,
    action,
  };
}

export type StructuredProfile<T> =
  | { kind: "json-zod"; schema: z.ZodSchema<T>; repairInstruction?: string }
  | {
      kind: "framed-zod";
      schema: z.ZodSchema<T>;
      parse: (text: string) => unknown;
      repairInstruction: string;
    };

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: StructuredCallSite,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = "StructuredValidationError";
  }
}

export class StructuredOutputTruncatedError extends Error {
  constructor(public readonly finishReason: string) {
    super(`Structured output truncated with finish_reason=${finishReason}`);
    this.name = "StructuredOutputTruncatedError";
  }
}

export interface RunStructuredArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  profile: StructuredProfile<T>;
  maxRetries: number;
  callSite: StructuredCallSite;
  lifecycle: { id: string; action: LlmLifecycleAction };
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
  transport?: "stream" | "non-stream";
  validationExhaustionPhase?: "retrying" | "failed";
  contextErrorsRetry?: boolean;
}

export interface RunStructuredResult<T> {
  value: T;
  outputTokens: number;
  inputTokens?: number;
  fullText: string;
  lifecycle: { id: string; action: LlmLifecycleAction };
}

interface CallResult {
  fullText: string;
  outputTokens: number;
  inputTokens?: number;
  statsEvent?: RunEvent;
  finishReason?: string | null;
}

interface StructuredLifecycle {
  begin(attempt: number, transport: "stream" | "non-stream"): void;
  phase(phase: "sent" | "waiting" | "producing" | "validating"): void;
  close(phase: "retrying" | "failed" | "cancelled"): void;
  isActive(): boolean;
  current(): { id: string; action: LlmLifecycleAction };
}

function structuredLifecycle<T>(args: RunStructuredArgs<T>): StructuredLifecycle {
  const descriptor = args.lifecycle;
  let sequence = 0;
  let active = false;
  let currentId = descriptor.id;
  let currentDiagnostics: {
    callSite: StructuredCallSite;
    transport: "stream" | "non-stream";
    attempt: number;
  } | undefined;
  let lastAttempt = -1;
  const emit = (
    phase: Extract<RunEvent, { kind: "llm_lifecycle" }>["phase"],
  ) => {
    args.onEvent(lifecycleEvent(
      currentId,
      descriptor.action,
      phase,
      Date.now(),
      currentDiagnostics,
    ));
  };
  return {
    begin(attempt, transport) {
      currentId = sequence === 0 ? descriptor.id : `${descriptor.id}:retry-${sequence}`;
      sequence += 1;
      lastAttempt = Math.max(attempt, lastAttempt + 1);
      currentDiagnostics = { callSite: args.callSite, transport, attempt: lastAttempt };
      active = true;
      emit("preparing");
    },
    phase(phase) {
      if (active) emit(phase);
    },
    close(phase) {
      if (!active) return;
      emit(phase);
      active = false;
    },
    isActive: () => active,
    current: () => ({ id: currentId, action: descriptor.action }),
  };
}

function fallbackMode(mode: ResponseFormatMode): ResponseFormatMode | null {
  if (mode === "json_schema") return "json_object";
  if (mode === "json_object") return "none";
  return null;
}

function emitStructuralError(
  onEvent: (ev: RunEvent) => void,
  callSite: StructuredCallSite,
  errorType: Extract<RunEvent, { kind: "structural_error" }>["errorType"],
  retryAttempt: number,
  succeeded: boolean | null,
  message: string,
): void {
  onEvent({ kind: "structural_error", callSite, errorType, retryAttempt, succeeded, message });
}

function emitResponseFormatFallback(
  onEvent: (ev: RunEvent) => void,
  callSite: StructuredCallSite,
  retryAttempt: number,
  from: ResponseFormatMode,
  to: ResponseFormatMode,
): void {
  emitStructuralError(
    onEvent,
    callSite,
    "response_format_fallback",
    retryAttempt,
    null,
    `${from} -> ${to}`,
  );
}

function initialMode<T>(profile: StructuredProfile<T>, opts: LlmCallOptions): ResponseFormatMode {
  if (profile.kind !== "json-zod") return "none";
  return opts.jsonMode === false ? "none" : "json_schema";
}

function optsForMode<T>(
  opts: LlmCallOptions,
  mode: ResponseFormatMode,
  callSite: StructuredCallSite,
  schema: z.ZodSchema<T>,
): LlmCallOptions {
  if (mode === "none") return { ...opts, jsonMode: false, jsonSchema: undefined };
  if (mode === "json_object") return { ...opts, jsonMode: "json_object", jsonSchema: undefined };
  return {
    ...opts,
    jsonMode: "json_schema",
    jsonSchema: {
      name: callSite.replace(/\./g, "_"),
      schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
    },
  };
}

export function formatZodFeedback(err: ZodError | null, raw: string): string {
  if (err === null) {
    const detail = [
      "Previous response was not valid JSON.",
      "Raw output (truncated):",
      raw.slice(0, 2000),
    ].join("\n");
    return render(repairJson, { detail });
  }
  const bullets = err.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `- ${path}: ${i.message}`;
  }).join("\n");
  return render(repairJson, {
    detail: ["Previous response failed validation:", bullets].join("\n"),
  });
}

function repairPrompt<T>(profile: StructuredProfile<T>, lastText: string, lastError: Error): string {
  if (profile.kind === "framed-zod") {
    return [
      "Previous response did not match the required frame format.",
      lastError.message,
      profile.repairInstruction,
      "Return only the required frames. Do not add commentary outside frames.",
      "Previous response (truncated):",
      lastText.slice(0, 2000),
    ].join("\n");
  }
  const feedback = lastError instanceof ZodError
    ? formatZodFeedback(lastError, lastText)
    : formatZodFeedback(null, lastText);
  return profile.repairInstruction
    ? `${feedback}\n\n${profile.repairInstruction}`
    : feedback;
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
  onEvent: (ev: RunEvent) => void,
  lifecycle: StructuredLifecycle,
  attempt: number,
  callSite: StructuredCallSite,
): Promise<CallResult> {
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  let finishReason: string | null | undefined;
  let streamChunkConsumed = false;
  const requestStartMs = Date.now();
  const requestId = lifecycle.current().id;
  let inputTokens: number | undefined;
  let requestError: unknown;

  try {
    lifecycle.phase("sent");
    lifecycle.phase("waiting");
    llm.beginPromptBudgetRequest?.(requestId);
    const request = llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const rawStream = await request;
    signal.throwIfAborted();
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs, signal);
    let producing = false;
    for await (const chunk of stream) {
      streamChunkConsumed = true;
      const reason = chunk.choices[0]?.finish_reason;
      if (reason !== undefined) finishReason = reason;
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (!producing && (reasoning.trim() || content.trim())) {
        lifecycle.phase("producing");
        producing = true;
      }
      if (reasoning) onEvent({ kind: "assistant_text", delta: reasoning, isReasoning: true });
      if (content) {
        fullText += content;
        onEvent({ kind: "assistant_text", delta: content });
      }
      if (tok !== undefined) outputTokens = tok;
    }
    signal.throwIfAborted();
    if (finishReason === "length") throw new StructuredOutputTruncatedError(finishReason);
    const stats = getStats();
    inputTokens = stats?.inputTokens;
    return {
      fullText,
      outputTokens,
      inputTokens: stats?.inputTokens,
      statsEvent: stats ? buildLlmCallStatsEvent(stats) : undefined,
      finishReason,
    };
  } catch (e) {
    requestError = e;
    if (
      signal.aborted
      || (e as Error).name === "AbortError"
    ) throw e;
    if (streamChunkConsumed) throw e;
    if (
      classifyContextError(e) !== null
      || e instanceof PromptBudgetExceededError
      || e instanceof StructuredOutputTruncatedError
    ) throw e;
    if (isJsonModeError(e)) throw e;
    if (!shouldFallbackStreamToNonStream(e, signal)) throw e;
    lifecycle.close("retrying");
    lifecycle.begin(attempt, "non-stream");
    return nonStreamOnce(
      llm,
      model,
      messages,
      opts,
      signal,
      onEvent,
      lifecycle,
      attempt,
      callSite,
    );
  } finally {
    if (!llm.emitsPromptBudget) onEvent(createPromptBudgetEvent({
      requestId,
      callSite,
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      effectiveInputBudget: opts.inputBudgetTokens ?? 16_384,
      estimatedInputTokens: estimatePreparedMessages(
        params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ),
      actualInputTokens: inputTokens,
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      contextUnits: messages.length,
      retryReason: classifyContextError(requestError) === null
        ? undefined
        : "provider_context_error",
    }));
  }
}

async function nonStreamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
  onEvent: (ev: RunEvent) => void,
  lifecycle: StructuredLifecycle,
  attempt: number,
  callSite: StructuredCallSite,
): Promise<CallResult> {
  const params = buildChatParams(model, messages, opts);
  const requestStartMs = Date.now();
  const requestId = lifecycle.current().id;
  lifecycle.phase("sent");
  let response: OpenAI.Chat.ChatCompletion | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  try {
    lifecycle.phase("waiting");
    llm.beginPromptBudgetRequest?.(requestId);
    const request = llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    response = await request;
  } catch (error) {
    if (!llm.emitsPromptBudget) onEvent(createPromptBudgetEvent({
      requestId,
      callSite,
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      effectiveInputBudget: opts.inputBudgetTokens ?? 16_384,
      estimatedInputTokens: estimatePreparedMessages(
        params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ),
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      contextUnits: messages.length,
      retryReason: classifyContextError(error) === null
        ? undefined
        : "provider_context_error",
    }));
    throw error;
  }
  const emitBudget = (actualInputTokens?: number): void => {
    if (llm.emitsPromptBudget) return;
    onEvent(createPromptBudgetEvent({
      requestId,
      callSite,
      configuredInputBudget: opts.inputBudgetTokens ?? 16_384,
      effectiveInputBudget: opts.inputBudgetTokens ?? 16_384,
      estimatedInputTokens: estimatePreparedMessages(
        params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ),
      actualInputTokens,
      outputBudget: opts.maxTokens,
      compressionProfile: opts.semanticCompression?.profile ?? "balanced",
      contextUnits: messages.length,
    }));
  };
  if (
    response
    && typeof response === "object"
    && Symbol.asyncIterator in response
  ) {
    let fullText = "";
    let outputTokens = 0;
    let inputTokens: number | undefined;
    let finishReason: string | null | undefined;
    let producing = false;
    try {
      signal.throwIfAborted();
      for await (const chunk of response as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
        const reason = chunk.choices[0]?.finish_reason;
        if (reason !== undefined) finishReason = reason;
        const deltas = extractStreamDeltas(chunk);
        if (!producing && (deltas.reasoning.trim() || deltas.content.trim())) {
          lifecycle.phase("producing");
          producing = true;
        }
        if (deltas.reasoning) {
          onEvent({ kind: "assistant_text", delta: deltas.reasoning, isReasoning: true });
        }
        fullText += deltas.content;
        if (deltas.outputTokens !== undefined) outputTokens += deltas.outputTokens;
        if (deltas.inputTokens !== undefined) inputTokens = deltas.inputTokens;
      }
      signal.throwIfAborted();
      if (finishReason === "length") throw new StructuredOutputTruncatedError("length");
      return { fullText, outputTokens, inputTokens, finishReason };
    } finally {
      emitBudget(inputTokens);
    }
  }
  emitBudget(response.usage?.prompt_tokens);
  signal.throwIfAborted();
  if (response.choices[0]?.finish_reason === "length") {
    throw new StructuredOutputTruncatedError("length");
  }
  const message = response.choices[0]?.message;
  const reasoning = completionReasoning(message);
  const fullText = message?.content ?? "";
  if (reasoning.trim() || fullText.trim()) lifecycle.phase("producing");
  if (reasoning) onEvent({ kind: "assistant_text", delta: reasoning, isReasoning: true });
  signal.throwIfAborted();
  return {
    fullText,
    outputTokens: extractUsage(response) ?? 0,
    inputTokens: typeof response.usage?.prompt_tokens === "number"
      ? response.usage.prompt_tokens
      : undefined,
    finishReason: response.choices[0]?.finish_reason,
    statsEvent: response.usage
      ? buildLlmCallStatsEvent({
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          ttftMs: Math.max(0, Date.now() - requestStartMs),
          llmDurationMs: Math.max(1, Date.now() - requestStartMs),
        })
      : undefined,
  };
}

function parseAndValidate<T>(profile: StructuredProfile<T>, fullText: string): T {
  const raw = profile.kind === "json-zod"
    ? parseStructured(fullText)
    : profile.parse(fullText);
  const parsed = profile.schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

function classifyError<T>(profile: StructuredProfile<T>, err: Error): Extract<RunEvent, { kind: "structural_error" }>["errorType"] {
  if (profile.kind === "framed-zod" && !(err instanceof ZodError)) return "frame_parse";
  if (err instanceof ZodError) return "schema_validate";
  return "json_parse";
}

async function callWithFormatFallback<T>(
  args: RunStructuredArgs<T>,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  mode: ResponseFormatMode,
  attempt: number,
  lifecycle: StructuredLifecycle,
): Promise<{ result: CallResult; mode: ResponseFormatMode }> {
  let currentMode = mode;
  while (true) {
    lifecycle.begin(attempt, args.transport ?? "stream");
    const callOpts: LlmCallOptions = args.profile.kind === "json-zod"
      ? optsForMode(args.opts, currentMode, args.callSite, args.profile.schema)
      : { ...args.opts, jsonMode: false, jsonSchema: undefined };

    try {
      return {
        result: args.transport === "non-stream"
          ? await nonStreamOnce(args.llm, args.model, messages, callOpts, args.signal, args.onEvent, lifecycle, attempt, args.callSite)
          : await streamOnce(args.llm, args.model, messages, callOpts, args.signal, args.onEvent, lifecycle, attempt, args.callSite),
        mode: currentMode,
      };
    } catch (e) {
      if (
        classifyContextError(e) !== null
        || e instanceof PromptBudgetExceededError
      ) throw e;
      if (args.profile.kind !== "json-zod" || !isJsonModeError(e)) throw e;
      const next = fallbackMode(currentMode);
      if (!next) throw e;
      lifecycle.close("retrying");
      emitResponseFormatFallback(args.onEvent, args.callSite, attempt, currentMode, next);
      currentMode = next;
    }
  }
}

export async function runStructuredWithRetry<T>(args: RunStructuredArgs<T>): Promise<RunStructuredResult<T>> {
  const { baseMessages, profile, maxRetries, callSite, signal, onEvent } = args;
  let messages = baseMessages;
  let mode = initialMode(profile, args.opts);
  let totalTokens = 0;
  let lastError: Error = new Error("no attempts");
  const lifecycle = structuredLifecycle(args);

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      if (attempt > 0) onEvent({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });

      const call = await callWithFormatFallback(args, messages, mode, attempt, lifecycle);
      signal.throwIfAborted();
      mode = call.mode;
      const { fullText, outputTokens, inputTokens, statsEvent } = call.result;
      totalTokens += outputTokens;
      if (statsEvent) onEvent(statsEvent);

      if (!fullText.trim()) {
        lastError = new Error("Empty structured output");
        emitStructuralError(onEvent, callSite, "empty_output", attempt, null, lastError.message);
        structuralErrorCounter.record(null, attempt);

        const next = profile.kind === "json-zod" ? fallbackMode(mode) : null;
        if (next) {
          emitResponseFormatFallback(onEvent, callSite, attempt, mode, next);
          mode = next;
        }

        if (attempt === maxRetries) {
          lifecycle.close(args.validationExhaustionPhase ?? "failed");
          throw new StructuredValidationError(callSite, attempt + 1, lastError);
        }
        lifecycle.close("retrying");
        messages = [
          ...messages,
          { role: "assistant", content: fullText },
          { role: "user", content: repairPrompt(profile, fullText, lastError) },
        ];
        continue;
      }

      try {
        lifecycle.phase("validating");
        const value = parseAndValidate(profile, fullText);
        if (attempt > 0) {
          emitStructuralError(onEvent, callSite, "schema_validate", attempt, true, "retry succeeded");
        }
        structuralErrorCounter.record(true, attempt);
        return {
          value,
          outputTokens: totalTokens,
          inputTokens,
          fullText,
          lifecycle: lifecycle.current(),
        };
      } catch (e) {
        lastError = e as Error;
        const isLast = attempt === maxRetries;
        const errorType = classifyError(profile, lastError);
        emitStructuralError(onEvent, callSite, errorType, attempt, isLast ? false : null, lastError.message);
        structuralErrorCounter.record(isLast ? false : null, attempt);
        if (isLast) {
          lifecycle.close(args.validationExhaustionPhase ?? "failed");
          throw new StructuredValidationError(callSite, attempt + 1, lastError);
        }
        lifecycle.close("retrying");
        messages = [
          ...messages,
          { role: "assistant", content: fullText },
          { role: "user", content: repairPrompt(profile, fullText, lastError) },
        ];
      }
    }
    throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
  } catch (error) {
    if (lifecycle.isActive()) {
      lifecycle.close(
        signal.aborted || (error as Error).name === "AbortError"
          ? "cancelled"
          : args.contextErrorsRetry && classifyContextError(error) !== null
            ? "retrying"
          : "failed",
      );
    }
    throw error;
  }
}

export interface StructuredSink<T> {
  value?: T;
  inputTokens?: number;
  outputTokens?: number;
  fullText?: string;
  lifecycle?: { id: string; action: LlmLifecycleAction };
}

/**
 * Streaming wrapper over `runStructuredWithRetry`. Yields every RunEvent —
 * including the live reasoning/content deltas from streamOnce — as it is
 * produced, so a generator consumer can `yield*` them to the UI instead of
 * buffering until the call resolves. The parsed result lands in `sink`; a
 * structured failure is re-thrown out of the generator. `args.onEvent` is
 * ignored — the bridge installs its own.
 */
export async function* runStructuredStreaming<T>(
  args: RunStructuredArgs<T>,
  sink: StructuredSink<T>,
): AsyncGenerator<RunEvent> {
  const bridge = new RunEventBridge();
  const requestController = new AbortController();
  const forwardAbort = () => requestController.abort(args.signal.reason);
  if (args.signal.aborted) forwardAbort();
  else args.signal.addEventListener("abort", forwardAbort, { once: true });
  const work = runStructuredWithRetry({
    ...args,
    signal: requestController.signal,
    onEvent: (event) => bridge.push(event),
  }).then((r) => {
      sink.value = r.value;
      sink.inputTokens = r.inputTokens;
      sink.outputTokens = r.outputTokens;
      sink.fullText = r.fullText;
      sink.lifecycle = r.lifecycle;
    });
  try {
    yield* bridge.forward(work, () => requestController.abort());
  } finally {
    args.signal.removeEventListener("abort", forwardAbort);
  }
}
