import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import type { ModelContextRecord } from "../src/model-context";
import {
  normalizeModelCallPolicySettings,
  resolveCallPolicy,
} from "../src/model-call-policy";

function settings(): LlmWikiPluginSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

function rec(over: Partial<ModelContextRecord> = {}): ModelContextRecord {
  return { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0, ...over };
}

test("OpenAI global policy keeps maxTokens as output and adds input budget", () => {
  const s = settings();
  s.nativeAgent.inputBudgetTokens = 20_000;
  s.nativeAgent.maxTokens = 3210;
  const resolved = resolveCallPolicy(s, "query", rec());
  assert.equal(resolved.policy.inputBudgetTokens, 20_000);
  assert.equal(resolved.policy.outputBudgetTokens, 3210);
  assert.equal(resolved.opts.maxTokens, 3210);
  assert.equal(resolved.policy.compression, "balanced");
});

test("invalid and sub-token OpenAI budgets derive from the window without producing zero", () => {
  for (const value of [0.5, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const s = settings();
    s.nativeAgent.inputBudgetTokens = value;
    s.nativeAgent.maxTokens = value;
    const resolved = resolveCallPolicy(s, "query", rec());
    // An unusable stored value is not an override, so the budget comes from the
    // 131_072 window: 8_192 out, floor((131_072 - 8_192) * 0.9) in.
    assert.equal(resolved.policy.inputBudgetTokens, 110_592);
    assert.equal(resolved.policy.outputBudgetTokens, 8_192);
    assert.equal(resolved.opts.inputBudgetTokens, 110_592);
    assert.equal(resolved.opts.maxTokens, 8_192);
  }
});

test("OpenAI per-operation values and global compression fallback resolve", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 9000;
  s.nativeAgent.operations.ingest.maxTokens = 2000;
  s.nativeAgent.operations.ingest.compressionProfile = "maximum";
  const resolved = resolveCallPolicy(s, "ingest", rec());
  // No stored repair budget: the repair prompt inherits the input budget it repairs.
  assert.deepEqual(resolved.policy, {
    inputBudgetTokens: 9000,
    repairInputBudgetTokens: 9000,
    outputBudgetTokens: 2000,
    compression: "maximum",
  });
});

test("legacy numeric thinking settings never enter the OpenAI runtime policy", () => {
  const s = settings();
  s.nativeAgent.thinkingBudgetTokens = 4096;
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.query.thinkingBudgetTokens = 8192;

  const resolved = resolveCallPolicy(s, "query", rec());

  assert.equal("thinkingBudgetTokens" in resolved.opts, false);
});

test("OpenAI repair input ceiling applies only to ingest and init policies", () => {
  const s = settings();
  s.nativeAgent.repairInputBudgetTokens = 65_536;
  s.nativeAgent.inputBudgetTokens = 32_768;

  const ingest = resolveCallPolicy(s, "ingest", rec());
  const init = resolveCallPolicy(s, "init", rec());
  const query = resolveCallPolicy(s, "query", rec());

  // The stored 65_536 is clamped to the input budget it repairs.
  assert.equal(ingest.policy.repairInputBudgetTokens, 32_768);
  assert.equal(ingest.opts.repairInputBudgetTokens, 32_768);
  assert.equal(init.policy.repairInputBudgetTokens, 32_768);
  assert.equal(query.policy.repairInputBudgetTokens, undefined);
  assert.equal(query.opts.repairInputBudgetTokens, undefined);
});

test("invalid global compression profiles fall back to balanced", () => {
  const s = settings();
  (s.nativeAgent as { compressionProfile: unknown }).compressionProfile = "bogus";
  const resolved = resolveCallPolicy(s, "query", rec());
  assert.equal(resolved.policy.compression, "balanced");
  assert.deepEqual(resolved.opts.semanticCompression, {
    profile: "balanced",
    operation: "query",
  });
});

test("invalid per-operation compression profiles use the valid global profile", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.compressionProfile = "minimum";
  (s.nativeAgent.operations.query as { compressionProfile?: unknown }).compressionProfile = "bogus";
  const resolved = resolveCallPolicy(s, "query", rec());
  assert.equal(resolved.policy.compression, "minimum");
  assert.deepEqual(resolved.opts.semanticCompression, {
    profile: "minimum",
    operation: "query",
  });
});

test("format resolves no compression policy and no semantic compression options", () => {
  const s = settings();
  s.nativeAgent.compressionProfile = "maximum";
  const resolved = resolveCallPolicy(s, "format", rec());
  assert.equal(resolved.policy.compression, undefined);
  assert.equal(resolved.opts.semanticCompression, undefined);
});

test("loaded policy fields normalize without changing persisted output budgets", () => {
  const s = settings();
  s.nativeAgent.maxTokens = 3210;
  s.nativeAgent.operations.query.maxTokens = 2222;

  const invalidInputs = [0.5, 0, Number.NaN, Number.POSITIVE_INFINITY, undefined];
  const keys = ["ingest", "query", "lint", "init", "format"] as const;
  for (const [index, key] of keys.entries()) {
    (s.nativeAgent.operations[key] as { inputBudgetTokens?: unknown }).inputBudgetTokens =
      invalidInputs[index];
  }

  delete (s.nativeAgent as { inputBudgetTokens?: unknown }).inputBudgetTokens;
  (s.nativeAgent as { repairInputBudgetTokens?: unknown }).repairInputBudgetTokens = 0;
  (s.nativeAgent as { compressionProfile: unknown }).compressionProfile = "bogus";
  s.nativeAgent.operations.ingest.compressionProfile = "maximum";
  (s.nativeAgent.operations.query as { compressionProfile?: unknown }).compressionProfile = "bogus";

  normalizeModelCallPolicySettings(s);

  // OpenAI input budgets are optional: an absent or invalid stored value stays
  // absent (yielding a context-derived budget later) instead of being replaced by a
  // fixed constant.
  assert.equal(s.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(s.nativeAgent.repairInputBudgetTokens, undefined);
  for (const key of keys) {
    assert.equal(s.nativeAgent.operations[key].inputBudgetTokens, undefined);
  }
  assert.equal(s.nativeAgent.compressionProfile, "balanced");
  assert.equal(s.nativeAgent.operations.ingest.compressionProfile, "maximum");
  assert.equal(s.nativeAgent.operations.query.compressionProfile, undefined);
  assert.equal(s.nativeAgent.maxTokens, 3210);
  assert.equal(s.nativeAgent.operations.query.maxTokens, 2222);
});

test("delete borrows ingest and a query follow-up borrows query", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 7000;
  s.nativeAgent.operations.query.inputBudgetTokens = 8000;
  assert.equal(resolveCallPolicy(s, "delete", rec()).policy.inputBudgetTokens, 7000);
  assert.equal(resolveCallPolicy(s, "chat", rec(), "query").policy.inputBudgetTokens, 8000);
});

test("an absent native budget yields a context-derived budget, not 16384", () => {
  const s = settings();
  const { policy } = resolveCallPolicy(s, "init", rec());
  assert.equal(policy.inputBudgetTokens, 110_592);
});

test("a stored native budget still acts as an explicit override", () => {
  const s = settings();
  s.nativeAgent.inputBudgetTokens = 24_000;
  const { policy } = resolveCallPolicy(s, "init", rec());
  assert.equal(policy.inputBudgetTokens, 24_000);
});

test("the calibration factor reaches the call options", () => {
  const s = settings();
  const { opts } = resolveCallPolicy(s, "init", rec({ calibration: 1.25 }));
  assert.equal(opts.tokenCalibration, 1.25);
});

test("a stored repair budget larger than the window clamps to the derived input budget, not 65536", () => {
  const s = settings();
  s.nativeAgent.repairInputBudgetTokens = 65_536;
  const { policy, opts } = resolveCallPolicy(s, "init", rec({ contextWindow: 8_192 }));
  assert.equal(policy.inputBudgetTokens, 3_686);
  assert.equal(policy.repairInputBudgetTokens, 3_686);
  assert.equal(opts.repairInputBudgetTokens, 3_686);
});

test("budgetTelemetry carries the resolved OpenAI budget's provenance", () => {
  const s = settings();
  const { opts, budget } = resolveCallPolicy(s, "init", rec({ calibration: 1.25 }));
  assert.deepEqual(opts.budgetTelemetry, {
    contextWindow: budget!.contextWindow,
    inputSource: budget!.inputSource,
    outputSource: budget!.outputSource,
    calibration: budget!.calibration,
  });
});
