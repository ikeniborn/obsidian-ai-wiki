import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/content-hash";
import { PageActionSchema } from "../src/phases/zod-schemas";
import {
  applyPagePatch as applyPagePatchInternal,
  inspectPatchablePage,
  type PatchPage,
  type ReplaceSectionAuthority,
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

function applyPagePatch(
  current: string,
  patch: PatchPage,
  authorities: readonly ReplaceSectionAuthority[] = [],
): ReturnType<typeof applyPagePatchInternal> {
  return applyPagePatchInternal(current, patch, authorities);
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

function rawPatchFor(current: string, sections: unknown[]): Record<string, unknown> {
  return {
    kind: "patch",
    path: "!Wiki/d/concept/wiki_d_demo.md",
    expectedPageHash: inspectPatchablePage(current).pageHash,
    sections,
  };
}

function applyRawPatch(
  current: string,
  sections: unknown[],
  replaceAuthorities: readonly ReplaceSectionAuthority[] = [],
): ReturnType<typeof applyPagePatch> {
  return applyPagePatch(
    current,
    rawPatchFor(current, sections) as unknown as PatchPage,
    replaceAuthorities,
  );
}

test("direct apply requires exactly one single-line H2 heading", () => {
  for (const heading of ["Facts", "# Facts", "### Facts", "##   "]) {
    assert.throws(
      () => applyRawPatch(page, [{ heading, operation: "add", content: "fact" }]),
      /single-line H2/i,
    );
  }
});

test("page action schema requires exactly one single-line H2 heading", () => {
  for (const heading of ["Facts", "# Facts", "### Facts", "##   "]) {
    assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [
      { heading, operation: "add", content: "fact" },
    ])).success, false);
  }
});

test("direct apply rejects heading newline injection", () => {
  for (const heading of [
    "## Facts\n## Injected",
    "## Facts\r\n## Injected",
    "## Facts\r## Injected",
  ]) {
    assert.throws(() => applyRawPatch(page, [{
      heading,
      operation: "append",
      content: "fact",
    }]), /single-line H2/i);
  }
});

test("page action schema rejects heading newline injection", () => {
  for (const heading of [
    "## Facts\n## Injected",
    "## Facts\r\n## Injected",
    "## Facts\r## Injected",
  ]) {
    assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [{
      heading,
      operation: "append",
      content: "fact",
    }])).success, false);
  }
});

test("direct apply rejects blank section content", () => {
  assert.throws(() => applyRawPatch(page, [{
    heading: "## New",
    operation: "add",
    content: " \n\t ",
  }]), /content.*blank/i);
});

test("page action schema rejects blank section content", () => {
  assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [{
    heading: "## New",
    operation: "add",
    content: " \n\t ",
  }])).success, false);
});

test("direct apply rejects expectedSectionHash on add", () => {
  assert.throws(() => applyRawPatch(page, [{
    heading: "## New",
    expectedSectionHash: "fnv1a:12345678",
    operation: "add",
    content: "fact",
  }]), /expectedSectionHash.*add|add.*expectedSectionHash/i);
});

test("page action schema rejects expectedSectionHash on add", () => {
  assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [{
    heading: "## New",
    expectedSectionHash: "fnv1a:12345678",
    operation: "add",
    content: "fact",
  }])).success, false);
});

test("direct apply requires expectedSectionHash on replace", () => {
  assert.throws(() => applyRawPatch(page, [{
    heading: "## Facts",
    operation: "replace",
    content: "gamma",
  }]), /replace.*expectedSectionHash|expectedSectionHash.*replace/i);
});

test("direct apply rejects duplicate normalized patch headings", () => {
  assert.throws(() => applyRawPatch(page, [
    { heading: "## New", operation: "add", content: "one" },
    { heading: "##  new ", operation: "add", content: "two" },
  ]), /duplicate normalized heading/i);
});

test("page action schema rejects duplicate normalized patch headings", () => {
  assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [
    { heading: "## New", operation: "add", content: "one" },
    { heading: "##  new ", operation: "add", content: "two" },
  ])).success, false);
});

test("direct apply rejects a top-level H2 inside section content", () => {
  assert.throws(() => applyRawPatch(page, [{
    heading: "## Facts",
    operation: "append",
    content: "beta\n\n## Injected\nvalue",
  }]), /top-level H2/i);
});

test("page action schema rejects a top-level H2 inside section content", () => {
  assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [{
    heading: "## Facts",
    operation: "append",
    content: "beta\n\n## Injected\nvalue",
  }])).success, false);
});

test("direct apply rejects a lone-CR H2 injection inside section content", () => {
  assert.throws(() => applyRawPatch(page, [{
    heading: "## Facts",
    operation: "append",
    content: "beta\r## Injected\rvalue",
  }]), /top-level H2/i);
});

test("page action schema rejects a lone-CR H2 injection inside section content", () => {
  assert.equal(PageActionSchema.safeParse(rawPatchFor(page, [{
    heading: "## Facts",
    operation: "append",
    content: "beta\r## Injected\rvalue",
  }])).success, false);
});

test("H3 content and H2-like text inside valid fences remain allowed", () => {
  const content = [
    "### Child",
    "text",
    "",
    "```md",
    "## Backtick example",
    "",
    "value",
    "```",
    "",
    "~~~text",
    "## Tilde example",
    "~~~",
  ].join("\n");
  const action = rawPatchFor(page, [{ heading: "## New", operation: "add", content }]);

  assert.equal(PageActionSchema.safeParse(action).success, true);
  const result = applyPagePatch(page, action as unknown as PatchPage, []);
  assert.equal(result.ok, true);
});

test("full preflight rejects a later invalid action before earlier operation handling", () => {
  assert.throws(() => applyRawPatch(page, [
    { heading: "## Facts", operation: "add", content: "would conflict" },
    { heading: "## Injected\n## Other", operation: "add", content: "invalid" },
  ]), /single-line H2/i);
});

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
  }]), []), {
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
  ]), []);

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
  ]), []), {
    ok: false,
    reason: "heading_exists",
    heading: "##  facts ",
  });
});

test("add keeps CRLF metadata bytes and uses the page line ending", () => {
  const current = "---\r\ntype: concept\r\nresource: [source]\r\n---\r\n# Demo\r\n\r\n## Facts\r\nalpha\r\n";
  const result = applyPagePatch(current, patchFor(current, [
    { heading: "## Limits", operation: "add", content: "none" },
  ]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content.slice(0, current.length), current);
  assert.match(result.content, /\r\n## Limits\r\nnone\r\n$/);
});

test("add to an empty page starts at the first byte", () => {
  const current = "";
  const result = applyPagePatch(current, patchFor(current, [
    { heading: "## Facts", operation: "add", content: "alpha" },
  ]), []);

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
  ]), []);

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
  }]), []);

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
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /  - nested\n    continuation\n$/);
});

test("append keeps a nested list atomic when its parent line already exists", () => {
  const current = "# Demo\n\n## Facts\n- Parent\n  - Existing child\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "- Parent\n  - New child",
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /- Parent\n  - Existing child\n\n- Parent\n  - New child\n$/);
});

test("append keeps a fenced block with a blank line atomic", () => {
  const current = "# Demo\n\n## Facts\nconst shared = 1;\n";
  const fenced = "```ts\nconst shared = 1;\n\nconst added = 2;\n```";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: fenced,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(fenced));
});

test("append keeps a table block atomic", () => {
  const current = "# Demo\n\n## Facts\n| Shared | 1 |\n";
  const table = [
    "| Name | Value |",
    "| --- | --- |",
    "| Shared | 1 |",
    "| New | 2 |",
  ].join("\n");
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: table,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(table));
});

test("append keeps a blockquote block atomic", () => {
  const current = "# Demo\n\n## Facts\n> Shared\n";
  const blockquote = "> Shared\n> New";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: blockquote,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(blockquote));
});

test("append keeps a list continuation attached to its marker", () => {
  const current = "# Demo\n\n## Facts\n- Shared\n";
  const listItem = "- Shared\n  continuation";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: listItem,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(listItem));
});

test("append keeps a loose-list continuation after a blank line atomic", () => {
  const current = "# Demo\n\n## Facts\ncontinuation\n";
  const looseList = "- Parent\n\n  continuation";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: looseList,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(looseList));
  assert.equal((result.content.match(/continuation/g) ?? []).length, 2);
});

test("append keeps nested ordered and unordered loose-list continuations atomic", () => {
  const current = "# Demo\n\n## Facts\ncontinuation\n";
  const looseLists = [
    "1. Parent\n   - Child\n\n     continuation",
    "- Parent\n  1. Child\n\n     continuation",
  ];

  for (const looseList of looseLists) {
    const result = applyPagePatch(current, patchFor(current, [{
      heading: "## Facts",
      operation: "append",
      content: looseList,
    }]), []);

    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.ok(result.content.includes(looseList));
    assert.equal((result.content.match(/continuation/g) ?? []).length, 2);
  }
});

test("append suppresses an exact duplicate structural block atomically", () => {
  const current = "# Demo\n\n## Facts\n- Parent\n  - Child\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "- Parent\n  - Child",
  }]), []);

  assert.deepEqual(result, { ok: true, content: current, changedHeadings: [] });
});

test("structural block dedupe keeps indentation significant", () => {
  const current = "# Demo\n\n## Facts\n- Parent\n  - Child\n";
  const differentlyIndented = "- Parent\n    - Child";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: differentlyIndented,
  }]), []);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.includes(differentlyIndented));
  assert.deepEqual(result.changedHeadings, ["## Facts"]);
});

test("append preserves one-line four-space-indented code when plain text matches", () => {
  const current = "# Demo\n\n## Facts\nsame\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "    same",
  }]), []);

  assert.deepEqual(result, {
    ok: true,
    content: "# Demo\n\n## Facts\nsame\n\n    same\n",
    changedHeadings: ["## Facts"],
  });
});

test("append preserves one-line tab-indented code when plain text matches", () => {
  const current = "# Demo\n\n## Facts\nsame\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "\tsame",
  }]), []);

  assert.deepEqual(result, {
    ok: true,
    content: "# Demo\n\n## Facts\nsame\n\n\tsame\n",
    changedHeadings: ["## Facts"],
  });
});

test("append treats one to three leading spaces as ordinary paragraph indentation", () => {
  const current = "# Demo\n\n## Facts\nsame\n";

  for (const content of [" same", "  same", "   same"]) {
    assert.deepEqual(applyPagePatch(current, patchFor(current, [{
      heading: "## Facts",
      operation: "append",
      content,
    }]), []), {
      ok: true,
      content: current,
      changedHeadings: [],
    });
  }
});

test("append returns an exact no-op when all content already exists", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## Facts", operation: "append", content: "  alpha  \n\nalpha" },
  ]), []);

  assert.deepEqual(result, {
    ok: true,
    content: page,
    changedHeadings: [],
  });
});

test("append rejects a missing heading", () => {
  assert.deepEqual(applyPagePatch(page, patch([
    { heading: "## Missing", operation: "append", content: "fact" },
  ]), []), {
    ok: false,
    reason: "heading_missing",
    heading: "## Missing",
  });
});

test("replace requires the supplied full current section hash", () => {
  const inspected = inspectPatchablePage(page);
  const facts = inspected.sections.find((section) => section.heading === "## Facts")!;
  const result = applyPagePatch(page, patch([
    {
      heading: "## Facts",
      expectedSectionHash: facts.hash,
      operation: "replace",
      content: "gamma",
    },
  ]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: facts.heading,
    sectionOrdinal: facts.ordinal,
    sectionHash: facts.hash,
    exactSection: facts.span,
  }]);

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
  }]), []), {
    ok: false,
    reason: "replace_context_missing",
    heading: "## Facts",
  });
});

test("append rejects normalized-equivalent existing headings as ambiguous", () => {
  const current = "# Demo\n\n## Facts\none\n\n##  facts \ntwo\n";

  assert.throws(() => applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    operation: "append",
    content: "three",
  }]), []), /ambiguous.*heading|heading.*ambiguous/i);
});

test("replace uses its expected hash when it uniquely identifies a duplicate heading", () => {
  const current = "# Demo\n\n## Facts\none\n\n##  facts \ntwo\n";
  const inspected = inspectPatchablePage(current);
  const second = inspected.sections[1];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    expectedSectionOrdinal: second.ordinal,
    expectedSectionHash: second.hash,
    operation: "replace",
    content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: second.heading,
    sectionOrdinal: second.ordinal,
    sectionHash: second.hash,
    exactSection: second.span,
  }]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /## Facts\none\n\n## Facts\nupdated\n$/);
});

test("replace uses expected ordinal to select a colliding duplicate heading", () => {
  const current = "# Demo\n\n## Facts\none\n\n## Facts\none\n";
  const inspected = inspectPatchablePage(current);
  const second = inspected.sections[1];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    expectedSectionOrdinal: second.ordinal,
    expectedSectionHash: second.hash,
    operation: "replace",
    content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: second.heading,
    sectionOrdinal: second.ordinal,
    sectionHash: second.hash,
    exactSection: second.span,
  }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /## Facts\none\n\n## Facts\nupdated\n$/);
});

test("replace wrong ordinal cannot fall back to matching hash on a single heading", () => {
  const current = "# Demo\n\n## Facts\none\n";
  const section = inspectPatchablePage(current).sections[0];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts", expectedSectionOrdinal: section.ordinal + 1,
    expectedSectionHash: section.hash, operation: "replace", content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md", heading: section.heading,
    sectionOrdinal: section.ordinal, sectionHash: section.hash, exactSection: section.span,
  }]);
  assert.deepEqual(result, { ok: false, reason: "heading_missing", heading: "## Facts" });
});

test("replace wrong ordinal cannot fall back to matching hash on duplicate headings", () => {
  const current = "# Demo\n\n## Facts\none\n\n## Facts\ntwo\n";
  const sections = inspectPatchablePage(current).sections;
  const second = sections[1];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts", expectedSectionOrdinal: second.ordinal + 1,
    expectedSectionHash: second.hash, operation: "replace", content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md", heading: second.heading,
    sectionOrdinal: second.ordinal, sectionHash: second.hash, exactSection: second.span,
  }]);
  assert.deepEqual(result, { ok: false, reason: "heading_missing", heading: "## Facts" });
});

test("replace rejects identical duplicate section hashes as ambiguous", () => {
  const current = "# Demo\n\n## Facts\nsame\n\n## Facts\nsame\n";
  const inspected = inspectPatchablePage(current);
  assert.equal(inspected.sections[0].hash, inspected.sections[1].hash);

  assert.throws(() => applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    expectedSectionHash: inspected.sections[0].hash,
    operation: "replace",
    content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: inspected.sections[0].heading,
    sectionOrdinal: inspected.sections[0].ordinal,
    sectionHash: inspected.sections[0].hash,
    exactSection: inspected.sections[0].span,
  }]), /ambiguous.*heading|heading.*ambiguous/i);
});

test("replace authority binds path, heading, ordinal, hash, and exact span", () => {
  const current = "# Demo\n\n## A\nalpha\n\n## B\nbeta\n";
  const inspected = inspectPatchablePage(current);
  const authority = [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: inspected.sections[0].heading,
    sectionOrdinal: 0,
    sectionHash: inspected.sections[0].hash,
    exactSection: inspected.sections[0].span,
  }];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## B",
    expectedSectionHash: inspected.sections[0].hash,
    operation: "replace",
    content: "wrong authority",
  }]), authority);
  assert.deepEqual(result, {
    ok: false,
    reason: "replace_context_missing",
    heading: "## B",
  });
});

test("replace rejects an authority with a mismatched exact span", () => {
  const current = "# Demo\n\n## Facts\nold\n";
  const inspected = inspectPatchablePage(current);
  const section = inspected.sections[0];
  const wrongSpan = "## Facts\nother\n";
  const result = applyPagePatch(current, patchFor(current, [{
    heading: "## Facts",
    expectedSectionOrdinal: section.ordinal,
    expectedSectionHash: contentHash(wrongSpan),
    operation: "replace",
    content: "updated",
  }]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: section.heading,
    sectionOrdinal: section.ordinal,
    sectionHash: contentHash(wrongSpan),
    exactSection: wrongSpan,
  }]);
  assert.deepEqual(result, { ok: false, reason: "replace_context_missing", heading: "## Facts" });
});

test("known FNV collision cannot cross-authorize a distinct section", () => {
  const first = "## S48427\nvalue-48427\n";
  const second = "## S52229\nvalue-52229\n";
  assert.equal(contentHash(first), contentHash(second));
  const current = `# Demo\n\n${first}\n${second}`;
  const inspected = inspectPatchablePage(current);
  const authority = [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: inspected.sections[0].heading,
    sectionOrdinal: 0,
    sectionHash: inspected.sections[0].hash,
    exactSection: inspected.sections[0].span,
  }];
  const result = applyPagePatch(current, patchFor(current, [{
    heading: inspected.sections[1].heading,
    expectedSectionHash: inspected.sections[1].hash,
    operation: "replace",
    content: "must reject",
  }]), authority);
  assert.deepEqual(result, {
    ok: false,
    reason: "replace_context_missing",
    heading: inspected.sections[1].heading,
  });
});

test("stale page and section hashes cannot overwrite content", () => {
  assert.deepEqual(applyPagePatch(page + "new edit\n", patch([]), []), {
    ok: false,
    reason: "page_hash_mismatch",
  });
  const bad = patch([{
    heading: "## Facts",
    expectedSectionHash: "stale",
    operation: "replace",
    content: "x",
  }]);
  assert.deepEqual(applyPagePatch(page, bad, []), {
    ok: false,
    reason: "replace_context_missing",
    heading: "## Facts",
  });
});

test("multiple adds are applied in input order", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## First new", operation: "add", content: "one" },
    { heading: "## Second new", operation: "add", content: "two" },
  ]), []);

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
  ]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: related.heading,
    sectionOrdinal: related.ordinal,
    sectionHash: related.hash,
    exactSection: related.span,
  }]);

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
  ]), []);

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
  ]), [{
    path: "!Wiki/d/concept/wiki_d_demo.md",
    heading: facts.heading,
    sectionOrdinal: facts.ordinal,
    sectionHash: facts.hash,
    exactSection: facts.span,
  }]);

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
  ]), []);

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
