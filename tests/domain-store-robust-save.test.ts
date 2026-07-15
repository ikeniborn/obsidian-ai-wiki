import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

// Adapter whose rename ALWAYS throws — reproduces the Obsidian failure that
// left folders with content but no metadata.jsonl. `write` behaves normally.
class RenameHostileAdapter {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/"));
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async rename(): Promise<void> { throw new Error("rename not supported"); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}

// Adapter whose write is a no-op — the file never lands, so save must throw.
class WriteBlackholeAdapter extends RenameHostileAdapter {
  async write(): Promise<void> { /* swallow */ }
}

function vault(adapter: unknown): any {
  return { adapter, createFolder: async (path: string) => { (adapter as any).files.set(`${path}/.keep`, ""); } };
}

test("save persists metadata even when adapter.rename throws", async () => {
  const adapter = new RenameHostileAdapter();
  const store = new DomainStore(vault(adapter));
  await store.save([{ id: "foo", name: "Foo", wiki_folder: "foo", source_paths: ["src"], entity_types: [] }]);
  assert.equal(await adapter.exists("!Wiki/foo/metadata.jsonl"), true);
  assert.deepEqual((await store.load()).map((d) => d.id), ["foo"]);
});

test("save throws when the metadata file is not on disk after writing", async () => {
  const adapter = new WriteBlackholeAdapter();
  const store = new DomainStore(vault(adapter));
  await assert.rejects(
    store.save([{ id: "foo", name: "Foo", wiki_folder: "foo", source_paths: [], entity_types: [] }]),
    /domain metadata write failed/,
  );
});
