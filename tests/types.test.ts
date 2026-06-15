import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";
import type { ClaudeOperationConfig, NativeOperationConfig, LlmCallOptions, RunEvent } from "../src/types";

it("ClaudeOperationConfig accepts effort field", () => {
  const c: ClaudeOperationConfig = { model: "sonnet", effort: "high" };
  expect(c.effort).toBe("high");
});

it("ClaudeOperationConfig effort is optional", () => {
  const c: ClaudeOperationConfig = { model: "sonnet" };
  expect(c.effort).toBeUndefined();
});

it("NativeOperationConfig accepts thinkingBudgetTokens", () => {
  const c: NativeOperationConfig = { model: "llama3.2", maxTokens: 4096, temperature: 0.2, thinkingBudgetTokens: 8000 };
  expect(c.thinkingBudgetTokens).toBe(8000);
});

it("LlmCallOptions accepts thinkingBudgetTokens", () => {
  const o: LlmCallOptions = { thinkingBudgetTokens: 8000 };
  expect(o.thinkingBudgetTokens).toBe(8000);
});

it("DEFAULT_SETTINGS has no effort or thinkingBudgetTokens", () => {
  expect(DEFAULT_SETTINGS.claudeAgent.effort).toBeUndefined();
  expect(DEFAULT_SETTINGS.nativeAgent.thinkingBudgetTokens).toBeUndefined();
});

it("RunEvent accepts info_text with icon, summary, details", () => {
  const ev: RunEvent = {
    kind: "info_text",
    icon: "🔍",
    summary: "5/42 wiki-pages loaded (jaccard)",
    details: ["Alice", "Memory", "ProjectX"],
  };
  expect(ev.kind).toBe("info_text");
});

it("RunEvent info_text details is optional", () => {
  const ev: RunEvent = { kind: "info_text", icon: "📋", summary: "no pages" };
  expect(ev.kind).toBe("info_text");
});

describe("Tier 2 nativeAgent defaults", () => {
  it("defaults bfsFusion to false (opt-in)", () => {
    expect(DEFAULT_SETTINGS.nativeAgent.bfsFusion).toBe(false);
  });
  it("defaults seedSimilarityThreshold to 0 (gate off)", () => {
    expect(DEFAULT_SETTINGS.nativeAgent.seedSimilarityThreshold).toBe(0);
  });
});
