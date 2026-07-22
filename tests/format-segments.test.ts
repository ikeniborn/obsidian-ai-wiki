import assert from "node:assert/strict";
import test from "node:test";

import {
  reassembleFormatSegments,
  segmentFormatInput,
} from "../src/phases/format-segments";

const source = `---
tags: [a]
source: external-note
---
# Title

Preamble keeps identity.

## One
text ![[one.png]]

## Two
${"detail line\n".repeat(80)}`;

test("small note retains one-call shape", () => {
  const result = segmentFormatInput(source, new Map(), 10_000);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "segment-0");
  assert.equal(result[0].markdown, source);
});

test("oversized note segments by markdown structure and routes each Vision description once", () => {
  const segments = segmentFormatInput(source, new Map([["one.png", "recognized one"]]), 300);

  assert.ok(segments.length > 1);
  assert.equal(segments.filter((segment) => segment.visionDescriptions.has("one.png")).length, 1);
  assert.ok(segments.every((segment) => !segment.markdown.includes("source: external-note")));
  assert.deepEqual(segments.map((segment) => segment.ordinal), segments.map((_, index) => index));

  const formatted = segments.map((segment) => ({
    segmentId: segment.id,
    report: `report ${segment.ordinal}`,
    formatted: segment.markdown,
  }));
  const rebuilt = reassembleFormatSegments(source, segments, formatted);

  assert.equal(rebuilt.formatted, source);
  assert.equal(rebuilt.report.split("\n").length, segments.length);
});

test("oversized h2 section falls back to bounded line windows without truncating lines", () => {
  const longSection = `---
tags: []
---
# Title

## Huge
${Array.from({ length: 30 }, (_, index) => `line-${index.toString().padStart(2, "0")} ${"x".repeat(30)}`).join("\n")}
`;

  const segments = segmentFormatInput(longSection, new Map(), 260);

  assert.ok(segments.length > 2);
  assert.ok(segments.every((segment) => segment.markdown.length <= 260));
  for (let index = 0; index < 30; index++) {
    assert.ok(
      segments.some((segment) => segment.markdown.includes(`line-${index.toString().padStart(2, "0")}`)),
      `missing line ${index}`,
    );
  }
  assert.equal(
    reassembleFormatSegments(longSection, segments, segments.map((segment) => ({
      segmentId: segment.id,
      report: "ok",
      formatted: segment.markdown,
    }))).formatted,
    longSection,
  );
});

test("line-window segmentation never cuts through fenced code blocks", () => {
  const fenced = [
    "---",
    "tags: []",
    "---",
    "# Title",
    "",
    "## Code",
    "```ts",
    ...Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};`),
    "```",
    "",
    "## After",
    "tail",
    "",
  ].join("\n");

  const segments = segmentFormatInput(fenced, new Map(), 180);
  const codeSegments = segments.filter((segment) => segment.markdown.includes("```ts") || segment.markdown.includes("const value"));

  assert.equal(codeSegments.length, 1);
  assert.match(codeSegments[0].markdown, /```ts\n/);
  assert.match(codeSegments[0].markdown, /\n```\n/);
  assert.ok(segments.every((segment) => {
    const fenceMarkers = [...segment.markdown.matchAll(/^```/gm)];
    return fenceMarkers.length === 0 || fenceMarkers.length === 2;
  }));
  assert.equal(
    reassembleFormatSegments(fenced, segments, segments.map((segment) => ({
      segmentId: segment.id,
      report: "ok",
      formatted: segment.markdown,
    }))).formatted,
    fenced,
  );
});

test("segmentation preserves BOM and CRLF frontmatter bytes while excluding it from oversized segments", () => {
  const crlf = "\uFEFF---\r\ntags: [crlf]\r\nsource: external\r\n---\r\n# Title\r\n\r\n## One\r\nbody\r\n\r\n## Two\r\n"
    + Array.from({ length: 20 }, (_, index) => `line ${index}\r\n`).join("");

  const segments = segmentFormatInput(crlf, new Map(), 180);

  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => !segment.markdown.includes("tags: [crlf]")));
  assert.equal(
    reassembleFormatSegments(crlf, segments, segments.map((segment) => ({
      segmentId: segment.id,
      report: "ok",
      formatted: segment.markdown,
    }))).formatted,
    crlf,
  );
});

test("reassembly preserves source-leading thematic delimiter blocks with YAML-looking text", () => {
  const thematic = [
    "---",
    "source: external",
    "---",
    "---",
    "Warning: keep this thematic section",
    "---",
    "Body token",
    "",
    "## Tail",
    ...Array.from({ length: 20 }, (_, index) => `tail ${index}`),
    "",
  ].join("\n");

  const segments = segmentFormatInput(thematic, new Map(), 140);
  const identity = reassembleFormatSegments(thematic, segments, segments.map((segment) => ({
    segmentId: segment.id,
    report: "ok",
    formatted: segment.markdown,
  })));

  assert.equal(identity.formatted, thematic);

  const injected = reassembleFormatSegments(thematic, segments, segments.map((segment) => ({
    segmentId: segment.id,
    report: "ok",
    formatted: segment.ordinal === 0
      ? `---\ntags: [model-added]\n---\n${segment.markdown}`
      : segment.markdown,
  })));

  assert.equal(injected.formatted, thematic);
});

test("missing or duplicate segment IDs fail reassembly", () => {
  const segments = segmentFormatInput(source, new Map(), 300);
  const duplicate = segments.map((segment) => ({
    segmentId: segments[0].id,
    report: "duplicate",
    formatted: segment.markdown,
  }));

  assert.throws(() => reassembleFormatSegments(source, segments, []), /missing/i);
  assert.throws(() => reassembleFormatSegments(source, segments, duplicate), /duplicate/i);
});
