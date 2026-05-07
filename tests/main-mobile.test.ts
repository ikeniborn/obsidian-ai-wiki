import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setPlatformMobile } from "obsidian";
import LlmWikiPlugin from "../src/main";

function makePlugin(stored: any) {
  const adapter = {
    exists: vi.fn().mockResolvedValue(false),
    read: vi.fn(), write: vi.fn(), mkdir: vi.fn(),
    rename: vi.fn(), remove: vi.fn(),
  };
  const plugin: any = Object.create(LlmWikiPlugin.prototype);
  plugin.app = { vault: { adapter } };
  plugin.manifest = { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" };
  plugin.loadData = vi.fn().mockResolvedValue(stored);
  plugin.saveData = vi.fn().mockImplementation(async (d: any) => { stored = d; });
  return plugin;
}

describe("loadSettings — mobile backend migration", () => {
  beforeEach(() => __setPlatformMobile(false));

  it("forces backend to native-agent on mobile when stored backend is claude-agent", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "claude-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("native-agent");
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("leaves backend untouched on desktop", async () => {
    __setPlatformMobile(false);
    const plugin = makePlugin({ backend: "claude-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("claude-agent");
  });

  it("leaves native-agent backend untouched on mobile", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({ backend: "native-agent" });
    await plugin.loadSettings();
    expect(plugin.settings.backend).toBe("native-agent");
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});
