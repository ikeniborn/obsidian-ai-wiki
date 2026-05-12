import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setPlatformMobile, __clearNotices, Notice } from "obsidian";
import { WikiController } from "../src/controller";

function makeApp() {
  return {
    vault: {
      adapter: {
        getBasePath: () => "/tmp/vault",
        getFullPath: (p: string) => `/tmp/vault/${p}`,
        exists: vi.fn().mockResolvedValue(false),
      },
      configDir: ".obsidian",
      getName: () => "vault",
    },
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: vi.fn(),
      getActiveFile: () => ({ path: "note.md" }),
    },
  } as any;
}

function makePlugin(settings: any) {
  return {
    settings,
    saveSettings: vi.fn(),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app: makeApp(),
  } as any;
}

function makeLocalConfigStore() {
  return { load: vi.fn().mockResolvedValue({ iclaudePath: "" }) } as any;
}

describe("controller — mobile guards", () => {
  beforeEach(() => {
    __setPlatformMobile(false);
    __clearNotices();
  });

  it("mobile: rejects ingest dispatch with Notice", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "key" },
    });
    const ctrl = new WikiController(plugin.app, plugin, {} as any, makeLocalConfigStore());
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.ingestActive();
    expect(buildSpy).not.toHaveBeenCalled();
    expect(Notice.__messages).toContain("Operation not available on mobile");
  });

  it("mobile: query proceeds past mobile guard (does NOT contain mobile-reject Notice)", async () => {
    __setPlatformMobile(true);
    const plugin = makePlugin({
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "key" },
    });
    const ctrl = new WikiController(plugin.app, plugin, {} as any, makeLocalConfigStore());
    await ctrl.query("test", false);
    expect(Notice.__messages).not.toContain("Operation not available on mobile");
  });

  it("rejects native-agent query when baseUrl empty (desktop or mobile)", async () => {
    __setPlatformMobile(false);
    const plugin = makePlugin({
      backend: "native-agent",
      nativeAgent: { baseUrl: "", apiKey: "key" },
    });
    const ctrl = new WikiController(plugin.app, plugin, {} as any, makeLocalConfigStore());
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.query("test", false);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(Notice.__messages.some((m) => m.includes("Configure cloud LLM"))).toBe(true);
  });

  it("rejects native-agent query when apiKey empty", async () => {
    __setPlatformMobile(false);
    const plugin = makePlugin({
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "" },
    });
    const ctrl = new WikiController(plugin.app, plugin, {} as any, makeLocalConfigStore());
    const buildSpy = vi.spyOn(ctrl as any, "buildAgentRunner");
    await ctrl.query("test", false);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(Notice.__messages.some((m) => m.includes("Configure cloud LLM"))).toBe(true);
  });
});
