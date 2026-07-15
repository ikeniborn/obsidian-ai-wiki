import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { collectDomainTags } = await import("../src/utils/tag-registry");

test("collectDomainTags excludes loose _index.md meta pages", async () => {
  const vault = {
    listFiles: async (dir: string) =>
      dir === "!Wiki/d" ? ["!Wiki/d/page.md", "!Wiki/d/_index.md"] : [],
    readAll: async (paths: string[]) =>
      new Map(paths.map((p) => [
        p,
        p.endsWith("_index.md")
          ? "---\ntags:\n  - beta\n---\n"
          : "---\ntags:\n  - alpha\n---\n",
      ])),
    toVaultPath: () => null,
  };

  const registry = await collectDomainTags(vault, "!Wiki/d", []);

  assert.equal(registry.categories.has("alpha"), true);
  assert.equal(registry.categories.has("beta"), false); // _index.md must be skipped
});
