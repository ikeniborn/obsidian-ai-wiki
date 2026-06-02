import { describe, it, expect, vi } from "vitest";
import { pageId, buildWikiGraph, bfsExpand, bfsExpandWithHops, checkGraphStructure, bfsExpandRanked } from "../src/wiki-graph";
import type { PageSimilarityService } from "../src/page-similarity";

describe("pageId", () => {
  it("strips path prefix and .md suffix", () => {
    expect(pageId("!Wiki/ai/ИИ-агент.md")).toBe("ИИ-агент");
  });
  it("handles bare filename", () => {
    expect(pageId("Page.md")).toBe("Page");
  });
  it("handles no extension", () => {
    expect(pageId("NoExt")).toBe("NoExt");
  });
});

describe("buildWikiGraph", () => {
  it("builds edges from [[links]]", () => {
    const pages = new Map([
      ["!Wiki/A.md", "# A\n[[B]] and [[C]]"],
      ["!Wiki/B.md", "# B\n[[A]]"],
      ["!Wiki/C.md", "# C\nNo links."],
    ]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("A")).toEqual(new Set(["B", "C"]));
    expect(graph.get("B")).toEqual(new Set(["A"]));
    expect(graph.get("C")).toEqual(new Set());
  });

  it("ignores aliases and headings in links: [[Page|alias]] → Page, [[Page#heading]] → Page", () => {
    const pages = new Map([
      ["!Wiki/X.md", "[[Y|alias]] [[Z#section]]"],
      ["!Wiki/Y.md", ""],
      ["!Wiki/Z.md", ""],
    ]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("X")).toEqual(new Set(["Y", "Z"]));
  });

  it("dangling links (target not in pages) are stored as targets", () => {
    const pages = new Map([["!Wiki/A.md", "[[Ghost]]"]]);
    const graph = buildWikiGraph(pages);
    expect(graph.get("A")).toEqual(new Set(["Ghost"]));
    expect(graph.has("Ghost")).toBe(false);
  });
});

describe("bfsExpand", () => {
  // Graph: A → B → C → D, E isolated
  const graph = new Map([
    ["A", new Set(["B"])],
    ["B", new Set(["C"])],
    ["C", new Set(["D"])],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  it("depth=0 returns only seeds", () => {
    expect(bfsExpand(["A"], graph, 0)).toEqual(new Set(["A"]));
  });

  it("depth=1 returns seeds + direct neighbors (both directions)", () => {
    // undirected: B→A (reverse) and B→C (forward)
    const result = bfsExpand(["B"], graph, 1);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("depth=2 expands two hops", () => {
    const result = bfsExpand(["B"], graph, 2);
    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("does not include isolated nodes not reachable from seeds", () => {
    const result = bfsExpand(["A"], graph, 3);
    expect(result.has("E")).toBe(false);
  });

  it("handles empty seeds", () => {
    expect(bfsExpand([], graph, 2)).toEqual(new Set());
  });

  it("handles seed not in graph", () => {
    expect(bfsExpand(["Unknown"], graph, 1)).toEqual(new Set(["Unknown"]));
  });

  it("does not include phantom nodes (dangling links with no graph key) in BFS results", () => {
    // A links to Ghost which has no graph entry
    const graph = new Map([
      ["A", new Set(["B", "Ghost"])],
      ["B", new Set<string>()],
    ]);
    const result = bfsExpand(["A"], graph, 1);
    expect(result.has("Ghost")).toBe(false);
    expect(result.has("B")).toBe(true);
  });
});

describe("bfsExpandWithHops", () => {
  // Graph: A → B → C → D, E isolated
  const graph = new Map([
    ["A", new Set(["B"])],
    ["B", new Set(["C"])],
    ["C", new Set(["D"])],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  it("depth=0 returns only seeds in hop 0, byHop empty", () => {
    const { expanded, byHop } = bfsExpandWithHops(["A"], graph, 0);
    expect(expanded).toEqual(new Set(["A"]));
    expect(Object.keys(byHop)).toHaveLength(0);
  });

  it("depth=1 attributes direct neighbors to hop 1", () => {
    const { expanded, byHop } = bfsExpandWithHops(["B"], graph, 1);
    // B is seed, A and C are hop 1 (undirected)
    expect(expanded).toEqual(new Set(["A", "B", "C"]));
    expect(byHop[1]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(byHop[1]).toHaveLength(2);
  });

  it("depth=2 attributes second-level neighbors to hop 2", () => {
    const { expanded, byHop } = bfsExpandWithHops(["B"], graph, 2);
    expect(byHop[1]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(byHop[2]).toEqual(expect.arrayContaining(["D"]));
  });

  it("returns empty expanded and empty byHop for empty seeds", () => {
    const { expanded, byHop } = bfsExpandWithHops([], graph, 2);
    expect(expanded).toEqual(new Set());
    expect(byHop).toEqual({});
  });

  it("handles seed not in graph", () => {
    const { expanded, byHop } = bfsExpandWithHops(["Unknown"], graph, 1);
    expect(expanded).toEqual(new Set(["Unknown"]));
    expect(byHop).toEqual({});
  });

  it("does not include isolated nodes not reachable from seeds", () => {
    const { expanded } = bfsExpandWithHops(["A"], graph, 3);
    expect(expanded.has("E")).toBe(false);
  });

  it("does not include phantom nodes (dangling links with no graph key) in expanded or byHop", () => {
    // A links to Ghost which has no graph entry
    const graph = new Map([
      ["A", new Set(["B", "Ghost"])],
      ["B", new Set<string>()],
    ]);
    const { expanded, byHop } = bfsExpandWithHops(["A"], graph, 1);
    expect(expanded.has("Ghost")).toBe(false);
    expect(byHop[1]).not.toContain("Ghost");
    expect(expanded.has("B")).toBe(true);
  });
});

describe("checkGraphStructure", () => {
  it("detects isolated node (no in or out)", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
      ["Orphan", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).toContain("Orphan: isolated node");
    expect(result).not.toContain("A: isolated");
  });

  it("detects unidirectional link A→B where B exists but has no edge to A", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).toContain("A → [[B]] not reciprocated");
  });

  it("does NOT flag bidirectional link as unidirectional", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).not.toContain("not reciprocated");
  });

  it("does NOT flag dangling link (target not in graph) as unidirectional", () => {
    const graph = new Map([["A", new Set(["Ghost"])]]);
    const result = checkGraphStructure(graph);
    expect(result).not.toContain("not reciprocated");
  });

  it("returns empty string when no issues", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(checkGraphStructure(graph)).toBe("");
  });
});

describe("bfsExpandRanked", () => {
  // A connects to B, C, D, E (all undirected via reverse edges)
  const graph = new Map<string, Set<string>>([
    ["A", new Set(["B", "C", "D", "E"])],
    ["B", new Set<string>()],
    ["C", new Set<string>()],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  // vaultPath → content; pageId("vault/X.md") === "X"
  const pages = new Map([
    ["vault/A.md", "apple ant armor"],
    ["vault/B.md", "banana bread bake"],
    ["vault/C.md", "cat cup cake"],
    ["vault/D.md", "dog door dial"],
    ["vault/E.md", "egg ear extra"],
  ]);

  it("seeds always included even when bfsTopK=1 and many BFS pages exist", async () => {
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "apple", 1);
    expect(result.has("A")).toBe(true);
  });

  it("bfsTopK=0 returns all BFS pages", async () => {
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "query", 0);
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });

  it("Jaccard fallback: page with higher overlap score included over lower-scored page at bfsTopK=1", async () => {
    // query "cat cup" overlaps with C="cat cup cake" but not B="banana bread bake"
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "cat cup", 1);
    expect(result.has("A")).toBe(true);   // seed always included
    expect(result.has("C")).toBe(true);   // highest overlap
    expect(result.has("B")).toBe(false);  // no overlap
  });

  it("embedding path: mock similarity results are respected", async () => {
    const mockSimilarity = {
      selectRelevantScored: vi.fn().mockResolvedValue([
        { path: "vault/D.md", score: 0.9 },
        { path: "vault/B.md", score: 0.8 },
      ]),
    } as unknown as PageSimilarityService;

    const result = await bfsExpandRanked(
      ["A"], graph, 1, pages, "test query", 2,
      undefined, mockSimilarity,
    );
    expect(result.has("A")).toBe(true);   // seed always included
    expect(result.has("D")).toBe(true);   // rank 1 from mock
    expect(result.has("B")).toBe(true);   // rank 2 from mock
    expect(result.has("C")).toBe(false);  // not in top-2
  });

  it("similarity throws → fallback to full BFS, no exception thrown", async () => {
    const mockSimilarity = {
      selectRelevantScored: vi.fn().mockRejectedValue(new Error("API down")),
    } as unknown as PageSimilarityService;

    const result = await bfsExpandRanked(
      ["A"], graph, 1, pages, "query", 2,
      undefined, mockSimilarity,
    );
    // Full BFS fallback — all reachable pages returned
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });
});
