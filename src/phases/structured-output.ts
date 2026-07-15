import type OpenAI from "openai";
import type { z } from "zod";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import { structuralErrorCounter } from "../structural-error-counter";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  extractStreamDeltas,
  extractUsage,
  isJsonModeError,
  parseStructured,
  wrapStreamWithStats,
} from "./llm-utils";
import { render } from "./template";

const repairJson = [
  "{{detail}}",
  "",
  "Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.",
].join("\n");

export type StructuredCallSite =
  | "init.bootstrap"
  | "init.delta"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds" | "query.answer"
  | "ingest.entities"
  | "ingest.pages"
  | "ingest.merge"
  | "format.output";

type ResponseFormatMode = "json_schema" | "json_object" | "none";

export type StructuredProfile<T> =
  | { kind: "json-zod"; schema: z.ZodSchema<T> }
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

export interface RunStructuredArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  profile: StructuredProfile<T>;
  maxRetries: number;
  callSite: StructuredCallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export interface RunStructuredResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;
}

interface CallResult {
  fullText: string;
  outputTokens: number;
  statsEvent?: RunEvent;
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
  return lastError instanceof ZodError
    ? formatZodFeedback(lastError, lastText)
    : formatZodFeedback(null, lastText);
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
  onEvent: (ev: RunEvent) => void,
): Promise<CallResult> {
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;

  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) onEvent({ kind: "assistant_text", delta: reasoning, isReasoning: true });
      if (content) {
        fullText += content;
        onEvent({ kind: "assistant_text", delta: content });
      }
      if (tok !== undefined) outputTokens = tok;
    }
    const stats = getStats();
    return {
      fullText,
      outputTokens,
      statsEvent: stats ? buildLlmCallStatsEvent(stats) : undefined,
    };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError" || isJsonModeError(e)) throw e;
    const params2 = buildChatParams(model, messages, opts);
    const resp = await llm.chat.completions.create(
      { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    return {
      fullText: resp.choices[0]?.message?.content ?? "",
      outputTokens: extractUsage(resp) ?? 0,
    };
  }
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
): Promise<{ result: CallResult; mode: ResponseFormatMode }> {
  let currentMode = mode;
  while (true) {
    const callOpts: LlmCallOptions = args.profile.kind === "json-zod"
      ? optsForMode(args.opts, currentMode, args.callSite, args.profile.schema)
      : { ...args.opts, jsonMode: false, jsonSchema: undefined };

    try {
      return {
        result: await streamOnce(args.llm, args.model, messages, callOpts, args.signal, args.onEvent),
        mode: currentMode,
      };
    } catch (e) {
      if (args.profile.kind !== "json-zod" || !isJsonModeError(e)) throw e;
      const next = fallbackMode(currentMode);
      if (!next) throw e;
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (attempt > 0) onEvent({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });

    const call = await callWithFormatFallback(args, messages, mode, attempt);
    mode = call.mode;
    const { fullText, outputTokens, statsEvent } = call.result;
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

      if (attempt === maxRetries) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: repairPrompt(profile, fullText, lastError) },
      ];
      continue;
    }

    try {
      const value = parseAndValidate(profile, fullText);
      if (attempt > 0) {
        emitStructuralError(onEvent, callSite, "schema_validate", attempt, true, "retry succeeded");
      }
      structuralErrorCounter.record(true, attempt);
      return { value, outputTokens: totalTokens, fullText };
    } catch (e) {
      lastError = e as Error;
      const isLast = attempt === maxRetries;
      const errorType = classifyError(profile, lastError);
      emitStructuralError(onEvent, callSite, errorType, attempt, isLast ? false : null, lastError.message);
      structuralErrorCounter.record(isLast ? false : null, attempt);
      if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: repairPrompt(profile, fullText, lastError) },
      ];
    }
  }

  throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
}

export interface StructuredSink<T> {
  value?: T;
  outputTokens?: number;
  fullText?: string;
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
  const queue: RunEvent[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let error: unknown = null;
  const onEvent = (ev: RunEvent) => { queue.push(ev); wake?.(); };

  const p = runStructuredWithRetry({ ...args, onEvent })
    .then((r) => { sink.value = r.value; sink.outputTokens = r.outputTokens; sink.fullText = r.fullText; })
    .catch((e) => { error = e; })
    .finally(() => { settled = true; wake?.(); });

  while (!settled || queue.length) {
    while (queue.length) yield queue.shift()!;
    if (!settled) await new Promise<void>((res) => { wake = () => { wake = null; res(); }; });
  }
  await p;
  if (error) throw error as Error;
}
