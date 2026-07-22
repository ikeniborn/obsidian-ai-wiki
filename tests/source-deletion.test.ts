import assert from "node:assert/strict";
import test from "node:test";
import { computeDeletionPlan } from "../src/source-deletion";

test("deletion plan matches full-path resource entries and preserves remaining source paths", () => {
  const pages = new Map([
    ["!Wiki/demo/concept/wiki_demo_delete.md", [
      "---",
      "resource:",
      "  - src/source.md",
      "---",
      "# Delete",
    ].join("\n")],
    ["!Wiki/demo/concept/wiki_demo_rebuild.md", [
      "---",
      "resource:",
      "  - src/source.md",
      "  - archive/other.md",
      "---",
      "# Rebuild",
    ].join("\n")],
  ]);

  const plan = computeDeletionPlan("src/source.md", pages, new Map());

  assert.deepEqual(plan.toDelete, ["!Wiki/demo/concept/wiki_demo_delete.md"]);
  assert.deepEqual(plan.toRebuild, ["!Wiki/demo/concept/wiki_demo_rebuild.md"]);
  assert.deepEqual(plan.remainingSources, ["archive/other.md"]);
});

test("deletion plan remains compatible with legacy stem resource entries", () => {
  const pages = new Map([
    ["!Wiki/demo/concept/wiki_demo_delete.md", [
      "---",
      "resource: [source]",
      "---",
      "# Delete",
    ].join("\n")],
    ["!Wiki/demo/concept/wiki_demo_rebuild.md", [
      "---",
      "resource: [source, other]",
      "---",
      "# Rebuild",
    ].join("\n")],
  ]);

  const plan = computeDeletionPlan("src/source.md", pages, new Map([["other", "archive/other.md"]]));

  assert.deepEqual(plan.toDelete, ["!Wiki/demo/concept/wiki_demo_delete.md"]);
  assert.deepEqual(plan.toRebuild, ["!Wiki/demo/concept/wiki_demo_rebuild.md"]);
  assert.deepEqual(plan.remainingSources, ["archive/other.md"]);
});
