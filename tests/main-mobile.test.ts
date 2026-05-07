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

describe("onload — command registration gating", () => {
  beforeEach(() => __setPlatformMobile(false));

  function setupPlugin() {
    const plugin = makePlugin({});
    const registered: string[] = [];
    plugin.addCommand = vi.fn((cmd: { id: string }) => { registered.push(cmd.id); });
    plugin.addRibbonIcon = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.registerView = vi.fn();
    plugin.app.workspace = {
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: vi.fn(),
      getActiveFile: () => null,
    };
    plugin.app.vault.configDir = ".obsidian";
    return { plugin, registered };
  }

  it("desktop: registers all commands", async () => {
    __setPlatformMobile(false);
    const { plugin, registered } = setupPlugin();
    await plugin.onload();
    expect(registered).toEqual(
      expect.arrayContaining(["open-panel", "ingest-current", "query", "query-save", "lint", "init", "cancel"]),
    );
  });

  it("mobile: registers only query/query-save/open-panel/cancel", async () => {
    __setPlatformMobile(true);
    const { plugin, registered } = setupPlugin();
    await plugin.onload();
    expect(registered).toEqual(
      expect.arrayContaining(["open-panel", "query", "query-save", "cancel"]),
    );
    expect(registered).not.toContain("ingest-current");
    expect(registered).not.toContain("lint");
    expect(registered).not.toContain("init");
  });
});
