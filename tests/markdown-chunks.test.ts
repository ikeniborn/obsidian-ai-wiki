import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteSourceCoverage, chunkMarkdownSource } from "../src/markdown-chunks";
import { contentHash } from "../src/content-hash";

test("content hashes use stable FNV-1a values", () => {
  assert.equal(contentHash(""), "fnv1a:811c9dc5");
  assert.equal(contentHash("hello"), "fnv1a:4f9f2cab");
});

test("small source remains one stable chunk", () => {
  const source = "# A\n\nParagraph one.\n\n## B\nParagraph two.";
  const first = chunkMarkdownSource(source, { maxEstimatedTokens: 500, overlapLines: 2 });
  const second = chunkMarkdownSource(source, { maxEstimatedTokens: 500, overlapLines: 2 });
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assertCompleteSourceCoverage(source, first);
});

test("heading and paragraph splits cover every original line", () => {
  const source = ["# Root", "", ...Array.from({ length: 40 }, (_, i) => `line ${i}`), "", "## Tail", "done"].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 80, overlapLines: 1 });
  assert.ok(chunks.length > 1);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
  assert.equal(chunks.every((chunk) => chunk.markdown.length > 0), true);
});

test("oversized fenced blocks retain fence language and source anchors", () => {
  const source = ["# Code", "```bash", ...Array.from({ length: 30 }, (_, i) => `echo ${i}`), "```"].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 60, overlapLines: 2 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.markdown.includes("```bash") && chunk.markdown.includes("```")), true);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("coverage validation rejects a missing line", () => {
  const source = "one\ntwo\nthree";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].endLine = 2;
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /line 3/);
});

test("empty source has no chunks and complete coverage", () => {
  const chunks = chunkMarkdownSource("", { maxEstimatedTokens: 100, overlapLines: 2 });
  assert.deepEqual(chunks, []);
  assert.doesNotThrow(() => assertCompleteSourceCoverage("", chunks));
});

test("CRLF and a trailing newline remain byte-stable", () => {
  const source = "# Root\r\n\r\nBody\r\n";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 4);
  assert.equal(chunks[0].markdown, source);
  assert.equal(chunks[0].contentHash, contentHash(source));
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("nested headings produce stable hierarchical paths", () => {
  const source = [
    "# Root",
    `root ${"x".repeat(20)}`,
    "## Child",
    `child ${"x".repeat(20)}`,
    "### Leaf",
    `leaf ${"x".repeat(20)}`,
    "## Sibling",
    `sibling ${"x".repeat(20)}`,
  ].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 45, overlapLines: 1 });

  assert.deepEqual(chunks.map((chunk) => chunk.headingPath), [
    ["Root"],
    ["Root", "Child"],
    ["Root", "Child", "Leaf"],
    ["Root", "Sibling"],
  ]);
  assert.deepEqual(chunks.map((chunk) => [chunk.startLine, chunk.endLine]), [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.ordinal), [0, 1, 2, 3]);
  assert.equal(chunks.every((chunk) => chunk.id === `${chunk.ordinal}:${chunk.startLine}-${chunk.endLine}:${chunk.contentHash}`), true);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("oversized sections split at blank lines before using overlap", () => {
  const source = [
    "# Root",
    "",
    `first ${"a".repeat(24)}`,
    "",
    `second ${"b".repeat(24)}`,
    "",
    `third ${"c".repeat(24)}`,
  ].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 40, overlapLines: 2 });

  assert.ok(chunks.length > 1);
  for (let index = 1; index < chunks.length; index++) {
    assert.equal(chunks[index].startLine, chunks[index - 1].endLine + 1);
  }
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("tilde fences keep their original language and ignore headings inside code", () => {
  const source = [
    "# Code",
    "~~~typescript",
    "## not a heading",
    ...Array.from({ length: 20 }, (_, i) => `const value${i} = ${i};`),
    "~~~",
  ].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 90, overlapLines: 1 });

  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.headingPath.join("/") === "Code"), true);
  assert.equal(chunks.every((chunk) => chunk.markdown.includes("~~~typescript") && chunk.markdown.includes("~~~")), true);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("longer backtick fences are not closed by shorter delimiters", () => {
  const source = [
    "# Code",
    "````js",
    "```",
    ...Array.from({ length: 16 }, (_, i) => `value(${i});`),
    "````",
  ].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 60, overlapLines: 1 });

  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.markdown.includes("````js") && chunk.markdown.includes("````")), true);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("line windows overlap by the configured number of original lines", () => {
  const source = Array.from({ length: 12 }, (_, i) => `line ${i} ${"x".repeat(12)}`).join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 70, overlapLines: 2 });

  assert.ok(chunks.length > 1);
  for (let index = 1; index < chunks.length; index++) {
    assert.equal(chunks[index].startLine, chunks[index - 1].endLine - 1);
  }
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("synthetic fence wrappers are excluded from the source content hash", () => {
  const sourceLines = [
    "# Code",
    "```rust",
    ...Array.from({ length: 24 }, (_, i) => `let value_${i} = ${i};`),
    "```",
  ];
  const source = sourceLines.join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 80, overlapLines: 1 });
  const wrapped = chunks.find((chunk) => chunk.startLine > 2 && chunk.endLine < sourceLines.length);

  assert.ok(wrapped);
  const originalLines = sourceLines.slice(wrapped.startLine - 1, wrapped.endLine).join("\n");
  assert.equal(wrapped.markdown, `\`\`\`rust\n${originalLines}\n\`\`\``);
  assert.equal(wrapped.contentHash, contentHash(originalLines));
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));

  wrapped.markdown = wrapped.markdown.replace(originalLines, `${originalLines}\ntampered`);
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /hash/i);
});

test("coverage validation accepts intentional overlapping ranges", () => {
  const source = Array.from({ length: 10 }, (_, i) => `line ${i} ${"x".repeat(10)}`).join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 50, overlapLines: 2 });
  assert.ok(chunks.some((chunk, index) => index > 0 && chunk.startLine <= chunks[index - 1].endLine));
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("coverage validation rejects a start before the source", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].startLine = 0;
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /outside.*source/i);
});

test("coverage validation rejects an end after the source", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].endLine = 3;
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /outside.*source/i);
});

test("coverage validation rejects a stale non-fenced chunk hash", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].markdown += " changed";
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /hash/i);
});
