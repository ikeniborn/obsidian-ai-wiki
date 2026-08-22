import type { LlmWikiPluginSettings, OpKey } from "./types";

// Kept free of any "obsidian" import: these two functions are pure state edits and are
// unit-tested directly. The one-shot upgrade modal that calls them (`AutoBudgetNoticeModal`)
// lives in `modals.ts` alongside every other `Modal` subclass in this codebase.

const NATIVE_BUDGET_OPERATIONS: readonly OpKey[] = ["ingest", "query", "lint", "init", "format"];

/**
 * True when OpenAI settings carry a stored budget override — one of the top-level
 * `nativeAgent` fields that Task 12's automatic-budget derivation treats as an explicit
 * override when present, and as "derive from the model's context window" when absent.
 * A fresh install (nothing ever saved) returns false, so it has nothing to migrate.
 */
export function hasStoredNativeBudget(settings: LlmWikiPluginSettings): boolean {
  const native = settings.nativeAgent;
  return native.inputBudgetTokens !== undefined
    || native.maxTokens !== undefined
    || native.repairInputBudgetTokens !== undefined;
}

/**
 * Clears every native-agent budget override — the global fields and every operation's
 * per-operation override — so automatic derivation takes over everywhere, including if
 * per-operation controls are switched on later. Only ever called after an explicit
 * "switch to automatic" answer.
 */
export function clearNativeBudgets(settings: LlmWikiPluginSettings): void {
  const native = settings.nativeAgent;
  delete native.inputBudgetTokens;
  delete native.maxTokens;
  delete native.repairInputBudgetTokens;
  for (const key of NATIVE_BUDGET_OPERATIONS) {
    const op = native.operations[key];
    delete op.inputBudgetTokens;
    delete op.maxTokens;
  }
}

/**
 * A resolver that can be invoked multiple times — e.g. once per modal exit path: a
 * button click, Escape, the built-in close control, or clicking outside — but settles
 * its promise only once. The first call wins; every later call is a silent no-op, so
 * the returned promise never settles twice. Used by `AutoBudgetNoticeModal` (in
 * `modals.ts`) to bridge Obsidian's callback-style `Modal` into a single awaited answer;
 * kept here, not there, so it is unit-testable without importing "obsidian".
 */
export function settleOnce<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    let settled = false;
    settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });
  return { promise, settle };
}
