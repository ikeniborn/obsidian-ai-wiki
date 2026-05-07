import { describe, it, expect, vi } from "vitest";
import { migrateLegacyData } from "../src/main";
import type { DomainEntry } from "../src/domain";

function makePlugin(initial: any, adapter: Record<string, any>) {
  let stored = JSON.parse(JSON.stringify(initial));
  return {
    manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
    app: { vault: { adapter } },
    loadData: vi.fn().mockImplementation(async () => stored),
    saveData: vi.fn().mockImplementation(async (d: any) => { stored = d; }),
    getStored: () => stored,
  } as any;
}

const sampleDomain: DomainEntry = {
  id: "os", name: "OS", wiki_folder: "os",
  source_paths: [], entity_types: [], language_notes: "",
};

describe("migrateLegacyData", () => {
  it("moves data.domains to vault store when vault file absent", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn().mockImplementation(async (a: string, b: string) => {
        vaultFiles.set(b, vaultFiles.get(a)!); vaultFiles.delete(a);
      }),
      remove: vi.fn().mockImplementation(async (p: string) => { vaultFiles.delete(p); }),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), new LocalConfigStore(plugin));
    expect(vaultFiles.has("!Wiki/_domain.json")).toBe(true);
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual([sampleDomain]);
    expect(plugin.getStored().domains).toBeUndefined();
  });

  it("does not overwrite existing vault file", async () => {
    const existing = [{ id: "existing", name: "E", wiki_folder: "e" }];
    const vaultFiles = new Map<string, string>([
      ["!Wiki/_domain.json", JSON.stringify(existing)],
    ]);
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p) || p === "!Wiki"),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn(),
      remove: vi.fn(),
      mkdir: vi.fn(),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), new LocalConfigStore(plugin));
    expect(JSON.parse(vaultFiles.get("!Wiki/_domain.json")!)).toEqual(existing);
    expect(plugin.getStored().domains).toBeUndefined();
  });

  it("moves iclaudePath from claudeAgent to local config", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = makePlugin({ claudeAgent: { iclaudePath: "/usr/local/bin/iclaude.sh", model: "sonnet" } }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const localStore = new LocalConfigStore(plugin);
    await migrateLegacyData(plugin, new DomainStore({ adapter } as any), localStore);
    expect(plugin.getStored().claudeAgent.iclaudePath).toBeUndefined();
    expect((await localStore.load()).iclaudePath).toBe("/usr/local/bin/iclaude.sh");
  });

  it("idempotent: second run is no-op", async () => {
    const vaultFiles = new Map<string, string>();
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p)),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn().mockImplementation(async (a: string, b: string) => {
        vaultFiles.set(b, vaultFiles.get(a)!); vaultFiles.delete(a);
      }),
      remove: vi.fn().mockImplementation(async (p: string) => { vaultFiles.delete(p); }),
      mkdir: vi.fn(),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const dms = new DomainStore({ adapter } as any);
    const lcs = new LocalConfigStore(plugin);
    await migrateLegacyData(plugin, dms, lcs);
    const saveCallsAfter1 = plugin.saveData.mock.calls.length;
    await migrateLegacyData(plugin, dms, lcs);
    expect(plugin.saveData.mock.calls.length).toBe(saveCallsAfter1);
  });

  it("handles null/empty data without errors", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(), write: vi.fn(),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = {
      manifest: { dir: ".obsidian/plugins/llm-wiki", id: "llm-wiki" },
      app: { vault: { adapter } },
      loadData: vi.fn().mockResolvedValue(null),
      saveData: vi.fn(),
    } as any;
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await expect(migrateLegacyData(
      plugin,
      new DomainStore({ adapter } as any),
      new LocalConfigStore(plugin),
    )).resolves.toBeUndefined();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});
