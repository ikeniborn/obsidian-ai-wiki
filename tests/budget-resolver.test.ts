import assert from "node:assert/strict";
import test from "node:test";
import type { ModelContextRecord } from "../src/model-context";
import { DEFAULT_OUTPUT_BASE, outputCeiling, resolveBudget } from "../src/budget-resolver";

const record = (over: Partial<ModelContextRecord> = {}): ModelContextRecord => ({
  contextWindow: 131_072,
  source: "discovered",
  calibration: 1,
  samples: 0,
  ...over,
});

test("init on a 128k model matches the worked example", () => {
  const budget = resolveBudget(record(), "init", {});
  assert.equal(budget.outputBudgetTokens, 8_192);
  assert.equal(budget.inputBudgetTokens, 110_592);
});

test("format keeps four times the base output allowance", () => {
  const budget = resolveBudget(record(), "format", {});
  assert.equal(budget.outputBudgetTokens, DEFAULT_OUTPUT_BASE * 4);
  assert.equal(budget.inputBudgetTokens, 88_473);
});

test("an output override is taken as given, never multiplied", () => {
  // src/types.ts:856 stores format.maxTokens = 32768. It must survive as 32768.
  const budget = resolveBudget(record(), "format", { output: 32_768 });
  assert.equal(budget.outputBudgetTokens, 32_768);
});

test("the fallback window still leaves a usable input budget", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192, source: "default" }), "init", {});
  assert.equal(budget.outputBudgetTokens, 4_096);
  assert.equal(budget.inputBudgetTokens, 3_686);
  assert.equal(budget.inputSource, "default");
});

test("input and output sources move independently", () => {
  const budget = resolveBudget(record(), "init", { output: 2_048 });
  assert.equal(budget.outputSource, "override");
  assert.equal(budget.inputSource, "discovered", "an output override must not relabel the input");
});

test("an override is clamped to what is left after the output reserve", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192 }), "init", { input: 8_192 });
  assert.equal(budget.outputBudgetTokens, 4_096);
  assert.equal(budget.inputBudgetTokens, 3_686);
  assert.ok(
    budget.inputBudgetTokens + budget.outputBudgetTokens <= 8_192,
    "input plus output must never exceed the context window",
  );
});

test("an output-only override still leaves the input derived and bounded", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192 }), "init", { output: 3_000 });
  assert.equal(budget.outputBudgetTokens, 3_000);
  assert.equal(budget.inputBudgetTokens, Math.floor((8_192 - 3_000) * 0.9));
  assert.equal(budget.inputSource, "discovered");
  assert.equal(budget.outputSource, "override");
});

test("both overrides together still fit the window", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192 }), "init", { input: 7_000, output: 3_000 });
  assert.ok(budget.inputBudgetTokens + budget.outputBudgetTokens <= 8_192);
  assert.equal(budget.inputSource, "override");
  assert.equal(budget.outputSource, "override");
});

test("the output ceiling exceeds the output budget so a retry can grow", () => {
  const budget = resolveBudget(record(), "init", {});
  assert.ok(
    outputCeiling(131_072, 20_000) > budget.outputBudgetTokens,
    "regression: the ceiling must not equal the budget it is meant to raise",
  );
});
