import type OpenAI from "openai";
import type { z } from "zod";
import type { LlmCallOptions, LlmClient, LlmLifecycleAction, RunEvent } from "../types";
import {
  formatZodFeedback,
  runStructuredWithRetry,
  StructuredValidationError,
  type RunStructuredResult,
  type StructuredCallSite,
} from "./structured-output";

export type CallSite = StructuredCallSite;
export { formatZodFeedback, StructuredValidationError };

export interface ParseWithRetryArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  schema: z.ZodSchema<T>;
  maxRetries: number;
  callSite: CallSite;
  lifecycle: { id: string; action: LlmLifecycleAction };
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
  transport?: "stream" | "non-stream";
}

export type ParseWithRetryResult<T> = RunStructuredResult<T>;

export async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<ParseWithRetryResult<T>> {
  return runStructuredWithRetry({
    llm: args.llm,
    model: args.model,
    baseMessages: args.baseMessages,
    opts: args.opts,
    profile: { kind: "json-zod", schema: args.schema },
    maxRetries: args.maxRetries,
    callSite: args.callSite,
    lifecycle: args.lifecycle,
    signal: args.signal,
    onEvent: args.onEvent,
    transport: args.transport,
  });
}
