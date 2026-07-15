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

const { buildEntityTypesBlock } = await import("../src/phases/ingest");

test("empty wiki_subfolder yields a nested path template, not a flat one", () => {
  const block = buildEntityTypesBlock(
    {
      id: "os", name: "OS", wiki_folder: "os",
      entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
    },
    "!Wiki/os",
  );
  assert.match(block, /!Wiki\/os\/Concept\/<EntityName>\.md/);
  assert.doesNotMatch(block, /!Wiki\/os\/<EntityName>\.md/);
});

test("explicit wiki_subfolder is preserved", () => {
  const block = buildEntityTypesBlock(
    {
      id: "os", name: "OS", wiki_folder: "os",
      entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "concepts" }],
    },
    "!Wiki/os",
  );
  assert.match(block, /!Wiki\/os\/concepts\/<EntityName>\.md/);
});
