import type { ModelContextRecord } from "./model-context";
import type { BudgetInputSource, OpKey } from "./types";

const SAFETY = 0.9;
export const DEFAULT_OUTPUT_BASE = 8_192;
/** A reply may never claim more than this share of the window. */
const OUTPUT_MAX_SHARE = 0.5;
/**
 * Vision's own ceiling share. A vision reply is one image description, not a
 * rewritten document, so it does not need format's half of the window — and at a
 * small window claiming half leaves less input than a single image costs, which
 * refuses every image before dispatch. A quarter clears one image at 8192, the
 * smallest window the settings field admits in practice.
 */
export const VISION_OUTPUT_MAX_SHARE = 0.25;

/**
 * What a vision call spends before the image itself: prompts/base.md plus
 * prompts/vision-image.md plus the language and reasoning directives, about 2.4k
 * characters. Rounded up, because it bounds a refusal rather than sizes a request.
 */
export const VISION_PROMPT_TOKENS = 700;

/**
 * True when a window leaves room for one image after the vision output share.
 *
 * The settings field admits anything from `MIN_CONTEXT_WINDOW` up, and a window
 * below this floor turns vision off rather than sizing it: every image is refused
 * client-side before dispatch, with nothing on the field to say why.
 */
export function visionWindowFitsOneImage(contextWindow: number, imageCost: number): boolean {
  const output = Math.max(1, Math.min(
    DEFAULT_OUTPUT_BASE,
    Math.floor(contextWindow * VISION_OUTPUT_MAX_SHARE),
  ));
  return Math.max(1, Math.floor((contextWindow - output) * SAFETY)) >= imageCost;
}

const OUTPUT_MULTIPLIER: Partial<Record<OpKey, number>> = { format: 4 };

export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  contextWindow: number;
  inputSource: BudgetInputSource;
  outputSource: "override" | "default";
  calibration: number;
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Evaluated in a fixed order so no value depends on one defined after it:
 * output base, output budget, input budget. The per-request output ceiling is
 * computed separately by `outputCeiling`, because it needs the packed prompt.
 */
export function resolveBudget(
  record: ModelContextRecord,
  operation: OpKey,
  overrides: { input?: number; output?: number },
  // Vision runs inside `format` and keeps its overrides, but not its output
  // ceiling share. Passing the share rather than adding a `vision` OpKey keeps
  // `settings.nativeAgent.operations` — which is keyed by OpKey — unchanged.
  policy: { outputMaxShare?: number } = {},
): ResolvedBudget {
  const outputOverride = positive(overrides.output);
  const inputOverride = positive(overrides.input);

  // The multiplier scales the DEFAULT only. An override is already the value the
  // user chose: multiplying a stored format.maxTokens of 32768 by four would turn
  // it into 131072 and silently change what a saved setting means.
  const outputBudgetTokens = Math.max(1, Math.min(
    outputOverride ?? DEFAULT_OUTPUT_BASE * (OUTPUT_MULTIPLIER[operation] ?? 1),
    Math.floor(record.contextWindow * (policy.outputMaxShare ?? OUTPUT_MAX_SHARE)),
  ));
  // The ceiling for BOTH the derived value and an override. Clamping an
  // override to the whole window would let input + output exceed the context:
  // window 8192, override 8192, output 4096 sums to 12288.
  const maxInput = Math.max(1, Math.floor((record.contextWindow - outputBudgetTokens) * SAFETY));
  const inputBudgetTokens = Math.min(inputOverride ?? maxInput, maxInput);

  return {
    inputBudgetTokens,
    outputBudgetTokens,
    contextWindow: record.contextWindow,
    inputSource: inputOverride === undefined ? record.source : "override",
    outputSource: outputOverride === undefined ? "default" : "override",
    calibration: record.calibration,
  };
}

/** Computed per request, after packing, so a truncated reply has room to grow. */
export function outputCeiling(contextWindow: number, estimatedInput: number): number {
  return Math.max(1, contextWindow - Math.max(0, estimatedInput));
}
