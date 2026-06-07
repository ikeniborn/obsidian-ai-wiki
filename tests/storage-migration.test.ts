import { describe, it, expect, vi } from "vitest";
import { runStorageMigration, StorageMigrationConflictError, cleanupBundledSchemaCopies } from "../src/storage-migration";

function makeVault(files: Map<string, string>, mtimes: Map<string, number> = new Map()) {
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p)),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    append: vi.fn(async (p: string, c: string) => {
      files.set(p, (files.get(p) ?? "") + c);
    }),
    remove: vi.fn(async (p: string) => { files.delete(p); }),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a)!); files.delete(a);
    }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn(async (p: string) => ({ mtime: mtimes.get(p) ?? 0 })),
    list: vi.fn(async (p: string) => ({
      files: [...files.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
      folders: [],
    })),
  };
  return {
    adapter,
    createFolder: vi.fn().mockResolvedValue(undefined),
  } as any;
}

const DOMAIN_JSON = JSON.stringify([{ id: "os", wiki_folder: "os" }]);

describe("runStorageMigration", () => {
  it("skips when !Wiki/.config/ absent", async () => {
    const files = new Map<string, string>();
    const vault = makeVault(files);
    await runStorageMigration(vault);
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("moves _domain.json to !Wiki/_config/", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "schema"],
      ["!Wiki/.config/_format_schema.md", "format"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.has("!Wiki/_config/_domain.json")).toBe(true);
    expect(JSON.parse(files.get("!Wiki/_config/_domain.json")!)).toEqual([{ id: "os", wiki_folder: "os" }]);
    expect(files.has("!Wiki/.config/_domain.json")).toBe(false);
  });

  it("moves per-domain _index.md and _log.md to _config/", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "schema"],
      ["!Wiki/.config/_format_schema.md", "format"],
      ["!Wiki/os/.config/_index.md", "index content"],
      ["!Wiki/os/.config/_log.md", "log content"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.get("!Wiki/os/_config/_index.md")).toBe("index content");
    expect(files.get("!Wiki/os/_config/_log.md")).toBe("log content");
    expect(files.has("!Wiki/os/.config/_index.md")).toBe(false);
    expect(files.has("!Wiki/os/.config/_log.md")).toBe(false);
  });

  it("does not write schema files to the new global _config (schemas are bundled)", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "old schema"],
      ["!Wiki/.config/_format_schema.md", "old format"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.has("!Wiki/_config/_wiki_schema.md")).toBe(false);
    expect(files.has("!Wiki/_config/_format_schema.md")).toBe(false);
  });

  it("merges _agent.jsonl lines to global path", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "s"],
      ["!Wiki/.config/_format_schema.md", "f"],
      ["!Wiki/os/.config/_agent.jsonl", '{"op":"ingest"}\n'],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.get("!Wiki/_config/_agent.jsonl")).toContain('"op":"ingest"');
  });

  it("throws StorageMigrationConflictError when both .config and _config exist", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/_config/_domain.json", DOMAIN_JSON],
    ]);
    await expect(runStorageMigration(makeVault(files))).rejects.toThrow(StorageMigrationConflictError);
  });

  it("removes old .config directories after migration", async () => {
    const files = new Map([
      ["!Wiki/.config/_domain.json", DOMAIN_JSON],
      ["!Wiki/.config/_wiki_schema.md", "s"],
      ["!Wiki/.config/_format_schema.md", "f"],
      ["!Wiki/os/.config/_index.md", "idx"],
    ]);
    await runStorageMigration(makeVault(files));
    expect(files.has("!Wiki/.config/_domain.json")).toBe(false);
    expect(files.has("!Wiki/os/.config/_index.md")).toBe(false);
  });
});

describe("cleanupBundledSchemaCopies", () => {
  it("removes stale global schema copies from _config", async () => {
    const files = new Map([
      ["!Wiki/_config/_wiki_schema.md", "stale schema"],
      ["!Wiki/_config/_format_schema.md", "stale format"],
      ["!Wiki/_config/_domain.json", DOMAIN_JSON],
    ]);
    await cleanupBundledSchemaCopies(makeVault(files));
    expect(files.has("!Wiki/_config/_wiki_schema.md")).toBe(false);
    expect(files.has("!Wiki/_config/_format_schema.md")).toBe(false);
    // unrelated config untouched
    expect(files.has("!Wiki/_config/_domain.json")).toBe(true);
  });

  it("no-op when schema copies absent", async () => {
    const files = new Map([["!Wiki/_config/_domain.json", DOMAIN_JSON]]);
    await cleanupBundledSchemaCopies(makeVault(files));
    expect(files.has("!Wiki/_config/_domain.json")).toBe(true);
  });
});
