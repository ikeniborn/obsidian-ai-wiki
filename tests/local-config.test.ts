import { describe, it, expect, vi } from "vitest";
import { LocalConfigStore } from "../src/local-config";

function makePlugin(adapterImpl: Record<string, any>, manifestDir = ".obsidian/plugins/ai-wiki") {
  return {
    manifest: { dir: manifestDir, id: "ai-wiki" },
    app: { vault: { adapter: adapterImpl } },
  } as any;
}

describe("LocalConfigStore", () => {
  it("returns defaults when local.json missing", async () => {
    const adapter = { exists: vi.fn().mockResolvedValue(false), read: vi.fn(), write: vi.fn() };
    const store = new LocalConfigStore(makePlugin(adapter));
    const cfg = await store.load();
    expect(cfg).toEqual({ iclaudePath: "" });
  });

  it("merges defaults with stored values", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(JSON.stringify({ iclaudePath: "/usr/bin/iclaude.sh" })),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    expect(await store.load()).toEqual({ iclaudePath: "/usr/bin/iclaude.sh" });
  });

  it("returns defaults on corrupt JSON", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue("not json"),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    expect(await store.load()).toEqual({ iclaudePath: "" });
  });

  it("save writes JSON to plugin-dir/local.json and updates cache", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
    };
    const store = new LocalConfigStore(makePlugin(adapter, ".obsidian/plugins/ai-wiki"));
    await store.save({ iclaudePath: "/new/path" });
    expect(adapter.write).toHaveBeenCalledWith(
      ".obsidian/plugins/ai-wiki/local.json",
      JSON.stringify({ iclaudePath: "/new/path" }, null, 2),
    );
    expect((await store.load()).iclaudePath).toBe("/new/path");
  });

  it("save merges with existing values", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue(JSON.stringify({ iclaudePath: "/old" })),
      write: vi.fn(),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    await store.save({ iclaudePath: "/new" });
    expect((await store.load()).iclaudePath).toBe("/new");
  });
});

describe("LocalConfig.claudeAgent effort field", () => {
  it("LocalConfig.claudeAgent accepts effort field", () => {
    const lc: typeof import("../src/local-config").LocalConfig = {
      iclaudePath: "/usr/bin/claude",
      claudeAgent: { model: "sonnet", allowedTools: "", effort: "high" },
    };
    expect(lc.claudeAgent?.effort).toBe("high");
  });

  it("LocalConfig.claudeAgent effort is optional", () => {
    const lc: typeof import("../src/local-config").LocalConfig = {
      iclaudePath: "/usr/bin/claude",
      claudeAgent: { model: "sonnet", allowedTools: "" },
    };
    expect(lc.claudeAgent?.effort).toBeUndefined();
  });
});
