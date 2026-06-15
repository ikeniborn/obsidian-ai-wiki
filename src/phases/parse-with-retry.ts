import type OpenAI from "openai";
import type { z } from "zod";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmClient, LlmCallOptions, RunEvent } from "../types";
import {
  parseStructured, buildChatParams, extractStreamDeltas, extractUsage,
  wrapStreamWithStats, buildLlmCallStatsEvent,
} from "./llm-utils";
import type { LlmStreamStats } from "./llm-utils";
import { structuralErrorCounter } from "../structural-error-counter";
import { render } from "./template";
import repairJson from "../../prompts/repair-json.md";

export type CallSite =
  | "init.bootstrap"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.entities"
  | "ingest.pages"
  | "ingest.merge"
  | "format.output";

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: CallSite,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = "StructuredValidationError";
  }
}

export interface ParseWithRetryArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  schema: z.ZodSchema<T>;
  maxRetries: number;
  callSite: CallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export interface ParseWithRetryResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;
}

export function formatZodFeedback(err: ZodError | null, raw: string): string {
  if (err === null) {
    const detail = ["Previous response was not valid JSON.", `Raw output (truncated):`, raw.slice(0, 2000)].join("\n");
    return render(repairJson, { detail });
  }
  const bullets = err.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `- ${path}: ${i.message}`;
  }).join("\n");
  const detail = ["Previous response failed validation:", bullets].join("\n");
  return render(repairJson, { detail });
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ fullText: string; outputTokens: number; stats: LlmStreamStats | undefined }> {
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
      const { content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (content) fullText += content;
      if (tok !== undefined) outputTokens += tok;
    }
    return { fullText, outputTokens, stats: getStats() };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") throw e;
    const params2 = buildChatParams(model, messages, opts);
    const resp = await llm.chat.completions.create(
      { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    const text = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    return { fullText: text, outputTokens: tok ?? 0, stats: undefined };
  }
}

export async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<ParseWithRetryResult<T>> {
  const { llm, model, baseMessages, schema, maxRetries, callSite, signal, onEvent } = args;

  // Upgrade json_object → json_schema with auto-generated schema for supporting backends.
  // superRefine rules (e.g. WikiLink checks) are not expressible in JSON Schema and are
  // skipped here — Zod still validates them after parsing.
  const opts: LlmCallOptions =
    (args.opts.jsonMode === "json_object" || args.opts.jsonMode === "json_schema")
      ? {
          ...args.opts,
          jsonMode: "json_schema",
          jsonSchema: {
            name: callSite.replace(/\./g, "_"),
            schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
          },
        }
      : args.opts;

  let messages: OpenAI.Chat.ChatCompletionMessageParam[] = baseMessages;
  let totalTokens = 0;
  let lastError: Error = new Error("no attempts");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    const { fullText, outputTokens, stats } = await streamOnce(llm, model, messages, opts, signal);
    totalTokens += outputTokens;
    if (stats) onEvent(buildLlmCallStatsEvent(stats));

    let raw: unknown;
    try {
      raw = parseStructured(fullText);
    } catch (e) {
      lastError = e as Error;
      const isLast = attempt === maxRetries;
      const ev: RunEvent = {
        kind: "structural_error",
        callSite,
        errorType: "json_parse",
        retryAttempt: attempt,
        succeeded: isLast ? false : null,
        message: lastError.message,
      };
      onEvent(ev);
      structuralErrorCounter.record(ev.succeeded, attempt);
      if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      const feedback = formatZodFeedback(null, fullText);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: feedback },
      ];
      continue;
    }

    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      if (attempt > 0) {
        const ev: RunEvent = {
          kind: "structural_error",
          callSite,
          errorType: "schema_validate",
          retryAttempt: attempt,
          succeeded: true,
          message: "retry succeeded",
        };
        onEvent(ev);
      }
      structuralErrorCounter.record(true, attempt);
      return { value: parsed.data, outputTokens: totalTokens, fullText };
    }

    lastError = parsed.error;
    const isLast = attempt === maxRetries;
    const feedback = formatZodFeedback(parsed.error, fullText);
    const ev: RunEvent = {
      kind: "structural_error",
      callSite,
      errorType: "schema_validate",
      retryAttempt: attempt,
      succeeded: isLast ? false : null,
      message: feedback,
    };
    onEvent(ev);
    structuralErrorCounter.record(ev.succeeded, attempt);
    if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
    messages = [
      ...messages,
      { role: "assistant", content: fullText },
      { role: "user", content: feedback },
    ];
  }

  // unreachable; satisfies TS
  throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
}
