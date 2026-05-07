import { describe, it, expect, vi } from "vitest";
import { DomainMapStore, DomainMapCorruptError } from "../src/domain-map-store";
import type { DomainEntry } from "../src/domain-map";

function makeVault(adapter: Record<string, any>): any {
  return { adapter };
}

const sampleDomain: DomainEntry = {
  id: "os",
  name: "OS",
  wiki_folder: "os",
  source_paths: [],
  entity_types: [],
  language_notes: "",
};

describe("DomainMapStore", () => {
  describe("load", () => {
    it("returns [] when file missing", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(false),
        read: vi.fn(),
      };
      const store = new DomainMapStore(makeVault(adapter));
      expect(await store.load()).toEqual([]);
    });

    it("returns parsed domains when file present", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue(JSON.stringify([sampleDomain])),
      };
      const store = new DomainMapStore(makeVault(adapter));
      const result = await store.load();
      expect(result).toEqual([sampleDomain]);
    });

    it("throws DomainMapCorruptError on invalid JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue("{not json"),
      };
      const store = new DomainMapStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainMapCorruptError);
    });

    it("throws DomainMapCorruptError on non-array JSON", async () => {
      const adapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue('{"foo":"bar"}'),
      };
      const store = new DomainMapStore(makeVault(adapter));
      await expect(store.load()).rejects.toBeInstanceOf(DomainMapCorruptError);
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
        mkdir: vi.fn().mockImplementation(async (p: string) => { calls.push(`mkdir:${p}`); }),
        write: vi.fn().mockImplementation(async (p: string) => { calls.push(`write:${p}`); }),
        rename: vi.fn().mockImplementation(async (a: string, b: string) => { calls.push(`rename:${a}->${b}`); }),
        remove: vi.fn().mockImplementation(async (p: string) => { calls.push(`remove:${p}`); }),
      };
      const store = new DomainMapStore(makeVault(adapter));
      await store.save([sampleDomain]);
      expect(adapter.write).toHaveBeenCalledWith(
        "!Wiki/_domain-map.json.tmp",
        JSON.stringify([sampleDomain], null, 2),
      );
      expect(adapter.rename).toHaveBeenCalledWith(
        "!Wiki/_domain-map.json.tmp",
        "!Wiki/_domain-map.json",
      );
      expect(calls).toEqual([
        "exists:!Wiki",
        "mkdir:!Wiki",
        "write:!Wiki/_domain-map.json.tmp",
        "exists:!Wiki/_domain-map.json",
        "rename:!Wiki/_domain-map.json.tmp->!Wiki/_domain-map.json",
      ]);
    });

    it("removes existing target before rename, no mkdir when dir exists", async () => {
      const calls: string[] = [];
      const adapter = {
        exists: vi.fn().mockImplementation(async (p: string) => {
          calls.push(`exists:${p}`);
          return true;
        }),
        mkdir: vi.fn(),
        write: vi.fn().mockImplementation(async (p: string) => { calls.push(`write:${p}`); }),
        rename: vi.fn().mockImplementation(async (a: string, b: string) => { calls.push(`rename:${a}->${b}`); }),
        remove: vi.fn().mockImplementation(async (p: string) => { calls.push(`remove:${p}`); }),
      };
      const store = new DomainMapStore(makeVault(adapter));
      await store.save([sampleDomain]);
      expect(adapter.mkdir).not.toHaveBeenCalled();
      expect(calls).toEqual([
        "exists:!Wiki",
        "write:!Wiki/_domain-map.json.tmp",
        "exists:!Wiki/_domain-map.json",
        "remove:!Wiki/_domain-map.json",
        "rename:!Wiki/_domain-map.json.tmp->!Wiki/_domain-map.json",
      ]);
    });
  });
});
