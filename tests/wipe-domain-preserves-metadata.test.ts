import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { VaultTools } = await import("../src/vault-tools");
const { wipeDomainFolder } = await import("../src/phases/init");

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

test("wipeDomainFolder preserves metadata.jsonl but removes pages, index and log", async () => {
  const a = new MemAdapter();
  a.files.set("!Wiki/oc-mac/metadata.jsonl", '{"kind":"domain","schemaVersion":1,"id":"oc-mac","name":"x","wiki_folder":"oc-mac","source_paths":[]}\n');
  a.files.set("!Wiki/oc-mac/index.jsonl", "x");
  a.files.set("!Wiki/oc-mac/log.jsonl", "x");
  a.files.set("!Wiki/oc-mac/tools/wiki_oc-mac_clashx.md", "# c");
  a.files.set("!Wiki/oc-mac/applications/wiki_oc-mac_safari.md", "# s");

  const vt = new VaultTools(a as never, "/vault");
  await wipeDomainFolder(vt, "oc-mac");

  assert.equal(await a.exists("!Wiki/oc-mac/metadata.jsonl"), true, "metadata.jsonl must survive reinit wipe");
  assert.equal(a.files.has("!Wiki/oc-mac/tools/wiki_oc-mac_clashx.md"), false, "content page removed");
  assert.equal(a.files.has("!Wiki/oc-mac/applications/wiki_oc-mac_safari.md"), false, "content page removed");
  assert.equal(a.files.has("!Wiki/oc-mac/index.jsonl"), false, "index rebuilt from scratch");
  assert.equal(a.files.has("!Wiki/oc-mac/log.jsonl"), false, "log rebuilt from scratch");
});
