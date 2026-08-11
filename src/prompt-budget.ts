import type OpenAI from "openai";
import type {
  CompressionProfile,
  LlmCallOptions,
  RunEvent,
  StructuredCallSite,
} from "./types";
import { MEDIA_TOKENS, estimateMessages } from "./token-estimate";

export { MEDIA_TOKENS };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function estimatePreparedMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  calibration?: number,
): number {
  return estimateMessages(messages, calibration);
}

export interface PackContextUnitsArgs {
  inputBudgetTokens: number;
  /** Compatibility input for renderers; the returned render output is authoritative. */
  fixedMessages: readonly OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  units: ContextUnit[];
  render: (
    units: readonly Readonly<ContextUnit>[],
    opts: LlmCallOptions,
    fixedMessages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  ) => OpenAI.Chat.ChatCompletionMessageParam[];
}

function compareCodePointIds(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function packContextUnits(args: PackContextUnitsArgs): PackedPrompt {
  const ids = new Set<string>();
  for (const unit of args.units) {
    if (ids.has(unit.id)) throw new Error(`Duplicate context unit id: ${unit.id}`);
    ids.add(unit.id);
  }

  const required = args.units.filter((unit) => unit.required);
  const optional = args.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => !unit.required)
    .sort((a, b) => b.unit.priority - a.unit.priority
      || compareCodePointIds(a.unit.id, b.unit.id)
      || a.index - b.index)
    .map(({ unit }) => unit);

  const selected: ContextUnit[] = [];
  const omitted: ContextUnit[] = [];
  const render = (units: ContextUnit[]) => args.render(
    units.map((unit) => ({ ...unit })),
    args.opts,
    args.fixedMessages,
  );
  let messages = render(selected);
  let estimatedInputTokens = estimatePreparedMessages(messages, args.opts.tokenCalibration);

  if (estimatedInputTokens > args.inputBudgetTokens) {
    throw new PromptBudgetExceededError(args.inputBudgetTokens, estimatedInputTokens, []);
  }

  for (const unit of required) {
    selected.push(unit);
    messages = render(selected);
    estimatedInputTokens = estimatePreparedMessages(messages, args.opts.tokenCalibration);
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
    const candidateMessages = render(candidate);
    const candidateEstimate = estimatePreparedMessages(candidateMessages, args.opts.tokenCalibration);
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
]);

const INPUT_SEMANTICS = /\b(?:input|prompt|messages?)\b/i;
const CONTEXT_SEMANTICS = /\bcontext(?:\s+(?:length|limit|size|window))?\b/i;
const OUTPUT_SEMANTICS = /\b(?:completion|generated|output)\b/i;
const NON_CONTEXT_ERROR_SEMANTICS = /\b(?:account|billing|credits?|deadline|quota|rate\s+limit|time(?:d)?\s*out|timeout)\b/i;
// No bare ">" alternative: unlike the words below, a lone ">" appears in
// arbitrary non-overflow text (e.g. a "->" conversion example echoed from an
// unrelated validation error) and is not itself a reliable overflow signal.
// Numeric "N > M" comparisons are still classified via reportedOverflow
// below, which requires actual digit sequences on both sides through
// extractContextCounts's greaterThanMaximum pattern.
const OVERFLOW_RELATION = /\b(?:exceeds?|exceeded|exceeding|overflow(?:ed)?|too\s+(?:long|large|many)|over\s+(?:the\s+)?(?:limit|maximum)|greater\s+than|more\s+than|beyond)\b/i;
const TOKEN_NUMBER = "(\\d[\\d,_]*)";
const MAXIMUM_INPUT = "(?:maximum\\s+context(?:\\s+length)?|max(?:imum)?\\s+context|context\\s+(?:length|window)|maximum(?:\\s+number)?\\s+of\\s+tokens(?:\\s+allowed)?|maximum\\s+tokens(?:\\s+allowed)?)";

function parseTokenCount(value: string): number {
  return Number.parseInt(value.replace(/[, _]/g, ""), 10);
}

function extractContextCounts(message: string): ContextErrorDetails {
  const promptThenMax = new RegExp(
    `(?:prompt(?:\\s+size)?|messages?|input|requested)[^\\d]{0,50}${TOKEN_NUMBER}(?:\\s+tokens?)?[\\s\\S]{0,100}?(?:exceeds?|>|over)[\\s\\S]{0,60}?${MAXIMUM_INPUT}[^\\d]{0,30}${TOKEN_NUMBER}`,
    "i",
  ).exec(message);
  if (promptThenMax) {
    return {
      promptTokens: parseTokenCount(promptThenMax[1]),
      maxContextTokens: parseTokenCount(promptThenMax[2]),
    };
  }

  const maxThenPrompt = new RegExp(
    `${MAXIMUM_INPUT}[^\\d]{0,30}${TOKEN_NUMBER}(?:\\s+tokens?)?[\\s\\S]{0,140}?(?:messages?|prompt|input|requested)[^\\d]{0,50}${TOKEN_NUMBER}`,
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

function classifyContextMessage(message: string): ContextErrorDetails | null {
  const details = extractContextCounts(message);
  const hasInput = INPUT_SEMANTICS.test(message);
  const hasContext = CONTEXT_SEMANTICS.test(message);
  if ((!hasInput && !hasContext) || NON_CONTEXT_ERROR_SEMANTICS.test(message)) return null;
  if (OUTPUT_SEMANTICS.test(message) && (!hasInput || !hasContext)) return null;

  const reportedOverflow = details.promptTokens !== undefined
    && details.maxContextTokens !== undefined
    && details.promptTokens > details.maxContextTokens;
  return OVERFLOW_RELATION.test(message) || reportedOverflow ? details : null;
}

export function classifyContextError(error: unknown): ContextErrorDetails | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  // A structured-output schema/validation failure is never a context-overflow
  // signal, even when its message happens to contain overflow-shaped text
  // (e.g. an echoed Zod issue mentioning "message", or an example containing
  // a bare "->" that the OVERFLOW_RELATION fallback below would misread as
  // ">"). Exclude it here rather than loosening the regexes, which stay
  // meaningful for actual provider error text.
  if (record.name === "StructuredValidationError") return null;
  const nested = isRecord(record.error) ? record.error : undefined;
  const codes = [record.code, record.type, nested?.code, nested?.type]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  const messages = [record.message, nested?.message]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const details = messages
    .map(extractContextCounts)
    .find((value) => value.promptTokens !== undefined || value.maxContextTokens !== undefined)
    ?? {};

  if (codes.some((value) => CONTEXT_ERROR_CODES.has(value))) return details;
  for (const message of messages) {
    const classified = classifyContextMessage(message);
    if (classified !== null) return classified;
  }
  return null;
}

export function shrinkInputBudget(
  currentBudget: number,
  details: ContextErrorDetails,
): number {
  if (currentBudget <= 1) return currentBudget;

  let next: number;
  if (
    details.promptTokens !== undefined
    && details.maxContextTokens !== undefined
    && details.promptTokens > 0
    && details.maxContextTokens > 0
    && details.maxContextTokens < details.promptTokens
  ) {
    next = Math.floor(currentBudget * details.maxContextTokens / details.promptTokens * 0.9);
  } else {
    next = Math.floor(currentBudget * 0.75);
  }
  return Math.max(1, Math.min(currentBudget - 1, next));
}

export type PromptBudgetRetryReason =
  | "preflight_budget_exceeded"
  | "provider_context_error"
  | "response_start_timeout";

export interface PromptBudgetMetadata {
  requestId: string;
  callSite: StructuredCallSite;
  configuredInputBudget: number;
  effectiveInputBudget: number;
  estimatedInputTokens: number;
  actualInputTokens?: number;
  outputBudget?: number;
  compressionProfile?: CompressionProfile;
  contextUnits: number;
  sourceChunks?: number;
  reductionDepth?: number;
  retryReason?: PromptBudgetRetryReason;
  contextWindow?: number;
  inputSource?: "override" | "discovered" | "learned" | "default";
  outputSource?: "override" | "default";
  calibration?: number;
}

export type PromptBudgetEvent = Extract<RunEvent, { kind: "prompt_budget" }>;

export function createPromptBudgetEvent(metadata: PromptBudgetMetadata): PromptBudgetEvent {
  const event: PromptBudgetEvent = {
    kind: "prompt_budget",
    requestId: metadata.requestId,
    callSite: metadata.callSite,
    configuredInputBudget: metadata.configuredInputBudget,
    effectiveInputBudget: metadata.effectiveInputBudget,
    estimatedInputTokens: metadata.estimatedInputTokens,
    contextUnits: metadata.contextUnits,
  };
  if (metadata.compressionProfile !== undefined) event.compressionProfile = metadata.compressionProfile;
  if (metadata.actualInputTokens !== undefined) event.actualInputTokens = metadata.actualInputTokens;
  if (metadata.outputBudget !== undefined) event.outputBudget = metadata.outputBudget;
  if (metadata.sourceChunks !== undefined) event.sourceChunks = metadata.sourceChunks;
  if (metadata.reductionDepth !== undefined) event.reductionDepth = metadata.reductionDepth;
  if (metadata.retryReason !== undefined) event.retryReason = metadata.retryReason;
  if (metadata.contextWindow !== undefined) event.contextWindow = metadata.contextWindow;
  if (metadata.inputSource !== undefined) event.inputSource = metadata.inputSource;
  if (metadata.outputSource !== undefined) event.outputSource = metadata.outputSource;
  if (metadata.calibration !== undefined) event.calibration = metadata.calibration;
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
  callSite: StructuredCallSite;
  configuredInputBudget: number;
  outputBudget?: number;
  compressionProfile: CompressionProfile;
  build: (
    effectiveInputBudget: number,
  ) => ContextRepackBuild<TBuild> | Promise<ContextRepackBuild<TBuild>>;
  execute: (value: TBuild) => TResult | Promise<TResult>;
  onEvent: (event: PromptBudgetEvent) => void;
  /**
   * Every provider context rejection seen inside this boundary, including the ones
   * the repack then recovers from. A terminal `catch` never sees a recovered
   * overflow, and that is exactly the signal the model context learns from.
   */
  onContextError?: (details: ContextErrorDetails) => void;
  classifyRepackError?: (error: unknown) => PromptBudgetRetryReason | undefined;
  requestBudgetsEmittedByExecute?: boolean;
  requestId?: (result?: TResult) => string | undefined;
}

export class ContextRepackSuppressedError extends Error {
  constructor(readonly original: unknown) {
    super("Context repack suppressed after stream output");
    this.name = "ContextRepackSuppressedError";
  }
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
    let outcome:
      | { ok: true; built: ContextRepackBuild<TBuild>; result: TResult }
      | { ok: false; error: unknown };
    try {
      built = await args.build(effectiveInputBudget);
      outcome = { ok: true, built, result: await args.execute(built.value) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    if (outcome.ok) {
      const requestId = args.requestId?.(outcome.result);
      if (!args.requestBudgetsEmittedByExecute && requestId) {
        args.onEvent(createPromptBudgetEvent({
          requestId,
          callSite: args.callSite,
          configuredInputBudget: args.configuredInputBudget,
          effectiveInputBudget,
          estimatedInputTokens: outcome.built.estimatedInputTokens,
          actualInputTokens: resultInputTokens(outcome.result),
          outputBudget: args.outputBudget,
          compressionProfile: args.compressionProfile,
          contextUnits: outcome.built.contextUnits,
          sourceChunks: outcome.built.sourceChunks,
          reductionDepth: outcome.built.reductionDepth,
        }));
      }
      return outcome.result;
    }

    const error = outcome.error;
    const repackSuppressed = error instanceof ContextRepackSuppressedError;
    const details = repackSuppressed ? null : classifyContextError(error);
    if (details !== null) args.onContextError?.(details);
    const preflight = error instanceof PromptBudgetExceededError;
    const additionalRetryReason = !repackSuppressed && !preflight && details === null
      ? args.classifyRepackError?.(error)
      : undefined;
    const retryReason = preflight
      ? "preflight_budget_exceeded"
      : details !== null
        ? "provider_context_error"
        : additionalRetryReason;

    const requestId = args.requestId?.();
    if (!args.requestBudgetsEmittedByExecute && requestId && built) {
      args.onEvent(createPromptBudgetEvent({
        requestId,
        callSite: args.callSite,
        configuredInputBudget: args.configuredInputBudget,
        effectiveInputBudget,
        estimatedInputTokens: built.estimatedInputTokens,
        outputBudget: args.outputBudget,
        compressionProfile: args.compressionProfile,
        contextUnits: built.contextUnits,
        sourceChunks: built.sourceChunks,
        reductionDepth: built.reductionDepth,
        retryReason,
      }));
    }

    if (repackSuppressed) throw error.original;
    if (preflight) throw error;
    if (
      retryReason === undefined
      || attempt === MAX_CONTEXT_REPACKS
      || effectiveInputBudget <= 1
    ) throw error;
    effectiveInputBudget = shrinkInputBudget(effectiveInputBudget, details ?? {});
  }

  throw new Error("unreachable context-repack state");
}
