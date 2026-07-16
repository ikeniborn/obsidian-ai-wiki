import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import { resolveModelCallPolicy } from "../src/model-call-policy";

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
