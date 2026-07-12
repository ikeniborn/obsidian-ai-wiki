import assert from "node:assert/strict";
import test from "node:test";
import {
  fuseLexicalRanks,
  rankLexicalChunks,
  rankLexicalPages,
  scoreLexicalChunk,
  scoreLexicalPage,
  tokenizeLexical,
} from "../src/lexical-retrieval";

test("tokenizeLexical keeps technical short alphanumeric tokens", () => {
  assert.deepEqual([...tokenizeLexical("Какие HLD for S3 и ClickHouse?")].sort(), ["clickhouse", "hld", "s3"]);
});

test("page title and path outrank generic body-only overlap", () => {
  const query = tokenizeLexical("экспорт s3 clickhouse");
  const titleHit = scoreLexicalPage(query, {
    id: "export-s3-clickhouse",
    path: "!Wiki/hld/pages/export-s3-clickhouse.md",
    title: "Export S3 ClickHouse",
    description: "Краткое описание.",
  });
  const bodyOnly = scoreLexicalPage(query, {
    id: "generic",
    path: "!Wiki/hld/pages/generic.md",
    title: "Generic",
    description: "экспорт s3 clickhouse " + "шаблон ".repeat(120),
  });
  assert.ok(titleHit.score > bodyOnly.score);
  assert.ok(titleHit.evidence.title > 0);
  assert.ok(titleHit.evidence.path > 0);
});

test("chunk heading boost outranks body-only overlap", () => {
  const query = tokenizeLexical("airflow балансировка");
  const headed = scoreLexicalChunk(query, {
    articleId: "airflow",
    path: "!Wiki/hld/pages/airflow.md",
    heading: "## Airflow балансировка",
    body: "Краткое решение.",
  });
  const bodyOnly = scoreLexicalChunk(query, {
    articleId: "generic",
    path: "!Wiki/hld/pages/generic.md",
    heading: "## Notes",
    body: "airflow балансировка " + "описание ".repeat(120),
  });
  assert.ok(headed.score > bodyOnly.score);
  assert.ok(headed.evidence.heading > 0);
});

test("length normalization prevents large template text from dominating", () => {
  const query = tokenizeLexical("компоненты ответственность");
  const compact = scoreLexicalChunk(query, {
    articleId: "owner",
    path: "!Wiki/hld/pages/owner.md",
    heading: "## Компоненты",
    body: "зоны ответственности проектов",
  });
  const template = scoreLexicalChunk(query, {
    articleId: "template",
    path: "!Wiki/hld/pages/template.md",
    heading: "## Template",
    body: "компоненты ответственность " + "типовой раздел ".repeat(240),
  });
  assert.ok(compact.score > template.score);
});

test("lexical page and chunk scores ignore boilerplate paths", () => {
  const query = tokenizeLexical("компоненты ответственность");
  const ownerPage = scoreLexicalPage(query, {
    id: "owner",
    path: "!Wiki/hld/pages/owner.md",
    title: "Owner",
    description: "компоненты ответственность",
  });
  const templatePage = scoreLexicalPage(query, {
    id: "template-readme",
    path: "!Wiki/hld/pages/template-readme.md",
    title: "Template README",
    description: "компоненты ответственность",
  });

  assert.equal(ownerPage.score, templatePage.score);

  const ownerChunk = scoreLexicalChunk(query, {
    articleId: "owner",
    path: "!Wiki/hld/pages/owner.md",
    heading: "## Компоненты",
    body: "ответственность",
  });
  const templateChunk = scoreLexicalChunk(query, {
    articleId: "template-hld-v2-standard",
    path: "!Wiki/hld/pages/template-hld-v2-standard.md",
    heading: "## Компоненты",
    body: "ответственность",
  });

  assert.equal(ownerChunk.score, templateChunk.score);
});

test("rankLexicalPages and rankLexicalChunks are deterministic", () => {
  const query = tokenizeLexical("миграция gitflame");
  const pages = rankLexicalPages(query, [
    { id: "b", path: "!Wiki/hld/pages/b.md", title: "GitFlame", description: "миграция" },
    { id: "a", path: "!Wiki/hld/pages/a.md", title: "GitFlame", description: "миграция" },
  ], 2);
  assert.deepEqual(pages.map((page) => page.id), ["a", "b"]);

  const chunks = rankLexicalChunks(query, [
    { articleId: "b", path: "!Wiki/hld/pages/b.md", heading: "## GitFlame", body: "миграция", ordinal: 1 },
    { articleId: "a", path: "!Wiki/hld/pages/a.md", heading: "## GitFlame", body: "миграция", ordinal: 1 },
  ], 2);
  assert.deepEqual(chunks.map((chunk) => chunk.articleId), ["a", "b"]);
});

test("fuseLexicalRanks promotes a page present in both page and chunk ranks", () => {
  const fused = fuseLexicalRanks(
    [{ id: "page-a", score: 0.9 }, { id: "page-b", score: 0.8 }],
    [{ articleId: "page-b", score: 0.95 }, { articleId: "page-c", score: 0.7 }],
    3,
    10,
  );
  assert.equal(fused[0].id, "page-b");
});

test("fuseLexicalRanks counts each page once per rank source", () => {
  const fused = fuseLexicalRanks(
    [{ id: "page-a", score: 0.9 }, { id: "page-b", score: 0.8 }],
    [
      { articleId: "page-c", score: 0.99 },
      { articleId: "page-c", score: 0.98 },
      { articleId: "page-c", score: 0.97 },
      { articleId: "page-b", score: 0.7 },
    ],
    3,
    10,
  );
  assert.equal(fused[0].id, "page-b");
});

test("empty query returns zero scores and empty ranks", () => {
  const empty = tokenizeLexical("и или для");
  assert.equal(scoreLexicalPage(empty, { id: "x", description: "anything" }).score, 0);
  assert.deepEqual(rankLexicalPages(empty, [{ id: "x", description: "anything" }], 5), []);
  assert.deepEqual(rankLexicalChunks(empty, [{ articleId: "x", path: "x.md", body: "anything" }], 5), []);
});
