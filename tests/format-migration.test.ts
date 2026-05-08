import { describe, it, expect, vi } from "vitest";
import LlmWikiPlugin from "../src/main";

function makePlugin(loaded: Record<string, unknown> | null): LlmWikiPlugin {
  const p = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = vi.fn().mockResolvedValue(loaded);
  (p as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = vi.fn().mockResolvedValue(undefined);
  return p;
}

describe("settings migration: format defaults", () => {
  it("adds timeouts.format=600 when absent", async () => {
    const p = makePlugin({ timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600 } });
    await p.loadSettings();
    expect(p.settings.timeouts.format).toBe(600);
  });

  it("adds operations.format to claudeAgent and nativeAgent", async () => {
    const p = makePlugin({
      claudeAgent: {
        operations: {
          ingest: { model: "x", maxTokens: 1 },
          query: { model: "x", maxTokens: 1 },
          lint: { model: "x", maxTokens: 1 },
          init: { model: "x", maxTokens: 1 },
        },
      },
      nativeAgent: {
        operations: {
          ingest: { model: "y", maxTokens: 1, temperature: 0 },
          query: { model: "y", maxTokens: 1, temperature: 0 },
          lint: { model: "y", maxTokens: 1, temperature: 0 },
          init: { model: "y", maxTokens: 1, temperature: 0 },
        },
      },
    });
    await p.loadSettings();
    expect(p.settings.claudeAgent.operations.format).toBeDefined();
    expect(p.settings.nativeAgent.operations.format).toBeDefined();
  });

  it("preserves user-set operations.format model and strips legacy maxTokens", async () => {
    const p = makePlugin({
      claudeAgent: { operations: { format: { model: "custom-claude", maxTokens: 9999 } } },
    });
    await p.loadSettings();
    expect(p.settings.claudeAgent.operations.format.model).toBe("custom-claude");
    expect((p.settings.claudeAgent.operations.format as Record<string, unknown>).maxTokens).toBeUndefined();
  });
});
