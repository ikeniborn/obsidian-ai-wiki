import assert from "node:assert/strict";
import test from "node:test";
import { chunkRecordsToEmbeddingCache } from "../src/wiki-index-jsonl";

test("jsonl index with malformed vector dimensions yields empty cache for embedding fallback", () => {
  const cache = chunkRecordsToEmbeddingCache(
    [{
      kind: "chunk",
      schemaVersion: 1,
      articleId: "a",
      path: "!Wiki/hld/a.md",
      heading: "## A",
      ordinal: 0,
      bodyHash: "b",
      embedTextHash: "h",
      vector: [0.1],
      vectorModel: "nomic",
      dimensions: 1,
      updatedAt: "2026-07-11T00:00:00.000Z",
    }],
    "nomic",
    2,
  );
  assert.deepEqual(cache.entries, {});
});
