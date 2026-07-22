import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import {
  normalizeModelCallPolicySettings,
  resolveModelCallPolicy,
} from "../src/model-call-policy";

function settings(): LlmWikiPluginSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

test("native global policy keeps maxTokens as output and adds input budget", () => {
  const s = settings();
  s.nativeAgent.inputBudgetTokens = 20_000;
  s.nativeAgent.maxTokens = 3210;
  const resolved = resolveModelCallPolicy(s, "query");
  assert.equal(resolved.policy.inputBudgetTokens, 20_000);
  assert.equal(resolved.policy.outputBudgetTokens, 3210);
  assert.equal(resolved.opts.maxTokens, 3210);
  assert.equal(resolved.policy.compression, "balanced");
});

test("invalid and sub-token native budgets fall back without producing zero", () => {
  for (const value of [0.5, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const s = settings();
    s.nativeAgent.inputBudgetTokens = value;
    s.nativeAgent.maxTokens = value;
    const resolved = resolveModelCallPolicy(s, "query");
    assert.equal(resolved.policy.inputBudgetTokens, 16_384);
    assert.equal(resolved.policy.outputBudgetTokens, 4096);
    assert.equal(resolved.opts.inputBudgetTokens, 16_384);
    assert.equal(resolved.opts.maxTokens, 4096);
  }
});

test("native per-operation values and global compression fallback resolve", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 9000;
  s.nativeAgent.operations.ingest.maxTokens = 2000;
  s.nativeAgent.operations.ingest.compressionProfile = "maximum";
  const resolved = resolveModelCallPolicy(s, "ingest");
  assert.deepEqual(resolved.policy, {
    inputBudgetTokens: 9000,
    outputBudgetTokens: 2000,
    compression: "maximum",
  });
});

test("invalid global compression profiles fall back to balanced", () => {
  for (const backend of ["native-agent", "claude-agent"] as const) {
    const s = settings();
    s.backend = backend;
    const global = backend === "native-agent" ? s.nativeAgent : s.claudeAgent;
    (global as { compressionProfile: unknown }).compressionProfile = "bogus";
    const resolved = resolveModelCallPolicy(s, "query");
    assert.equal(resolved.policy.compression, "balanced");
    assert.deepEqual(resolved.opts.semanticCompression, {
      profile: "balanced",
      operation: "query",
    });
  }
});

test("invalid per-operation compression profiles use the valid global profile", () => {
  for (const backend of ["native-agent", "claude-agent"] as const) {
    const s = settings();
    s.backend = backend;
    const global = backend === "native-agent" ? s.nativeAgent : s.claudeAgent;
    global.perOperation = true;
    global.compressionProfile = "minimum";
    (global.operations.query as { compressionProfile?: unknown }).compressionProfile = "bogus";
    const resolved = resolveModelCallPolicy(s, "query");
    assert.equal(resolved.policy.compression, "minimum");
    assert.deepEqual(resolved.opts.semanticCompression, {
      profile: "minimum",
      operation: "query",
    });
  }
});

test("format resolves no compression policy and no semantic compression options", () => {
  for (const backend of ["native-agent", "claude-agent"] as const) {
    const s = settings();
    s.backend = backend;
    const global = backend === "native-agent" ? s.nativeAgent : s.claudeAgent;
    global.compressionProfile = "maximum";
    const resolved = resolveModelCallPolicy(s, "format");
    assert.equal(resolved.policy.compression, undefined);
    assert.equal(resolved.opts.semanticCompression, undefined);
  }
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
    (s.claudeAgent.operations[key] as { inputBudgetTokens?: unknown }).inputBudgetTokens =
      invalidInputs[index];
  }

  delete (s.nativeAgent as { inputBudgetTokens?: unknown }).inputBudgetTokens;
  (s.claudeAgent as { inputBudgetTokens: unknown }).inputBudgetTokens = 0.5;
  (s.nativeAgent as { compressionProfile: unknown }).compressionProfile = "bogus";
  (s.claudeAgent as { compressionProfile: unknown }).compressionProfile = "bogus";
  s.nativeAgent.operations.ingest.compressionProfile = "maximum";
  (s.nativeAgent.operations.query as { compressionProfile?: unknown }).compressionProfile = "bogus";
  (s.claudeAgent.operations.lint as { compressionProfile?: unknown }).compressionProfile = "bogus";

  normalizeModelCallPolicySettings(s);

  assert.equal(s.nativeAgent.inputBudgetTokens, 16_384);
  assert.equal(s.claudeAgent.inputBudgetTokens, 16_384);
  for (const key of keys) {
    assert.equal(s.nativeAgent.operations[key].inputBudgetTokens, 16_384);
    assert.equal(s.claudeAgent.operations[key].inputBudgetTokens, 16_384);
  }
  assert.equal(s.nativeAgent.compressionProfile, "balanced");
  assert.equal(s.claudeAgent.compressionProfile, "balanced");
  assert.equal(s.nativeAgent.operations.ingest.compressionProfile, "maximum");
  assert.equal(s.nativeAgent.operations.query.compressionProfile, undefined);
  assert.equal(s.claudeAgent.operations.lint.compressionProfile, undefined);
  assert.equal(s.nativeAgent.maxTokens, 3210);
  assert.equal(s.nativeAgent.operations.query.maxTokens, 2222);
});

test("claude resolves no plugin-owned output cap", () => {
  const s = settings();
  s.backend = "claude-agent";
  s.claudeAgent.inputBudgetTokens = 12_000;
  const resolved = resolveModelCallPolicy(s, "lint");
  assert.equal(resolved.policy.inputBudgetTokens, 12_000);
  assert.equal(resolved.policy.outputBudgetTokens, undefined);
  assert.equal(resolved.opts.maxTokens, undefined);
});

test("delete borrows ingest and a query follow-up borrows query", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 7000;
  s.nativeAgent.operations.query.inputBudgetTokens = 8000;
  assert.equal(resolveModelCallPolicy(s, "delete").policy.inputBudgetTokens, 7000);
  assert.equal(resolveModelCallPolicy(s, "chat", "query").policy.inputBudgetTokens, 8000);
});
