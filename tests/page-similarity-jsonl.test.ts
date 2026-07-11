import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHUNKING, PageSimilarityService } from "../src/page-similarity";
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

test("jaccard chunk fallback prefers heading and path evidence", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/airflow-ha.md", "# Airflow\n\n## Балансировка Airflow\nРешение через active-active."],
    ["!Wiki/hld/pages/generic.md", "# Generic\n\n## X\nairflow балансировка"],
  ]);
  const ids = new Set(["airflow-ha", "generic"]);
  const service = new PageSimilarityService({ mode: "jaccard", topK: 2, chunking: DEFAULT_CHUNKING });

  const chunks = await service.selectRelevantChunks(
    "airflow балансировка",
    pages,
    ids,
    ids,
    { "airflow-ha": 1, generic: 1 },
    2,
  );

  assert.equal(chunks[0].articleId, "airflow-ha");
  assert.equal(chunks[0].heading, "## Балансировка Airflow");
});

test("jaccard chunk fallback applies boilerplate demotion config", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/template-readme.md", "# Template\n\n## Компоненты\nзоны ответственности проектов"],
    ["!Wiki/hld/pages/owner.md", "# Owner\n\n## Компоненты\nзоны ответственности проектов"],
  ]);
  const ids = new Set(["template-readme", "owner"]);
  const service = new PageSimilarityService({
    mode: "jaccard",
    topK: 2,
    chunking: DEFAULT_CHUNKING,
    boilerplateDemotion: { enabled: true, factor: 0.15 },
  });

  const chunks = await service.selectRelevantChunks(
    "компоненты ответственность",
    pages,
    ids,
    ids,
    { "template-readme": 1, owner: 1 },
    2,
  );

  assert.equal(chunks[0].articleId, "owner");
  const owner = chunks.find((chunk) => chunk.articleId === "owner");
  const template = chunks.find((chunk) => chunk.articleId === "template-readme");
  assert.ok(owner && template);
  assert.ok(template.score < owner.score);
});

test("hybrid sparse side uses weighted lexical page score", async () => {
  const service = new PageSimilarityService({ mode: "hybrid", topK: 2 });
  const scored = await service.selectRelevantScored(
    "экспорт s3 clickhouse",
    new Map([
      ["export-s3-clickhouse", "Краткое описание."],
      ["generic", "экспорт s3 clickhouse " + "шаблон ".repeat(120)],
    ]),
    ["!Wiki/hld/pages/export-s3-clickhouse.md", "!Wiki/hld/pages/generic.md"],
  );

  assert.equal(scored[0].path, "!Wiki/hld/pages/export-s3-clickhouse.md");
});
