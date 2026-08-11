import type { ModelContextRecord } from "./model-context";
import type { OpKey } from "./types";

export const SAFETY = 0.9;
export const DEFAULT_OUTPUT_BASE = 8_192;
/** A reply may never claim more than this share of the window. */
export const OUTPUT_MAX_SHARE = 0.5;

const OUTPUT_MULTIPLIER: Partial<Record<OpKey, number>> = { format: 4 };

export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  contextWindow: number;
  inputSource: "override" | "discovered" | "learned" | "default";
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
): ResolvedBudget {
  const outputOverride = positive(overrides.output);
  const inputOverride = positive(overrides.input);

  // The multiplier scales the DEFAULT only. An override is already the value the
  // user chose: multiplying a stored format.maxTokens of 32768 by four would turn
  // it into 131072 and silently change what a saved setting means.
  const outputBudgetTokens = Math.max(1, Math.min(
    outputOverride ?? DEFAULT_OUTPUT_BASE * (OUTPUT_MULTIPLIER[operation] ?? 1),
    Math.floor(record.contextWindow * OUTPUT_MAX_SHARE),
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
