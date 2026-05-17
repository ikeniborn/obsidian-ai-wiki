import { describe, it, expect } from "vitest";
import { buildChatParams } from "../../src/phases/llm-utils";

describe("buildChatParams", () => {
  it("buildChatParams adds thinking when thinkingBudgetTokens > 0", () => {
    const params = buildChatParams("claude-sonnet", [], { thinkingBudgetTokens: 8000 });
    expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
  });

  it("buildChatParams does not add thinking when thinkingBudgetTokens is 0", () => {
    const params = buildChatParams("claude-sonnet", [], { thinkingBudgetTokens: 0 });
    expect(params.thinking).toBeUndefined();
  });

  it("buildChatParams does not add thinking when thinkingBudgetTokens is undefined", () => {
    const params = buildChatParams("claude-sonnet", [], {});
    expect(params.thinking).toBeUndefined();
  });
});
