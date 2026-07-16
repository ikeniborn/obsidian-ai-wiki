import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompleteSourceCoverage,
  chunkMarkdownSource,
  extractMarkdownSections,
} from "../src/markdown-chunks";
import { contentHash } from "../src/content-hash";

const estimatedBytes = (text: string): number => new TextEncoder().encode(text).byteLength;

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

test("every returned chunk stays within the strict byte budget", () => {
  const fixtures = [
    {
      source: ["# Root", "", ...Array.from({ length: 40 }, (_, i) => `paragraph line ${i}`)].join("\n"),
      maxEstimatedTokens: 80,
      overlapLines: 1,
    },
    {
      source: ["# Code", "```bash", ...Array.from({ length: 30 }, (_, i) => `echo ${i}`), "```"].join("\n"),
      maxEstimatedTokens: 60,
      overlapLines: 2,
    },
  ];

  for (const fixture of fixtures) {
    const chunks = chunkMarkdownSource(fixture.source, fixture);
    assert.equal(
      chunks.every((chunk) => estimatedBytes(chunk.markdown) <= fixture.maxEstimatedTokens),
      true,
    );
  }
});

test("a source line larger than the budget fails with its range and required size", () => {
  const source = "x".repeat(64);
  assert.throws(
    () => chunkMarkdownSource(source, { maxEstimatedTokens: 32, overlapLines: 0 }),
    /range 1-1 requires 64 estimated tokens but budget is 32/i,
  );
});

test("mandatory fence wrappers larger than the budget fail with their source range", () => {
  const source = "```lang\n1234567890\n```";
  assert.equal(estimatedBytes("```lang\n1234567890\n```"), 22);
  assert.throws(
    () => chunkMarkdownSource(source, { maxEstimatedTokens: 20, overlapLines: 0 }),
    /range 2-2 requires 22 estimated tokens but budget is 20/i,
  );
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

test("maxEstimatedTokens must be a positive safe integer", () => {
  for (const maxEstimatedTokens of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => chunkMarkdownSource("source", { maxEstimatedTokens, overlapLines: 0 }),
      /maxEstimatedTokens must be a positive safe integer/i,
    );
  }
});

test("overlapLines must be a non-negative safe integer", () => {
  for (const overlapLines of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => chunkMarkdownSource("source", { maxEstimatedTokens: 100, overlapLines }),
      /overlapLines must be a non-negative safe integer/i,
    );
  }
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

test("extractMarkdownSections exposes stable ATX sections from the shared scanner", () => {
  const source = "# Root\nroot body\n## Child\nchild body";
  const sections = extractMarkdownSections(source);

  assert.deepEqual(sections.map((section) => ({
    heading: section.heading,
    headingPath: section.headingPath,
    startLine: section.startLine,
    endLine: section.endLine,
    markdown: section.markdown,
  })), [
    {
      heading: "Root",
      headingPath: ["Root"],
      startLine: 1,
      endLine: 2,
      markdown: "# Root\nroot body",
    },
    {
      heading: "Child",
      headingPath: ["Root", "Child"],
      startLine: 3,
      endLine: 4,
      markdown: "## Child\nchild body",
    },
  ]);
  assert.equal(sections.every((section) => section.contentHash === contentHash(section.markdown)), true);
});

test("Setext underlines remain paragraph text because section extraction is ATX-only", () => {
  const source = "Title\n=====\n\nBody";
  const sections = extractMarkdownSections(source);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "");
  assert.deepEqual(sections[0].headingPath, []);
  assert.equal(sections[0].markdown, source);
});

test("section extraction attaches a blank-only leading preamble to the first ATX section", () => {
  const source = "\n\n# Root\nbody\n## Child\nchild body";
  const sections = extractMarkdownSections(source);

  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, "Root");
  assert.deepEqual(sections[0].headingPath, ["Root"]);
  assert.equal(sections[0].startLine, 1);
  assert.equal(sections[0].endLine, 4);
  assert.equal(sections[0].markdown, "\n\n# Root\nbody");
});

test("chunking never emits a blank-only leading preamble chunk", () => {
  const source = [
    "",
    "",
    "# Root",
    "",
    ...Array.from({ length: 20 }, (_, i) => `body line ${i}`),
  ].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 60, overlapLines: 1 });

  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.every((chunk) => chunk.markdown.trim().length > 0), true);
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

test("line-window sizing performs bounded byte-encoding work", () => {
  const source = Array.from({ length: 1_000 }, (_, i) => `line-${i.toString().padStart(4, "0")}`).join("\n");
  const originalEncode = TextEncoder.prototype.encode;
  let encodedCharacters = 0;
  TextEncoder.prototype.encode = function(input = ""): Uint8Array {
    encodedCharacters += input.length;
    return originalEncode.call(this, input);
  };

  let chunks: ReturnType<typeof chunkMarkdownSource>;
  try {
    chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 500, overlapLines: 1 });
  } finally {
    TextEncoder.prototype.encode = originalEncode;
  }

  assert.ok(chunks.length > 1);
  assert.ok(
    encodedCharacters <= source.length * 8,
    `encoded ${encodedCharacters} characters for ${source.length} source characters`,
  );
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("overlap that cannot preserve progress is rejected clearly", () => {
  const source = Array.from({ length: 6 }, (_, i) => `${i}:${"x".repeat(18)}`).join("\n");
  assert.throws(
    () => chunkMarkdownSource(source, { maxEstimatedTokens: 41, overlapLines: 2 }),
    /overlapLines 2 prevents progress after source range 1-2/i,
  );
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
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /markdown does not match source range/i);
});

test("coverage validation rejects markdown and hash tampered together", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].markdown = "one\nchanged";
  chunks[0].contentHash = contentHash(chunks[0].markdown);
  chunks[0].id = `0:1-2:${chunks[0].contentHash}`;

  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    /markdown does not match source range 1-2/i,
  );
});

test("coverage validation rejects a missing synthetic fence wrapper", () => {
  const sourceLines = [
    "```rust",
    ...Array.from({ length: 16 }, (_, i) => `let value_${i} = ${i};`),
    "```",
  ];
  const source = sourceLines.join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 80, overlapLines: 1 });
  const wrapped = chunks.find((chunk) => chunk.startLine > 1 && chunk.endLine < sourceLines.length);
  assert.ok(wrapped);
  wrapped.markdown = sourceLines.slice(wrapped.startLine - 1, wrapped.endLine).join("\n");

  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    new RegExp(`markdown does not match source range ${wrapped.startLine}-${wrapped.endLine}`, "i"),
  );
});

test("coverage validation rejects an altered synthetic fence wrapper", () => {
  const sourceLines = [
    "```rust",
    ...Array.from({ length: 16 }, (_, i) => `let value_${i} = ${i};`),
    "```",
  ];
  const source = sourceLines.join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 80, overlapLines: 1 });
  const wrapped = chunks.find((chunk) => chunk.startLine > 1 && chunk.endLine < sourceLines.length);
  assert.ok(wrapped);
  wrapped.markdown = wrapped.markdown.replace("```rust", "```text");

  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    new RegExp(`markdown does not match source range ${wrapped.startLine}-${wrapped.endLine}`, "i"),
  );
});

test("coverage validation rejects a stale range even when overlap keeps full coverage", () => {
  const source = Array.from({ length: 12 }, (_, i) => `line ${i} ${"x".repeat(12)}`).join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 70, overlapLines: 2 });
  const stale = chunks[1];
  stale.startLine += 1;
  stale.id = `${stale.ordinal}:${stale.startLine}-${stale.endLine}:${stale.contentHash}`;

  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    new RegExp(`markdown does not match source range ${stale.startLine}-${stale.endLine}`, "i"),
  );
});

test("coverage validation rejects an ordinal that differs from array position", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].ordinal = 1;
  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    /ordinal 1.*array position 0/i,
  );
});

test("coverage validation rejects a hash not derived from the source slice", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].contentHash = contentHash("different");
  chunks[0].id = `0:1-2:${chunks[0].contentHash}`;
  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    /content hash.*source range 1-2/i,
  );
});

test("coverage validation rejects an ID that differs from ordinal, range, and hash", () => {
  const source = "one\ntwo";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].id = "wrong";
  assert.throws(
    () => assertCompleteSourceCoverage(source, chunks),
    /id wrong.*expected 0:1-2:fnv1a:/i,
  );
});

test("coverage validation accepts intentional overlapping ranges", () => {
  const source = Array.from({ length: 10 }, (_, i) => `line ${i} ${"x".repeat(10)}`).join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 70, overlapLines: 2 });
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
  chunks[0].contentHash = contentHash("changed");
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /hash/i);
});
