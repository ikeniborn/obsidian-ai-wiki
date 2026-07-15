import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") {
    return { url: "node:path", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { ensureEntityTypeTag } = await import("../src/utils/tag-registry");

test("page under the derived folder of an empty-subfolder type gets the type tag", () => {
  const domain = {
    id: "os", name: "OS", wiki_folder: "os",
    entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
  };
  const content = "---\ntags: []\n---\nbody\n";
  const { added, tag } = ensureEntityTypeTag(content, "!Wiki/os/Concept/Foo.md", domain);
  assert.equal(added, true);
  assert.equal(tag, "concept");
});
