import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile, TFolder } from "obsidian";
import { WikiController } from "../src/controller";
import { graphCache } from "../src/wiki-graph-cache";
import type { DomainEntry } from "../src/domain";

function makeFile(path: string) {
  const f = new TFile();
  f.path = path;
  (f as any).extension = "md";
  return f as any;
}

function makeFolder(path: string, children: unknown[]) {
  const f = new TFolder();
  f.path = path;
  (f as any).children = children;
  return f as any;
}

const DOMAIN: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/docs", "/home/notes"],
  entity_types: [],
  language_notes: "",
};

function makeVault(files: { path: string; content: string }[]) {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  const fileObjs = files.map((f) => makeFile(f.path));
  const wikiFolder = makeFolder("!Wiki/ии", fileObjs);

  return {
    getFolderByPath: (p: string) => (p === "!Wiki/ии" ? wikiFolder : null),
    adapter: {
      read: vi.fn().mockImplementation((path: string) => Promise.resolve(fileMap.get(path) ?? "")),
      remove: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      write: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      getBasePath: () => "/tmp/vault",
      getFullPath: (p: string) => `/tmp/vault/${p}`,
    },
    configDir: ".obsidian",
    getName: () => "vault",
    getAbstractFileByPath: vi.fn().mockReturnValue(null),
    modify: vi.fn().mockResolvedValue(undefined),
    createFolder: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApp(vault: ReturnType<typeof makeVault>) {
  return {
    vault,
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => ({ setViewState: vi.fn().mockResolvedValue(undefined) }),
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue(null),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makePlugin(app: ReturnType<typeof makeApp>) {
  return {
    settings: {
      backend: "native-agent",
      nativeAgent: { baseUrl: "https://api.x", apiKey: "k", model: "m", perOperation: false, operations: {} },
      timeouts: { ingest: 30, query: 30, lint: 30, init: 30, format: 30 },
      agentLogEnabled: false,
      history: [],
      historyLimit: 20,
      devMode: { enabled: false, evaluatorModel: "sonnet" },
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app,
  } as unknown as Parameters<typeof WikiController>[1];
}

function build(domains: DomainEntry[] = [DOMAIN], vaultFiles: { path: string; content: string }[] = []) {
  const vault = makeVault(vaultFiles);
  const app = makeApp(vault);
  const plugin = makePlugin(app);
  const domainStore = {
    load: vi.fn().mockResolvedValue(domains),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof WikiController>[2];
  const localConfigStore = {
    load: vi.fn().mockResolvedValue({ iclaudePath: "" }),
  } as unknown as Parameters<typeof WikiController>[3];
  const ctrl = new WikiController(app, plugin, domainStore, localConfigStore);
  return { ctrl, vault, domainStore };
}

describe("WikiController.updateDomainSources", () => {
  it("saves updated source_paths to domainStore", async () => {
    const { ctrl, domainStore } = build();
    await ctrl.updateDomainSources("ai", ["/home/docs", "/home/new"]);
    expect(domainStore.save).toHaveBeenCalledWith([
      { ...DOMAIN, source_paths: ["/home/docs", "/home/new"] },
    ]);
  });

  it("is a no-op for unknown domainId (saves unchanged list)", async () => {
    const { ctrl, domainStore } = build();
    await ctrl.updateDomainSources("unknown", ["/home/docs"]);
    expect(domainStore.save).toHaveBeenCalledOnce();
  });
});

describe("WikiController.cleanupRemovedSources", () => {
  beforeEach(() => { graphCache.clear(); vi.restoreAllMocks(); });

  const orphanContent = `---
wiki_sources:
  - /home/notes/doc.md
---
body`;

  const crossRefContent = `---
wiki_sources:
  - /home/docs/other.md
  - /home/notes/doc.md
---
body`;

  it("deletes wiki files whose ALL wiki_sources are from removed paths", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/orphan.md", content: orphanContent },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(1);
    expect(vault.adapter.remove).toHaveBeenCalledWith("!Wiki/ии/Entities/orphan.md");
  });

  it("keeps files that have at least one source NOT in removedPaths", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/crossref.md", content: crossRefContent },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(0);
    expect(vault.adapter.remove).not.toHaveBeenCalled();
  });

  it("skips files with no wiki_sources frontmatter", async () => {
    const { ctrl, vault } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/no-sources.md", content: "---\ntitle: test\n---\nbody" },
    ]);
    const deleted = await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(deleted).toBe(0);
    expect(vault.adapter.remove).not.toHaveBeenCalled();
  });

  it("returns 0 for unknown domainId", async () => {
    const { ctrl } = build([DOMAIN], []);
    const deleted = await ctrl.cleanupRemovedSources("unknown", ["/home/notes"]);
    expect(deleted).toBe(0);
  });

  it("invalidates graphCache when files are deleted", async () => {
    const { ctrl } = build([DOMAIN], [
      { path: "!Wiki/ии/Entities/orphan.md", content: orphanContent },
    ]);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");
    await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(invalidateSpy).toHaveBeenCalledWith("ai");
  });

  it("does NOT invalidate graphCache when no files deleted", async () => {
    const { ctrl } = build([DOMAIN], []);
    const invalidateSpy = vi.spyOn(graphCache, "invalidate");
    await ctrl.cleanupRemovedSources("ai", ["/home/notes"]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("WikiController.init — extended signature", () => {
  it("accepts optional paths argument without throwing", async () => {
    const { ctrl } = build();
    await expect(ctrl.init("ai", false, ["/home/docs"])).resolves.not.toThrow();
  });

  it("init without paths still works (backward compat)", async () => {
    const { ctrl } = build();
    await expect(ctrl.init("ai", false)).resolves.not.toThrow();
  });
});
