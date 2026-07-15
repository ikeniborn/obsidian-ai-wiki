import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

class MemoryAdapter {
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
  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from); this.files.delete(from); this.files.set(to, v);
  }
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
function vault(adapter: MemoryAdapter): any {
  return { adapter, createFolder: async (path: string) => { adapter.files.set(`${path}/.keep`, ""); } };
}

test("load promotes a leftover metadata.jsonl.tmp to metadata.jsonl", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "!Wiki/bar/metadata.jsonl.tmp",
    '{"kind":"domain","schemaVersion":1,"id":"bar","name":"Bar","wiki_folder":"bar","source_paths":[]}\n',
  );
  const store = new DomainStore(vault(adapter));
  const domains = await store.load();
  assert.deepEqual(domains.map((d) => d.id), ["bar"]);
  assert.equal(await adapter.exists("!Wiki/bar/metadata.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/bar/metadata.jsonl.tmp"), false);
});

test("load leaves a content-only folder with no tmp untouched (deleted-domain safety)", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/foo/index.jsonl", "");
  adapter.files.set("!Wiki/foo/concepts/x.md", "# X\n");
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), []);
  assert.equal(await adapter.exists("!Wiki/foo/metadata.jsonl"), false);
});

test("load ignores an empty folder", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/empty/.keep", "");
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), []);
});
