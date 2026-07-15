import assert from "node:assert/strict";
import test from "node:test";
import { removeDomainFolder } from "../src/domain-store";

class MemAdapter {
  files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + "/"));
  }
  async remove(p: string): Promise<void> { this.files.delete(p); }
  async rmdir(p: string): Promise<void> {
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + "/")) this.files.delete(k);
  }
  async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const k of this.files.keys()) {
      if (!k.startsWith(dir + "/")) continue;
      const rest = k.slice(dir.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${dir}/${first}`);
      else files.push(`${dir}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}

test("removeDomainFolder deletes pages, sidecars, subfolders and the folder itself", async () => {
  const a = new MemAdapter();
  a.files.set("!Wiki/foo/metadata.jsonl", "x");
  a.files.set("!Wiki/foo/index.jsonl", "x");
  a.files.set("!Wiki/foo/log.jsonl", "x");
  a.files.set("!Wiki/foo/tools/wiki_foo_a.md", "x");
  a.files.set("!Wiki/foo/applications/wiki_foo_b.md", "x");
  a.files.set("!Wiki/bar/metadata.jsonl", "x"); // a different domain — must stay

  await removeDomainFolder(a as never, "foo");

  assert.equal(await a.exists("!Wiki/foo"), false, "domain folder must be gone");
  assert.equal([...a.files.keys()].some((k) => k.startsWith("!Wiki/foo")), false, "no foo files remain");
  assert.equal(a.files.has("!Wiki/bar/metadata.jsonl"), true, "other domain untouched");
});

test("removeDomainFolder is a no-op when the folder does not exist", async () => {
  const a = new MemAdapter();
  a.files.set("!Wiki/bar/metadata.jsonl", "x");
  await removeDomainFolder(a as never, "gone");
  assert.equal(a.files.has("!Wiki/bar/metadata.jsonl"), true);
});
