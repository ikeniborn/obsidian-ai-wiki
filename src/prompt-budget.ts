import type OpenAI from "openai";
import type { CompressionProfile, LlmCallOptions, RunEvent } from "./types";

const MEDIA_TOKENS = 4_096;
const MAX_CONTEXT_REPACKS = 2;

export interface ContextUnit {
  id: string;
  source: "system" | "schema" | "source" | "evidence" | "wiki" | "registry";
  text: string;
  required: boolean;
  priority: number;
  estimatedTokens: number;
}

export interface PackedPrompt {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  selected: ContextUnit[];
  omitted: ContextUnit[];
  estimatedInputTokens: number;
}

export class PromptBudgetExceededError extends Error {
  constructor(
    readonly budget: number,
    readonly estimated: number,
    readonly requiredIds: string[],
  ) {
    super(`Prompt requires ${estimated} estimated tokens but budget is ${budget}`);
    this.name = "PromptBudgetExceededError";
  }
}

interface SanitizedValue {
  value: unknown;
  mediaParts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeMedia(value: unknown): SanitizedValue {
  if (Array.isArray(value)) {
    let mediaParts = 0;
    const sanitized = value.map((item) => {
      const result = sanitizeMedia(item);
      mediaParts += result.mediaParts;
      return result.value;
    });
    return { value: sanitized, mediaParts };
  }

  if (!isRecord(value)) return { value, mediaParts: 0 };

  let mediaParts = value.type === "image_url" ? 1 : 0;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const result = sanitizeMedia(item);
    mediaParts += result.mediaParts;
    if (key === "image_url" && isRecord(result.value)) {
      sanitized[key] = { ...result.value, url: "[media]" };
    } else {
      sanitized[key] = result.value;
    }
  }
  return { value: sanitized, mediaParts };
}

export function estimatePreparedMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): number {
  const sanitized = sanitizeMedia(messages);
  const serialized = JSON.stringify(sanitized.value) ?? "";
  return new TextEncoder().encode(serialized).byteLength + sanitized.mediaParts * MEDIA_TOKENS;
}

export interface PackContextUnitsArgs {
  inputBudgetTokens: number;
  fixedMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  units: ContextUnit[];
  render: (
    units: ContextUnit[],
    opts: LlmCallOptions,
  ) => OpenAI.Chat.ChatCompletionMessageParam[];
}

export function packContextUnits(args: PackContextUnitsArgs): PackedPrompt {
  const required = args.units.filter((unit) => unit.required);
  const optional = args.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => !unit.required)
    .sort((a, b) => b.unit.priority - a.unit.priority
      || a.unit.id.localeCompare(b.unit.id)
      || a.index - b.index)
    .map(({ unit }) => unit);

  const selected: ContextUnit[] = [];
  const omitted: ContextUnit[] = [];
  let messages = [...args.fixedMessages];
  let estimatedInputTokens = estimatePreparedMessages(messages);

  if (estimatedInputTokens > args.inputBudgetTokens) {
    throw new PromptBudgetExceededError(args.inputBudgetTokens, estimatedInputTokens, []);
  }

  for (const unit of required) {
    selected.push(unit);
    messages = args.render([...selected], args.opts);
    estimatedInputTokens = estimatePreparedMessages(messages);
  }

  if (estimatedInputTokens > args.inputBudgetTokens) {
    throw new PromptBudgetExceededError(
      args.inputBudgetTokens,
      estimatedInputTokens,
      required.map((unit) => unit.id),
    );
  }

  for (const unit of optional) {
    const candidate = [...selected, unit];
    const candidateMessages = args.render(candidate, args.opts);
    const candidateEstimate = estimatePreparedMessages(candidateMessages);
    if (candidateEstimate <= args.inputBudgetTokens) {
      selected.push(unit);
      messages = candidateMessages;
      estimatedInputTokens = candidateEstimate;
    } else {
      omitted.push(unit);
    }
  }

  return { messages, selected, omitted, estimatedInputTokens };
}

export interface ContextErrorDetails {
  promptTokens?: number;
  maxContextTokens?: number;
}

const CONTEXT_ERROR_CODES = new Set([
  "context_length_exceeded",
  "context_window_exceeded",
  "input_too_long",
  "max_context_length_exceeded",
  "prompt_too_long",
  "too_many_tokens",
]);

const CONTEXT_MESSAGE_PATTERN = /context (?:length|limit|size|window)|maximum context|prompt (?:is )?too long|prompt size|too many tokens|token limit|input (?:is )?too long/i;
const TOKEN_NUMBER = "(\\d[\\d,_]*)";

function parseTokenCount(value: string): number {
  return Number.parseInt(value.replace(/[, _]/g, ""), 10);
}

function extractContextCounts(message: string): ContextErrorDetails {
  const promptThenMax = new RegExp(
    `(?:prompt(?:\\s+size)?|messages?|input|requested)[^\\d]{0,50}${TOKEN_NUMBER}(?:\\s+tokens?)?[\\s\\S]{0,100}?(?:exceeds?|>|over)[\\s\\S]{0,60}?(?:maximum\\s+context(?:\\s+length)?|max(?:imum)?\\s+context|context\\s+(?:length|window))[^\\d]{0,30}${TOKEN_NUMBER}`,
    "i",
  ).exec(message);
  if (promptThenMax) {
    return {
      promptTokens: parseTokenCount(promptThenMax[1]),
      maxContextTokens: parseTokenCount(promptThenMax[2]),
    };
  }

  const maxThenPrompt = new RegExp(
    `(?:maximum\\s+context(?:\\s+length)?|context\\s+(?:length|window))[^\\d]{0,30}${TOKEN_NUMBER}(?:\\s+tokens?)?[\\s\\S]{0,140}?(?:messages?|prompt|input|requested)[^\\d]{0,50}${TOKEN_NUMBER}`,
    "i",
  ).exec(message);
  if (maxThenPrompt) {
    return {
      promptTokens: parseTokenCount(maxThenPrompt[2]),
      maxContextTokens: parseTokenCount(maxThenPrompt[1]),
    };
  }

  const greaterThanMaximum = new RegExp(
    `${TOKEN_NUMBER}(?:\\s+tokens?)?\\s*>\\s*${TOKEN_NUMBER}(?:\\s+tokens?)?\\s*(?:maximum|max)?`,
    "i",
  ).exec(message);
  if (greaterThanMaximum) {
    return {
      promptTokens: parseTokenCount(greaterThanMaximum[1]),
      maxContextTokens: parseTokenCount(greaterThanMaximum[2]),
    };
  }

  return {};
}

export function classifyContextError(error: unknown): ContextErrorDetails | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const nested = isRecord(record.error) ? record.error : undefined;
  const code = String(record.code ?? nested?.code ?? "").toLowerCase();
  const type = String(record.type ?? nested?.type ?? "").toLowerCase();
  const message = String(record.message ?? nested?.message ?? "");
  const classified = CONTEXT_ERROR_CODES.has(code)
    || CONTEXT_ERROR_CODES.has(type)
    || CONTEXT_MESSAGE_PATTERN.test(message);
  return classified ? extractContextCounts(message) : null;
}

export function shrinkInputBudget(
  currentBudget: number,
  details: ContextErrorDetails,
): number {
  if (
    details.promptTokens !== undefined
    && details.maxContextTokens !== undefined
    && details.promptTokens > 0
    && details.maxContextTokens > 0
  ) {
    return Math.floor(currentBudget * details.maxContextTokens / details.promptTokens * 0.9);
  }
  return Math.floor(currentBudget * 0.75);
}

export type PromptBudgetRetryReason =
  | "preflight_budget_exceeded"
  | "provider_context_error";

export interface PromptBudgetMetadata {
  callSite: string;
  configuredInputBudget: number;
  effectiveInputBudget: number;
  estimatedInputTokens: number;
  actualInputTokens?: number;
  outputBudget?: number;
  compressionProfile: CompressionProfile;
  contextUnits: number;
  sourceChunks?: number;
  reductionDepth?: number;
  retryReason?: PromptBudgetRetryReason;
}

export type PromptBudgetEvent = Extract<RunEvent, { kind: "prompt_budget" }>;

export function createPromptBudgetEvent(metadata: PromptBudgetMetadata): PromptBudgetEvent {
  const event: PromptBudgetEvent = {
    kind: "prompt_budget",
    callSite: metadata.callSite,
    configuredInputBudget: metadata.configuredInputBudget,
    effectiveInputBudget: metadata.effectiveInputBudget,
    estimatedInputTokens: metadata.estimatedInputTokens,
    compressionProfile: metadata.compressionProfile,
    contextUnits: metadata.contextUnits,
  };
  if (metadata.actualInputTokens !== undefined) event.actualInputTokens = metadata.actualInputTokens;
  if (metadata.outputBudget !== undefined) event.outputBudget = metadata.outputBudget;
  if (metadata.sourceChunks !== undefined) event.sourceChunks = metadata.sourceChunks;
  if (metadata.reductionDepth !== undefined) event.reductionDepth = metadata.reductionDepth;
  if (metadata.retryReason !== undefined) event.retryReason = metadata.retryReason;
  return event;
}

export interface ContextRepackBuild<T> {
  value: T;
  estimatedInputTokens: number;
  contextUnits: number;
  sourceChunks?: number;
  reductionDepth?: number;
}

export interface RunWithContextRepackArgs<TBuild, TResult> {
  callSite: string;
  configuredInputBudget: number;
  outputBudget?: number;
  compressionProfile: CompressionProfile;
  build: (
    effectiveInputBudget: number,
  ) => ContextRepackBuild<TBuild> | Promise<ContextRepackBuild<TBuild>>;
  execute: (value: TBuild) => TResult | Promise<TResult>;
  onEvent: (event: PromptBudgetEvent) => void;
}

function resultInputTokens(result: unknown): number | undefined {
  if (!isRecord(result)) return undefined;
  return typeof result.inputTokens === "number" ? result.inputTokens : undefined;
}

export async function runWithContextRepack<TBuild, TResult>(
  args: RunWithContextRepackArgs<TBuild, TResult>,
): Promise<TResult> {
  let effectiveInputBudget = args.configuredInputBudget;

  for (let attempt = 0; attempt <= MAX_CONTEXT_REPACKS; attempt++) {
    let built: ContextRepackBuild<TBuild> | undefined;
    try {
      built = await args.build(effectiveInputBudget);
      const result = await args.execute(built.value);
      args.onEvent(createPromptBudgetEvent({
        callSite: args.callSite,
        configuredInputBudget: args.configuredInputBudget,
        effectiveInputBudget,
        estimatedInputTokens: built.estimatedInputTokens,
        actualInputTokens: resultInputTokens(result),
        outputBudget: args.outputBudget,
        compressionProfile: args.compressionProfile,
        contextUnits: built.contextUnits,
        sourceChunks: built.sourceChunks,
        reductionDepth: built.reductionDepth,
      }));
      return result;
    } catch (error) {
      const details = classifyContextError(error);
      const preflight = error instanceof PromptBudgetExceededError;
      const retryReason = preflight
        ? "preflight_budget_exceeded"
        : details !== null
          ? "provider_context_error"
          : undefined;

      args.onEvent(createPromptBudgetEvent({
        callSite: args.callSite,
        configuredInputBudget: args.configuredInputBudget,
        effectiveInputBudget,
        estimatedInputTokens: built?.estimatedInputTokens
          ?? (preflight ? error.estimated : effectiveInputBudget),
        outputBudget: args.outputBudget,
        compressionProfile: args.compressionProfile,
        contextUnits: built?.contextUnits
          ?? (preflight ? error.requiredIds.length : 0),
        sourceChunks: built?.sourceChunks,
        reductionDepth: built?.reductionDepth,
        retryReason,
      }));

      if (retryReason === undefined || attempt === MAX_CONTEXT_REPACKS) throw error;
      effectiveInputBudget = shrinkInputBudget(effectiveInputBudget, details ?? {});
    }
  }

  throw new Error("unreachable context-repack state");
}
