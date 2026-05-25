import { describe, it, expect, vi } from "vitest";
import { DomainStore, DomainCorruptError } from "../src/domain-store";
import type { DomainEntry } from "../src/domain";

function makeVault(adapter: Record<string, any>, extra: Record<string, any> = {}): any {
  return { adapter, createFolder: vi.fn().mockResolvedValue(undefined), ...extra };
}

const sampleDomain: DomainEntry = {
  id: "os",
  name: "OS",
  wiki_folder: "os",
  source_paths: [],
  entity_types: [],
  language_notes: "",
};

describe("DomainStore", () => {
  describe("load", () => {
    it("returns [] when file missing", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(false),
        read: vi.fn(),
      };
      const store = new DomainStore(makeVault(adapter));
      expect(await store.load()).toEqual([]);
    });

    it("returns parsed domains when file present", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify([sampleDomain])),
      };
      const store = new DomainStore(makeVault(adapter));
      const result = await store.load();
      expect(result).toEqual([sampleDomain]);
    });

    it("throws DomainCorruptError on invalid JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue("{not json"),
      };
      const store = new DomainStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainCorruptError);
    });

    it("strips !Wiki/ prefix from wiki_folder on load", async () => {
      const stored = [{ ...sampleDomain, wiki_folder: "!Wiki/os" }];
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify(stored)),
      };
      const store = new DomainStore(makeVault(adapter));
      const result = await store.load();
      expect(result[0].wiki_folder).toBe("os");
    });

    it("idempotent strip: already-migrated wiki_folder is unchanged", async () => {
      const stored = [
        { ...sampleDomain, id: "a", wiki_folder: "os" },
        { ...sampleDomain, id: "b", wiki_folder: "Wiki/sub" },
      ];
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify(stored)),
      };
      const store = new DomainStore(makeVault(adapter));
      const result = await store.load();
      expect(result[0].wiki_folder).toBe("os");
      expect(result[1].wiki_folder).toBe("Wiki/sub");
    });

    it("throws DomainCorruptError on non-array JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue('{"foo":"bar"}'),
      };
      const store = new DomainStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainCorruptError);
    });
  });

  describe("save", () => {
    it("creates !Wiki dir if missing, writes tmp, then renames", async () => {
      const calls: string[] = [];
      const adapter = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          calls.push(`exists:${p}`);
          return false;
        }),
        write: vi.fn().mockImplementation(async (p: string) => { calls.push(`write:${p}`); }),
        rename: vi.fn().mockImplementation(async (a: string, b: string) => { calls.push(`rename:${a}->${b}`); }),
        remove: vi.fn().mockImplementation(async (p: string) => { calls.push(`remove:${p}`); }),
      };
      const vault = makeVault(adapter, {
        createFolder: vi.fn().mockImplementation(async (p: string) => { calls.push(`createFolder:${p}`); }),
      });
      const store = new DomainStore(vault);
      await store.save([sampleDomain]);
      expect(adapter.write).toHaveBeenCalledWith(
        "!Wiki/_config/_domain.json.tmp",
        JSON.stringify([sampleDomain], null, 2),
      );
      expect(adapter.rename).toHaveBeenCalledWith(
        "!Wiki/_config/_domain.json.tmp",
        "!Wiki/_config/_domain.json",
      );
      expect(calls).toEqual([
        "exists:!Wiki",
        "createFolder:!Wiki",
        "exists:!Wiki/_config",
        "createFolder:!Wiki/_config",
        "write:!Wiki/_config/_domain.json.tmp",
        "exists:!Wiki/_config/_domain.json",
        "rename:!Wiki/_config/_domain.json.tmp->!Wiki/_config/_domain.json",
      ]);
    });

    it("removes existing target before rename, no mkdir when dir exists", async () => {
      const calls: string[] = [];
      const adapter = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          calls.push(`exists:${p}`);
          return true;
        }),
        write: vi.fn().mockImplementation(async (p: string) => { calls.push(`write:${p}`); }),
        rename: vi.fn().mockImplementation(async (a: string, b: string) => { calls.push(`rename:${a}->${b}`); }),
        remove: vi.fn().mockImplementation(async (p: string) => { calls.push(`remove:${p}`); }),
      };
      const vault = makeVault(adapter);
      const store = new DomainStore(vault);
      await store.save([sampleDomain]);
      expect(vault.createFolder).not.toHaveBeenCalled();
      expect(calls).toEqual([
        "exists:!Wiki",
        "exists:!Wiki/_config",
        "write:!Wiki/_config/_domain.json.tmp",
        "exists:!Wiki/_config/_domain.json",
        "remove:!Wiki/_config/_domain.json",
        "rename:!Wiki/_config/_domain.json.tmp->!Wiki/_config/_domain.json",
      ]);
    });
  });
});
