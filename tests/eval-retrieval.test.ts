import { describe, it, expect } from "vitest";
import { makeRunner, type RunInputs } from "../scripts/eval-retrieval";
import { buildWikiGraph, bfsExpandRanked, pageId } from "../src/wiki-graph";
import { fuseVectorGraph } from "../src/fusion";
import { PageSimilarityService } from "../src/page-similarity";
import type { FsShim } from "../scripts/eval-vault";

// fs shim: only `read` is called (loadCache returns early with no model endpoint);
// `write` is typed but never called on this path.
const fs: FsShim = { read: async () => "", write: async () => undefined } as unknown as FsShim;

const wikiVaultPath = "!Wiki/work";

// Query with 10 distinct tokens (each ≥ 3 chars so they pass the tokenize length filter).
const q = "alpha beta gamma delta epsilon zeta theta iota kappa lambda";

// Three seeds cover 10, 8, 6 tokens of the query (scores 1.0, 0.8, 0.6).
// Three BFS non-seeds form a chain S1→L→H→M:
//   L (hop 1, score 0.1) — close to seed, low similarity
//   H (hop 2, score 0.4) — farther from seed, highest non-seed similarity
//   M (hop 3, score 0.2) — furthest, middle similarity
// Vector order of non-seeds: H, M, L  (score desc)
// Graph order of non-seeds: L, H, M   (hop asc)
// These are a 3-cycle permutation (not a 2-element swap), so RRF resolves them
// to H, L, M — different from the unfused Set order H, M, L. That proves fusion ran.
const annotations = new Map<string, string>([
  ["S1", "alpha beta gamma delta epsilon zeta theta iota kappa lambda"],
  ["S2", "alpha beta gamma delta epsilon zeta theta iota"],
  ["S3", "alpha beta gamma delta epsilon zeta"],
  ["H", "alpha beta gamma delta"],
  ["M", "gamma delta"],
  ["L", "epsilon"],
]);

const pages = new Map<string, string>([
  ["!Wiki/work/S1.md", "# S1\n[[L]]\nalpha beta gamma delta epsilon zeta theta iota kappa lambda"],
  ["!Wiki/work/S2.md", "# S2\nalpha beta gamma delta epsilon zeta theta iota"],
  ["!Wiki/work/S3.md", "# S3\nalpha beta gamma delta epsilon zeta"],
  ["!Wiki/work/L.md", "# L\n[[H]]\nepsilon"],
  ["!Wiki/work/H.md", "# H\n[[M]]\nalpha beta gamma delta"],
  ["!Wiki/work/M.md", "# M\ngamma delta"],
]);

function inputs(): RunInputs {
  return {
    wikiVaultPath, fs, annotations,
    allAnnotatedPaths: [...annotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`),
    pages, graph: buildWikiGraph(pages), embed: {},
  };
}

describe("makeRunner — dense+rrf", () => {
  // @lat: [[tests#Tier 2 — Query Fusion#Eval runner applies the fused order]]
  it("returns the fuseVectorGraph order over the union", async () => {
    const inp = inputs();
    const topK = 3, depth = 3;

    // Mirror the runner's pre-fusion steps with the same public calls.
    const svc = new PageSimilarityService({ mode: "embedding", topK });
    const scored = await svc.selectRelevantScored(q, annotations, inp.allAnnotatedPaths);
    const top = scored.slice(0, topK);
    const seeds = top.map((x) => pageId(x.path));
    const seedScores = Object.fromEntries(top.map((x) => [pageId(x.path), x.score]));
    const { selectedIds, expandedScores } = await bfsExpandRanked(
      seeds, inp.graph, depth, pages, q, 10, annotations, svc,
    );
    const oracle = fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, inp.graph, depth, 60);

    // Precondition: the chosen data genuinely reorders (else fusion is untested here).
    expect(oracle).not.toEqual([...selectedIds]);

    const fused = await (await makeRunner(
      { name: "dense+rrf", mode: "embedding", bfsDepth: depth, topK, fuse: true }, inp,
    ))(q);
    expect(fused.union).toEqual(oracle);
  });
});
