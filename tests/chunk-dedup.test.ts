import assert from "node:assert/strict";
import test from "node:test";
import { dedupeChunks, normalizeChunkKey } from "../src/chunk-dedup";
import type { SelectedChunk } from "../src/page-similarity";

function chunk(over: Partial<SelectedChunk>): SelectedChunk {
  return {
    articleId: "a", path: "!Wiki/d/a.md", heading: "## H", body: "text",
    score: 0.5, source: "seed", ordinal: 0, ...over,
  };
}

test("dedupeChunks removes an exact duplicate and keeps the highest score", () => {
  const input = [
    chunk({ articleId: "a", heading: "## H", body: "same body", score: 0.4 }),
    chunk({ articleId: "b", heading: "## H", body: "same body", score: 0.9 }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 1);
  assert.equal(dropped, 1);
  assert.equal(chunks[0].articleId, "b");
  assert.equal(chunks[0].score, 0.9);
});

test("dedupeChunks treats whitespace/case differences as the same chunk", () => {
  const input = [
    chunk({ articleId: "a", heading: "## Title", body: "Hello   World", score: 0.4 }),
    chunk({ articleId: "b", heading: "##  title", body: "hello world", score: 0.6 }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 1);
  assert.equal(dropped, 1);
  assert.equal(chunks[0].articleId, "b");
});

test("dedupeChunks preserves first-seen order among kept chunks", () => {
  const input = [
    chunk({ articleId: "x", heading: "## A", body: "one", score: 0.3 }),
    chunk({ articleId: "y", heading: "## B", body: "two", score: 0.3 }),
    chunk({ articleId: "x2", heading: "## A", body: "one", score: 0.9 }),
  ];
  const { chunks } = dedupeChunks(input);
  assert.deepEqual(chunks.map((c) => c.heading), ["## A", "## B"]);
  assert.equal(chunks[0].articleId, "x2"); // higher score wins for key "## A"
});

test("dedupeChunks leaves distinct chunks untouched", () => {
  const input = [
    chunk({ articleId: "a", heading: "## A", body: "one" }),
    chunk({ articleId: "b", heading: "## B", body: "two" }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 2);
  assert.equal(dropped, 0);
});

test("normalizeChunkKey collapses whitespace and lowercases", () => {
  assert.equal(normalizeChunkKey("##  Foo", "A\n B  C"), normalizeChunkKey("## foo", "a b c"));
});

test("dedupeChunks handles an empty list", () => {
  const { chunks, dropped } = dedupeChunks([]);
  assert.deepEqual(chunks, []);
  assert.equal(dropped, 0);
});
