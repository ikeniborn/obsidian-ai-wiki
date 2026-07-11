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

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from);
    this.files.delete(from);
    this.files.set(to, v);
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
  return {
    adapter,
    createFolder: async (path: string) => {
      adapter.files.set(`${path}/.keep`, "");
    },
  };
}

test("DomainStore loads domains from per-domain metadata", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "!Wiki/hld/metadata.jsonl",
    '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":["src"]}\n',
  );
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), [{
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: ["src"],
    entity_types: [],
    analyzed_sources: {},
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  }]);
});
