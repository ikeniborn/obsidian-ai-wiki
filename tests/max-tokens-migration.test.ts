import { describe, it, expect, vi } from "vitest";
import LlmWikiPlugin from "../src/main";

function makePlugin(loaded: Record<string, unknown> | null): LlmWikiPlugin {
  const p = Object.create(LlmWikiPlugin.prototype) as LlmWikiPlugin;
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = vi.fn().mockResolvedValue(loaded);
  (p as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = vi.fn().mockResolvedValue(undefined);
  return p;
}

describe("schema v3 migration: maxTokens + numCtx", () => {
  it("migrates top-level maxTokens to nativeAgent.maxTokens", async () => {
    const p = makePlugin({ maxTokens: 8192 });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(8192);
    expect((p.settings as unknown as Record<string, unknown>).maxTokens).toBeUndefined();
  });

  it("migrates legacy claudeAgent.maxTokens to nativeAgent.maxTokens when top-level absent", async () => {
    const p = makePlugin({ claudeAgent: { maxTokens: 12000 } });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(12000);
  });

  it("drops nativeAgent.numCtx from data.json", async () => {
    const p = makePlugin({ nativeAgent: { numCtx: 16384, baseUrl: "x" } });
    await p.loadSettings();
    expect((p.settings.nativeAgent as Record<string, unknown>).numCtx).toBeUndefined();
  });

  it("uses default nativeAgent.maxTokens when no legacy data", async () => {
    const p = makePlugin({});
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(4096);
  });

  it("preserves existing nativeAgent.maxTokens over legacy top-level", async () => {
    const p = makePlugin({ maxTokens: 8192, nativeAgent: { maxTokens: 10000 } });
    await p.loadSettings();
    expect(p.settings.nativeAgent.maxTokens).toBe(10000);
  });
});
