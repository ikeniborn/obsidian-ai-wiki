import assert from "node:assert/strict";
import test from "node:test";
import { removeEmptyConfigDirs } from "../src/storage-migration";

class FolderAdapter {
  files = new Set<string>();
  dirs = new Set<string>();
  async exists(p: string): Promise<boolean> { return this.files.has(p) || this.dirs.has(p); }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders: string[] = [];
    for (const f of this.files) if (f.slice(0, f.lastIndexOf("/")) === p) files.push(f);
    for (const d of this.dirs) if (d.slice(0, d.lastIndexOf("/")) === p) folders.push(d);
    return { files, folders };
  }
  async rmdir(p: string): Promise<void> { this.dirs.delete(p); }
}

function vault(a: FolderAdapter): any { return { adapter: a }; }

test("removeEmptyConfigDirs deletes empty global and per-domain _config, keeps content", async () => {
  const a = new FolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");        // empty global orphan
  a.dirs.add("!Wiki/os");
  a.dirs.add("!Wiki/os/_config");     // empty per-domain orphan
  a.files.add("!Wiki/os/metadata.jsonl");
  a.files.add("!Wiki/os/wiki_os_safari.md");

  await removeEmptyConfigDirs(vault(a));

  assert.equal(await a.exists("!Wiki/_config"), false);
  assert.equal(await a.exists("!Wiki/os/_config"), false);
  assert.equal(await a.exists("!Wiki/os"), true);
  assert.equal(await a.exists("!Wiki/os/metadata.jsonl"), true);
});

test("removeEmptyConfigDirs keeps a non-empty _config", async () => {
  const a = new FolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");
  a.files.add("!Wiki/_config/_domain.json");

  await removeEmptyConfigDirs(vault(a));

  assert.equal(await a.exists("!Wiki/_config"), true);
});
