import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/content-hash";
import { PageActionSchema } from "../src/phases/zod-schemas";
import {
  applyPagePatch,
  inspectPatchablePage,
  type PatchPage,
} from "../src/section-patches";

const page = `---
type: concept
resource: [source]
---
# Demo

Intro stays byte-stable.

## Facts
alpha

## Related
- [[wiki_d_existing]]
`;

function patchFor(current: string, sections: PatchPage["sections"]): PatchPage {
  return {
    kind: "patch",
    path: "!Wiki/d/concept/wiki_d_demo.md",
    expectedPageHash: inspectPatchablePage(current).pageHash,
    sections,
  };
}

function patch(sections: PatchPage["sections"]): PatchPage {
  return patchFor(page, sections);
}

function assertSectionStable(
  before: ReturnType<typeof inspectPatchablePage>,
  after: ReturnType<typeof inspectPatchablePage>,
  heading: string,
): void {
  assert.deepEqual(
    after.sections.find((section) => section.heading === heading),
    before.sections.find((section) => section.heading === heading),
  );
}

test("inspection returns the exact preamble and H2 section spans", () => {
  const inspected = inspectPatchablePage(page);

  assert.equal(inspected.pageHash, contentHash(page));
  assert.equal(inspected.preamble, `---
type: concept
resource: [source]
---
# Demo

Intro stays byte-stable.

`);
  assert.deepEqual(inspected.sections.map(({ heading, span, hash }) => ({ heading, span, hash })), [
    {
      heading: "## Facts",
      span: "## Facts\nalpha\n",
      hash: contentHash("## Facts\nalpha\n"),
    },
    {
      heading: "## Related",
      span: "## Related\n- [[wiki_d_existing]]\n",
      hash: contentHash("## Related\n- [[wiki_d_existing]]\n"),
    },
  ]);
});

test("inspection preserves CRLF frontmatter and section bytes", () => {
  const current = "---\r\ntype: concept\r\n---\r\n# Demo\r\n\r\n## Facts\r\nalpha\r\n";
  const inspected = inspectPatchablePage(current);

  assert.equal(inspected.preamble, "---\r\ntype: concept\r\n---\r\n# Demo\r\n\r\n");
  assert.equal(inspected.sections[0].span, "## Facts\r\nalpha\r\n");
  assert.equal(inspected.sections[0].hash, contentHash("## Facts\r\nalpha\r\n"));
});

test("inspection keeps H2-like YAML comments inside valid CRLF frontmatter", () => {
  const current = [
    "---",
    "type: concept",
    "## YAML comment, not a body section",
    "resource: [source]",
    "---",
    "# Demo",
    "",
    "## Facts",
    "alpha",
    "",
  ].join("\r\n");
  const inspected = inspectPatchablePage(current);

  assert.equal(inspected.preamble, `${[
    "---",
    "type: concept",
    "## YAML comment, not a body section",
    "resource: [source]",
    "---",
    "# Demo",
    "",
  ].join("\r\n")}\r\n`);
  assert.deepEqual(inspected.sections.map((section) => section.heading), ["## Facts"]);
  assert.equal(inspected.sections[0].span, "## Facts\r\nalpha\r\n");
});

test("replace cannot target an H2-like line inside frontmatter", () => {
  const current = [
    "---",
    "type: concept",
    "## YAML comment, not a body section",
    "resource: [source]",
    "---",
    "# Demo",
    "",
    "## Facts",
    "alpha",
    "",
  ].join("\r\n");
  const yamlStart = current.indexOf("## YAML comment");
  const bodyStart = current.indexOf("## Facts");
  const legacyFalseSectionHash = contentHash(current.slice(yamlStart, bodyStart));

  assert.deepEqual(applyPagePatch(current, patchFor(current, [{
    heading: "## YAML comment, not a body section",
    expectedSectionHash: legacyFalseSectionHash,
    operation: "replace",
    content: "corrupted",
  }]), new Set([legacyFalseSectionHash])), {
    ok: false,
    reason: "heading_missing",
    heading: "## YAML comment, not a body section",
  });
});

test("unclosed frontmatter does not hide later body sections", () => {
  const current = "---\r\ntype: concept\r\n# missing closing delimiter\r\n\r\n## Body\r\nalpha\r\n";
  const inspected = inspectPatchablePage(current);

  assert.equal(inspected.preamble, "---\r\ntype: concept\r\n# missing closing delimiter\r\n\r\n");
  assert.deepEqual(inspected.sections.map((section) => section.heading), ["## Body"]);
  assert.equal(inspected.sections[0].span, "## Body\r\nalpha\r\n");
});

test("inspection ignores H2-like lines inside backtick and tilde fences", () => {
  const current = [
    "# Demo",
    "",
    "````md",
    "## Not a section",
    "```",
    "````",
    "",
    "## Real",
    "before",
    "~~~text",
    "## Also not a section",
    "~~~",
    "after",
    "",
  ].join("\n");
  const inspected = inspectPatchablePage(current);

  assert.deepEqual(inspected.sections.map((section) => section.heading), ["## Real"]);
  assert.equal(inspected.preamble, "# Demo\n\n````md\n## Not a section\n```\n````\n\n");
  assert.equal(inspected.sections[0].span, "## Real\nbefore\n~~~text\n## Also not a section\n~~~\nafter\n");
});

test("add preserves frontmatter, preamble, and every existing section byte", () => {
  const inspected = inspectPatchablePage(page);
  const result = applyPagePatch(page, patch([
    { heading: "## Limits", operation: "add", content: "none" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content.slice(0, page.length), page);
  assert.equal(result.content.slice(0, inspected.preamble.length), inspected.preamble);
  for (const section of inspected.sections) assert.ok(result.content.includes(section.span));
  assert.match(result.content, /## Limits\nnone/);
  assert.deepEqual(result.changedHeadings, ["## Limits"]);
  const after = inspectPatchablePage(result.content);
  for (const section of inspected.sections) assertSectionStable(inspected, after, section.heading);
});

test("add rejects an existing normalized heading", () => {
  assert.deepEqual(applyPagePatch(page, patch([
    { heading: "##  facts ", operation: "add", content: "duplicate" },
  ]), new Set()), {
    ok: false,
    reason: "heading_exists",
    heading: "##  facts ",
  });
});

test("add keeps CRLF metadata bytes and uses the page line ending", () => {
  const current = "---\r\ntype: concept\r\nresource: [source]\r\n---\r\n# Demo\r\n\r\n## Facts\r\nalpha\r\n";
  const result = applyPagePatch(current, patchFor(current, [
    { heading: "## Limits", operation: "add", content: "none" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content.slice(0, current.length), current);
  assert.match(result.content, /\r\n## Limits\r\nnone\r\n$/);
});

test("add to an empty page starts at the first byte", () => {
  const current = "";
  const result = applyPagePatch(current, patchFor(current, [
    { heading: "## Facts", operation: "add", content: "alpha" },
  ]), new Set());

  assert.deepEqual(result, {
    ok: true,
    content: "## Facts\nalpha\n",
    changedHeadings: ["## Facts"],
  });
});

test("append keeps existing text and suppresses an exact duplicate", () => {
  const facts = inspectPatchablePage(page).sections[0].span;
  const result = applyPagePatch(page, patch([
    { heading: "## Facts", operation: "append", content: "alpha\nbeta" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(facts));
  assert.equal((result.content.match(/^alpha$/gm) ?? []).length, 1);
  assert.equal((result.content.match(/^beta$/gm) ?? []).length, 1);
  assert.deepEqual(result.changedHeadings, ["## Facts"]);
});

test("append deduplicates normalized paragraphs and repeated incoming content", () => {
  const current = "# Demo\n\n## Facts\nAlpha fact.\n\nTwo line\nparagraph.\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: [
      "  Alpha   fact.  ",
      "",
      "Two line",
      "paragraph.",
      "",
      "New two line",
      "new paragraph.",
      "",
      "New two line",
      "new paragraph.",
    ].join("\n"),
  }]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.content.match(/Alpha fact\./g) ?? []).length, 1);
  assert.equal((result.content.match(/Two line\nparagraph\./g) ?? []).length, 1);
  assert.equal((result.content.match(/New two line\nnew paragraph\./g) ?? []).length, 1);
});

test("append preserves Markdown indentation in new content", () => {
  const current = "# Demo\n\n## Facts\n- existing\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "  - nested\n    continuation",
  }]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /  - nested\n    continuation\n$/);
});

test("append returns an exact no-op when all content already exists", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## Facts", operation: "append", content: "  alpha  \n\nalpha" },
  ]), new Set());

  assert.deepEqual(result, {
    ok: true,
    content: page,
    changedHeadings: [],
  });
});

test("append rejects a missing heading", () => {
  assert.deepEqual(applyPagePatch(page, patch([
    { heading: "## Missing", operation: "append", content: "fact" },
  ]), new Set()), {
    ok: false,
    reason: "heading_missing",
    heading: "## Missing",
  });
});

test("replace requires the supplied full current section hash", () => {
  const inspected = inspectPatchablePage(page);
  const facts = inspected.sections.find((section) => section.heading === "## Facts")!;
  const allowed = new Set([facts.hash]);
  const result = applyPagePatch(page, patch([
    {
      heading: "## Facts",
      expectedSectionHash: facts.hash,
      operation: "replace",
      content: "gamma",
    },
  ]), allowed);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /## Facts\ngamma/);
  assert.match(result.content, /## Related\n- \[\[wiki_d_existing\]\]/);
  assert.equal(result.content.slice(0, inspected.preamble.length), inspected.preamble);
  assert.ok(result.content.includes(inspected.sections[1].span));
});

test("replace rejects a hash whose full section context was not supplied", () => {
  const facts = inspectPatchablePage(page).sections[0];
  assert.deepEqual(applyPagePatch(page, patch([{
    heading: "## Facts",
    expectedSectionHash: facts.hash,
    operation: "replace",
    content: "gamma",
  }]), new Set()), {
    ok: false,
    reason: "replace_context_missing",
    heading: "## Facts",
  });
});

test("stale page and section hashes cannot overwrite content", () => {
  assert.deepEqual(applyPagePatch(page + "new edit\n", patch([]), new Set()), {
    ok: false,
    reason: "page_hash_mismatch",
  });
  const bad = patch([{
    heading: "## Facts",
    expectedSectionHash: "stale",
    operation: "replace",
    content: "x",
  }]);
  assert.deepEqual(applyPagePatch(page, bad, new Set(["stale"])), {
    ok: false,
    reason: "section_hash_mismatch",
    heading: "## Facts",
  });
});

test("multiple adds are applied in input order", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## First new", operation: "add", content: "one" },
    { heading: "## Second new", operation: "add", content: "two" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.indexOf("## First new") < result.content.indexOf("## Second new"));
  assert.deepEqual(result.changedHeadings, ["## First new", "## Second new"]);
});

test("add then replace accepts the original hash of an independent existing section", () => {
  const before = inspectPatchablePage(page);
  const related = before.sections.find((section) => section.heading === "## Related")!;
  const result = applyPagePatch(page, patch([
    { heading: "## Limits", operation: "add", content: "none" },
    {
      heading: "## Related",
      expectedSectionHash: related.hash,
      operation: "replace",
      content: "- [[wiki_d_new]]",
    },
  ]), new Set([related.hash]));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.changedHeadings, ["## Limits", "## Related"]);
  assert.match(result.content, /## Related\n- \[\[wiki_d_new\]\]/);
  assert.match(result.content, /## Limits\nnone\n$/);
  assertSectionStable(before, inspectPatchablePage(result.content), "## Facts");
});

test("add then append preserves every independent existing section span and hash", () => {
  const before = inspectPatchablePage(page);
  const result = applyPagePatch(page, patch([
    { heading: "## Limits", operation: "add", content: "none" },
    { heading: "## Facts", operation: "append", content: "beta" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.changedHeadings, ["## Limits", "## Facts"]);
  assert.match(result.content, /## Facts\nalpha\n\nbeta/);
  assert.match(result.content, /## Limits\nnone\n$/);
  assertSectionStable(before, inspectPatchablePage(result.content), "## Related");
});

test("replace then add preserves untouched spans and operation order", () => {
  const before = inspectPatchablePage(page);
  const facts = before.sections.find((section) => section.heading === "## Facts")!;
  const result = applyPagePatch(page, patch([
    {
      heading: "## Facts",
      expectedSectionHash: facts.hash,
      operation: "replace",
      content: "gamma",
    },
    { heading: "## Limits", operation: "add", content: "none" },
  ]), new Set([facts.hash]));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.changedHeadings, ["## Facts", "## Limits"]);
  assert.match(result.content, /## Facts\ngamma/);
  assert.match(result.content, /## Limits\nnone\n$/);
  assertSectionStable(before, inspectPatchablePage(result.content), "## Related");
});

test("patch output finishes with exactly one trailing newline", () => {
  const current = "# Demo\n\n## Facts\nalpha";
  const result = applyPagePatch(current, patchFor(current, [
    { heading: "## Limits", operation: "add", content: "none\n\n" },
  ]), new Set());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /none\n$/);
  assert.doesNotMatch(result.content, /\n\n$/);
});

test("page action schema accepts create and patch variants", () => {
  assert.equal(PageActionSchema.safeParse({
    kind: "create",
    path: "!Wiki/d/concept/wiki_d_new.md",
    annotation: "New concept",
    content: "# New",
  }).success, true);
  assert.equal(PageActionSchema.safeParse(patch([
    { heading: "## Facts", operation: "append", content: "beta" },
  ])).success, true);
});

test("page action schema rejects blank headings and content", () => {
  const invalid = [
    patch([{ heading: "   ", operation: "add", content: "fact" }]),
    patch([{ heading: "##   ", operation: "add", content: "fact" }]),
    patch([{ heading: "## Facts", operation: "append", content: " \n\t " }]),
    {
      kind: "create",
      path: "!Wiki/d/concept/wiki_d_new.md",
      annotation: "New concept",
      content: " \n ",
    },
  ];

  for (const action of invalid) assert.equal(PageActionSchema.safeParse(action).success, false);
});

test("page action schema requires replace hashes and rejects add hashes", () => {
  assert.equal(PageActionSchema.safeParse(patch([{
    heading: "## Facts",
    operation: "replace",
    content: "gamma",
  }])).success, false);
  assert.equal(PageActionSchema.safeParse(patch([{
    heading: "## Limits",
    expectedSectionHash: "fnv1a:12345678",
    operation: "add",
    content: "none",
  }])).success, false);
});

test("page action schema rejects duplicate normalized headings", () => {
  assert.equal(PageActionSchema.safeParse(patch([
    { heading: "## Facts", operation: "append", content: "beta" },
    { heading: "##  facts ", operation: "append", content: "gamma" },
  ])).success, false);
});

test("page action schema rejects deletion", () => {
  const action = patch([]) as unknown as Record<string, unknown>;
  action.sections = [{ heading: "## Facts", operation: "delete", content: "alpha" }];
  assert.equal(PageActionSchema.safeParse(action).success, false);
});
