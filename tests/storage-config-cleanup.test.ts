import assert from "node:assert/strict";
import test from "node:test";
import { removeEmptyConfigDirs, runStorageMigration } from "../src/storage-migration";

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
  async rmdir(p: string, _recursive?: boolean): Promise<void> { this.dirs.delete(p); }
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

/**
 * Obsidian's desktop adapter implements `rmdir(path, recursive)` as
 * `fs.rm(path, { recursive })`, so the non-recursive form rejects every
 * directory with EISDIR and can never remove one. FolderAdapter above ignores
 * the flag, which is why the defect stayed invisible; this adapter does not.
 */
class DesktopFolderAdapter extends FolderAdapter {
  contents = new Map<string, string>();

  override async rmdir(p: string, recursive: boolean): Promise<void> {
    if (!recursive) throw Object.assign(new Error(`EISDIR: illegal operation on a directory, ${p}`), { code: "EISDIR" });
    for (const d of [...this.dirs]) if (d === p || d.startsWith(`${p}/`)) this.dirs.delete(d);
    for (const f of [...this.files]) if (f.startsWith(`${p}/`)) this.files.delete(f);
  }

  async read(p: string): Promise<string> { return this.contents.get(p) ?? ""; }
  async write(p: string, data: string): Promise<void> { this.files.add(p); this.contents.set(p, data); }
  async append(p: string, data: string): Promise<void> {
    this.files.add(p);
    this.contents.set(p, (this.contents.get(p) ?? "") + data);
  }
  async remove(p: string): Promise<void> { this.files.delete(p); this.contents.delete(p); }
}

function desktopVault(a: DesktopFolderAdapter): any {
  return { adapter: a, createFolder: async (p: string) => { a.dirs.add(p); } };
}

test("removeEmptyConfigDirs removes empty _config on an adapter that rejects non-recursive rmdir", async () => {
  const a = new DesktopFolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");
  a.dirs.add("!Wiki/os");
  a.dirs.add("!Wiki/os/_config");
  a.files.add("!Wiki/os/metadata.jsonl");

  await removeEmptyConfigDirs(desktopVault(a));

  assert.equal(await a.exists("!Wiki/_config"), false);
  assert.equal(await a.exists("!Wiki/os/_config"), false);
  assert.equal(await a.exists("!Wiki/os"), true);
  assert.equal(await a.exists("!Wiki/os/metadata.jsonl"), true);
});

test("removeEmptyConfigDirs keeps a populated _config on the same adapter", async () => {
  const a = new DesktopFolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");
  await a.write("!Wiki/_config/_domain.json", "[]");

  await removeEmptyConfigDirs(desktopVault(a));

  assert.equal(await a.exists("!Wiki/_config"), true);
  assert.equal(await a.exists("!Wiki/_config/_domain.json"), true);
});

test("runStorageMigration removes the emptied legacy .config directories", async () => {
  const a = new DesktopFolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/.config");
  a.dirs.add("!Wiki/os");
  a.dirs.add("!Wiki/os/.config");
  await a.write("!Wiki/.config/_domain.json", JSON.stringify([{ wiki_folder: "os" }]));
  await a.write("!Wiki/os/.config/_index.md", "# index");
  await a.write("!Wiki/os/.config/_agent.jsonl", "{}\n");

  await runStorageMigration(desktopVault(a));

  assert.equal(await a.exists("!Wiki/os/_config/_index.md"), true);
  assert.equal(await a.exists("!Wiki/os/.config"), false);
  assert.equal(await a.exists("!Wiki/.config"), false);
});
