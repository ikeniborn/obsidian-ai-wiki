import assert from "node:assert/strict";
import test from "node:test";
import { buildBm25Index, rankBm25, tokenizeBm25 } from "../src/bm25";

test("BM25 ranks repeated exact query terms above generic overlap", () => {
  const index = buildBm25Index([
    { id: "generic", text: "экспорт данных общий документ" },
    { id: "s3", text: "экспорт экспорт s3 clickhouse витрина" },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("экспорт s3 clickhouse"), index, 2);

  assert.equal(ranked[0].id, "s3");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("BM25 length normalization prevents long template dominance", () => {
  const index = buildBm25Index([
    { id: "compact", text: "airflow балансировка отказоустойчивая архитектура" },
    { id: "template", text: "airflow балансировка " + "типовой раздел ".repeat(200) },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("airflow балансировка архитектура"), index, 2);

  assert.equal(ranked[0].id, "compact");
});

test("BM25 returns empty rankings for empty query or corpus", () => {
  const index = buildBm25Index([{ id: "a", text: "alpha" }], tokenizeBm25);
  assert.deepEqual(rankBm25([], index, 5), []);
  assert.deepEqual(rankBm25(tokenizeBm25("alpha"), buildBm25Index([], tokenizeBm25), 5), []);
});

test("BM25 tie-breaks deterministically by id", () => {
  const index = buildBm25Index([
    { id: "b", text: "same token" },
    { id: "a", text: "same token" },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("same"), index, 2);

  assert.deepEqual(ranked.map((item) => item.id), ["a", "b"]);
});

test("BM25 treats duplicate query tokens as one term", () => {
  const index = buildBm25Index([
    { id: "a", text: "alpha beta" },
  ], tokenizeBm25);

  const once = rankBm25(["alpha"], index, 1);
  const repeated = rankBm25(["alpha", "alpha", "alpha"], index, 1);

  assert.equal(repeated[0].score, once[0].score);
});
