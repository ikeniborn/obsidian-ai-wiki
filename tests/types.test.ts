import { DEFAULT_SETTINGS } from "../src/types";
import type { ClaudeOperationConfig, NativeOperationConfig, LlmCallOptions } from "../src/types";

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
  expect((DEFAULT_SETTINGS.claudeAgent as any).effort).toBeUndefined();
  expect((DEFAULT_SETTINGS.nativeAgent as any).thinkingBudgetTokens).toBeUndefined();
});
