import assert from "node:assert/strict";
import test from "node:test";
import { chunkRecordToEmbeddingChunk, embeddingChunkToChunkRecord } from "../src/wiki-index-jsonl";

test("embedding chunks convert to index chunk records with vector metadata", () => {
  const record = embeddingChunkToChunkRecord({
    articleId: "a",
    path: "!Wiki/hld/concept/a.md",
    heading: "## Detail",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "nomic",
    dimensions: 2,
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.deepEqual(chunkRecordToEmbeddingChunk(record).vector, [0.1, 0.2]);
});
