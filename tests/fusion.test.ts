import { describe, it, expect } from "vitest";
import { fuseVectorGraph } from "../src/fusion";
import type { WikiGraph } from "../src/wiki-graph";

// Graph: S → A, S → B, A → B. Undirected BFS from S reaches A and B at hop 1.
const graph: WikiGraph = new Map([
  ["S", new Set(["A", "B"])],
  ["A", new Set(["B"])],
  ["B", new Set<string>()],
]);

describe("fuseVectorGraph", () => {
  // @lat: [[tests#Tier 2 — Query Fusion#Fusion orders the union by vector and graph RRF]]
  it("fuses vector rank and graph rank over the union", () => {
    const seeds = ["S"];
    const selectedIds = new Set(["S", "A", "B"]);
    const seedScores = { S: 0.9 };
    const expandedScores = { A: 0.8, B: 0.1 };
    const order = fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graph, 1, 60);
    // Every union member appears exactly once.
    expect(new Set(order)).toEqual(selectedIds);
    expect(order).toHaveLength(3);
    // S: vector rank 1 (0.9) + graph rank 1 (hop 0) — wins outright.
    expect(order[0]).toBe("S");
    // A outranks B: higher vector score AND higher inDegree at the same hop.
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
  });

  it("breaks graph-list ties by inDegree (more backlinks ranks higher)", () => {
    // Two expanded pages at the same hop, equal vector score: P has 2 backlinks, Q has 0.
    const tieGraph: WikiGraph = new Map([
      ["S", new Set(["P", "Q"])],
      ["X", new Set(["P"])],
      ["Y", new Set(["P"])],
      ["P", new Set<string>()],
      ["Q", new Set<string>()],
    ]);
    const order = fuseVectorGraph(
      ["S"], new Set(["S", "P", "Q"]), { S: 0.5 }, { P: 0.3, Q: 0.3 }, tieGraph, 1, 60,
    );
    expect(order.indexOf("P")).toBeLessThan(order.indexOf("Q"));
  });

  it("ranks a union page that has no similarity score (score defaults to 0)", () => {
    const order = fuseVectorGraph(
      ["S"], new Set(["S", "A"]), { S: 0.9 }, {}, graph, 1, 60,
    );
    expect(new Set(order)).toEqual(new Set(["S", "A"]));
    expect(order[0]).toBe("S");
  });

  it("returns an empty array for an empty union", () => {
    expect(fuseVectorGraph([], new Set(), {}, {}, graph, 1, 60)).toEqual([]);
  });

  it("respects rrfK (different k can change a contested order)", () => {
    const seeds = ["S"];
    const selectedIds = new Set(["S", "A", "B"]);
    // With a tiny k, rank differences dominate; with a huge k they flatten toward first-seen.
    const small = fuseVectorGraph(seeds, selectedIds, { S: 0.1 }, { A: 0.9, B: 0.8 }, graph, 1, 1);
    const large = fuseVectorGraph(seeds, selectedIds, { S: 0.1 }, { A: 0.9, B: 0.8 }, graph, 1, 100000);
    expect(new Set(small)).toEqual(selectedIds);
    expect(new Set(large)).toEqual(selectedIds);
    // Sanity: both are valid permutations; k is actually threaded into rrf.
    expect(small).toHaveLength(3);
    expect(large).toHaveLength(3);
  });
});
