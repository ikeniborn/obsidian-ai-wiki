import assert from "node:assert/strict";
import test from "node:test";
import type { ModelContextRecord } from "../src/model-context";
import {
  DEFAULT_OUTPUT_BASE,
  VISION_OUTPUT_MAX_SHARE,
  VISION_PROMPT_TOKENS,
  outputCeiling,
  resolveBudget,
  visionWindowFitsOneImage,
} from "../src/budget-resolver";
import { MEDIA_TOKENS } from "../src/token-estimate";

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

test("a vision window that the settings field accepts fits one image", () => {
  // 8192 is the smallest window the field admits above its own 1024 floor, and the
  // one the fallback record uses, so it is the case that must work.
  const budget = resolveBudget(record({ contextWindow: 8_192 }), "format", {}, {
    outputMaxShare: VISION_OUTPUT_MAX_SHARE,
  });
  assert.ok(
    budget.inputBudgetTokens >= MEDIA_TOKENS + VISION_PROMPT_TOKENS,
    `input ${budget.inputBudgetTokens} must clear one image at ${MEDIA_TOKENS} plus its prompt`,
  );
});

test("the vision output share never exceeds format's, at any window", () => {
  for (const contextWindow of [8_192, 16_384, 65_536, 131_072]) {
    const vision = resolveBudget(record({ contextWindow }), "format", {}, {
      outputMaxShare: VISION_OUTPUT_MAX_SHARE,
    });
    const format = resolveBudget(record({ contextWindow }), "format", {});
    assert.ok(
      vision.outputBudgetTokens <= format.outputBudgetTokens,
      `at ${contextWindow} vision claimed ${vision.outputBudgetTokens} against format's ${format.outputBudgetTokens}`,
    );
    assert.ok(vision.inputBudgetTokens >= format.inputBudgetTokens);
  }
});

test("the one-image fit check separates windows that work from windows that do not", () => {
  const cost = MEDIA_TOKENS + VISION_PROMPT_TOKENS;
  assert.equal(visionWindowFitsOneImage(8_192, cost), true, "8192 must work after the share change");
  assert.equal(visionWindowFitsOneImage(65_536, cost), true);
  // 1024 is the field's own floor, and nothing near it can carry a 4096-token image.
  assert.equal(visionWindowFitsOneImage(1_024, cost), false);
  assert.equal(visionWindowFitsOneImage(4_096, cost), false);
  // The check agrees with the budget it describes, at every window either way.
  for (const contextWindow of [1_024, 4_096, 7_168, 8_192, 16_384, 65_536]) {
    const budget = resolveBudget(record({ contextWindow }), "format", {}, {
      outputMaxShare: VISION_OUTPUT_MAX_SHARE,
    });
    assert.equal(
      visionWindowFitsOneImage(contextWindow, cost),
      budget.inputBudgetTokens >= cost,
      `the check disagrees with the resolved budget at ${contextWindow}`,
    );
  }
});

test("an explicit output cap still binds under the vision share", () => {
  // A cap the user set to bound cost is not raised by the narrower share, and the
  // share does not clamp it below what the user asked for at a large window.
  const budget = resolveBudget(record({ contextWindow: 65_536 }), "format", { output: 2_000 }, {
    outputMaxShare: VISION_OUTPUT_MAX_SHARE,
  });
  assert.equal(budget.outputBudgetTokens, 2_000);
  assert.equal(budget.outputSource, "override");
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
  assert.equal(budget.outputSource, "default", "an input override must not relabel the output");
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
