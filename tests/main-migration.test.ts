import { describe, it, expect, vi } from "vitest";
import { migrateLegacyData, migrateToLocalV1 } from "../src/main";
import type { DomainEntry } from "../src/domain";

function makePlugin(initial: any, adapter: Record<string, any>) {
  let stored = JSON.parse(JSON.stringify(initial));
  return {
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app: { vault: { adapter, createFolder: vi.fn().mockResolvedValue(undefined) } },
    loadData: vi.fn().mockImplementation(async () => stored),
    saveData: vi.fn().mockImplementation(async (d: any) => { stored = d; }),
    getStored: () => stored,
  } as any;
}

function makeVaultObj(adapter: Record<string, any>): any {
  return { adapter, createFolder: vi.fn().mockResolvedValue(undefined) };
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
    await migrateLegacyData(plugin, new DomainStore(makeVaultObj(adapter)), new LocalConfigStore(plugin));
    expect(vaultFiles.has("!Wiki/_config/_domain.json")).toBe(true);
    expect(JSON.parse(vaultFiles.get("!Wiki/_config/_domain.json")!)).toEqual([sampleDomain]);
    expect(plugin.getStored().domains).toBeUndefined();
  });

  it("does not overwrite existing vault file", async () => {
    const existing = [{ id: "existing", name: "E", wiki_folder: "e" }];
    const vaultFiles = new Map<string, string>([
      ["!Wiki/_config/_domain.json", JSON.stringify(existing)],
    ]);
    const adapter = {
      exists: vi.fn().mockImplementation(async (p: string) => vaultFiles.has(p) || p === "!Wiki" || p === "!Wiki/_config"),
      read: vi.fn().mockImplementation(async (p: string) => vaultFiles.get(p)!),
      write: vi.fn().mockImplementation(async (p: string, c: string) => { vaultFiles.set(p, c); }),
      rename: vi.fn(),
      remove: vi.fn(),
      mkdir: vi.fn(),
    };
    const plugin = makePlugin({ domains: [sampleDomain] }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await migrateLegacyData(plugin, new DomainStore(makeVaultObj(adapter)), new LocalConfigStore(plugin));
    expect(JSON.parse(vaultFiles.get("!Wiki/_config/_domain.json")!)).toEqual(existing);
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
    await migrateLegacyData(plugin, new DomainStore(makeVaultObj(adapter)), localStore);
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
    const dms = new DomainStore(makeVaultObj(adapter));
    const lcs = new LocalConfigStore(plugin);
    await migrateLegacyData(plugin, dms, lcs);
    const saveCallsAfter1 = plugin.saveData.mock.calls.length;
    await migrateLegacyData(plugin, dms, lcs);
    expect(plugin.saveData.mock.calls.length).toBe(saveCallsAfter1);
  });

  it("migrates shellConsentGiven=true to local.json when not already set", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(), write: vi.fn(),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = makePlugin({ shellConsentGiven: true }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const localStore = new LocalConfigStore(plugin);
    vi.spyOn(localStore, "load").mockResolvedValue({} as any);
    const saveSpy = vi.spyOn(localStore, "save").mockResolvedValue(undefined);
    await migrateLegacyData(plugin, new DomainStore(makeVaultObj(adapter)), localStore);
    expect(saveSpy).toHaveBeenCalledWith({ shellConsentGiven: true });
    expect(plugin.getStored().shellConsentGiven).toBeUndefined();
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("skips save but still deletes shellConsentGiven when already set in local.json", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(), write: vi.fn(),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = makePlugin({ shellConsentGiven: true }, adapter);
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    const localStore = new LocalConfigStore(plugin);
    vi.spyOn(localStore, "load").mockResolvedValue({ shellConsentGiven: true } as any);
    const saveSpy = vi.spyOn(localStore, "save").mockResolvedValue(undefined);
    await migrateLegacyData(plugin, new DomainStore(makeVaultObj(adapter)), localStore);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(plugin.getStored().shellConsentGiven).toBeUndefined();
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("handles null/empty data without errors", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(), write: vi.fn(),
      rename: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
    };
    const plugin = {
      manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
      app: { vault: { adapter } },
      loadData: vi.fn().mockResolvedValue(null),
      saveData: vi.fn(),
    } as any;
    const { DomainStore } = await import("../src/domain-store");
    const { LocalConfigStore } = await import("../src/local-config");
    await expect(migrateLegacyData(
      plugin,
      new DomainStore(makeVaultObj(adapter)),
      new LocalConfigStore(plugin),
    )).resolves.toBeUndefined();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});

describe("migrateToLocalV1", () => {
  it("copies backend+API to local.json and scrubs apiKey", async () => {
    const local: any = { iclaudePath: "" };
    const plugin: any = {
      settings: {
        backend: "native-agent",
        nativeAgent: {
          baseUrl: "https://x/v1", apiKey: "secret", model: "m",
          temperature: 0.2, topP: null,
          perOperation: false, operations: {},
        },
        claudeAgent: { model: "sonnet", allowedTools: "", perOperation: false, operations: {} },
        agentLogEnabled: true,
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const store: any = {
      load: vi.fn().mockImplementation(async () => local),
      save: vi.fn().mockImplementation(async (patch: any) => { Object.assign(local, patch); }),
    };
    await migrateToLocalV1(plugin, store);
    expect(local.migrated_v1).toBe(true);
    expect(local.nativeAgent.apiKey).toBe("secret");
    expect(local.backend).toBe("native-agent");
    expect(plugin.settings.nativeAgent.apiKey).toBe("");
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it("is idempotent (no-op when migrated_v1 already true)", async () => {
    const local: any = { iclaudePath: "", migrated_v1: true, nativeAgent: { apiKey: "old" } };
    const plugin: any = {
      settings: { nativeAgent: { apiKey: "should-not-touch" } },
      saveSettings: vi.fn(async () => { throw new Error("must not call saveSettings"); }),
    };
    const store: any = {
      load: vi.fn().mockImplementation(async () => local),
      save: vi.fn(async () => { throw new Error("must not call save"); }),
    };
    await migrateToLocalV1(plugin, store);
    expect(plugin.settings.nativeAgent.apiKey).toBe("should-not-touch");
    expect(store.save).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
