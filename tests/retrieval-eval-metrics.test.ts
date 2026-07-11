import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreGoldRanking,
  validateGoldSet,
  type GoldSet,
} from "../src/retrieval-eval-metrics";

const queryIds = ["q1", "q2"];
const knownPaths = new Set(["a.md", "b.md", "c.md", "d.md"]);
const sourceRelPath = "source/a.md";

test("scoreGoldRanking computes recall, ndcg, and mrr", () => {
  const metrics = scoreGoldRanking(
    [
      { path: "a.md", sourceRelPath, grade: 3, rationale: "primary" },
      { path: "b.md", sourceRelPath: "source/b.md", grade: 2, rationale: "direct" },
      { path: "c.md", sourceRelPath: "source/c.md", grade: 1, rationale: "supporting" },
    ],
    ["x.md", "b.md", "a.md", "z.md", "c.md"],
    5,
  );

  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.mrr, 0.5);
  assert.ok(metrics.ndcgAtK > 0.6 && metrics.ndcgAtK < 1);
});

test("validateGoldSet rejects unknown query ids", () => {
  const gold: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { missing: { relevant: [{ path: "a.md", sourceRelPath, grade: 3, rationale: "x" }] } },
  };

  assert.throws(() => validateGoldSet(gold, queryIds, knownPaths), /unknown query/);
});

test("validateGoldSet rejects duplicate and missing paths", () => {
  const duplicate: GoldSet = {
    version: 1,
    source: "fixture",
    queries: {
      q1: { relevant: [
        { path: "a.md", sourceRelPath, grade: 3, rationale: "x" },
        { path: "a.md", sourceRelPath: "source/b.md", grade: 2, rationale: "y" },
      ] },
      q2: { relevant: [{ path: "b.md", sourceRelPath: "source/c.md", grade: 1, rationale: "z" }] },
    },
  };
  assert.throws(() => validateGoldSet(duplicate, queryIds, knownPaths), /duplicate/);

  const missingPath: GoldSet = {
    version: 1,
    source: "fixture",
    queries: {
      q1: { relevant: [{ path: "missing.md", sourceRelPath, grade: 3, rationale: "x" }] },
      q2: { relevant: [{ path: "b.md", sourceRelPath: "source/c.md", grade: 1, rationale: "z" }] },
    },
  };
  assert.throws(() => validateGoldSet(missingPath, queryIds, knownPaths), /not present/);
});

test("validateGoldSet requires every query to have labels", () => {
  const gold: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { q1: { relevant: [{ path: "a.md", sourceRelPath, grade: 3, rationale: "x" }] } },
  };

  assert.throws(() => validateGoldSet(gold, queryIds, knownPaths), /missing gold labels/);
});

test("validateGoldSet rejects unknown source paths when provided", () => {
  const gold: GoldSet = {
    version: 1,
    source: "fixture",
    queries: {
      q1: { relevant: [{ path: "a.md", sourceRelPath: "missing.md", grade: 3, rationale: "x" }] },
      q2: { relevant: [{ path: "b.md", sourceRelPath: "source/b.md", grade: 1, rationale: "z" }] },
    },
  };

  assert.throws(
    () => validateGoldSet(gold, queryIds, knownPaths, new Set(["source/a.md", "source/b.md"])),
    /sourceRelPath not present/,
  );
});
