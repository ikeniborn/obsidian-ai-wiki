import { describe, it, expect } from "vitest";
import { pageId, buildWikiGraph, bfsExpand, checkGraphStructure } from "../src/wiki-graph";

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
});

describe("checkGraphStructure", () => {
  it("detects isolated node (no in or out)", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
      ["Orphan", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).toContain("Orphan: isolated node");
    expect(result).not.toContain("A: isolated");
  });

  it("detects hub node (outDegree > threshold)", () => {
    const targets = new Set(["B","C","D","E","F"]);
    const graph = new Map([
      ["Hub", targets],
      ...([...targets].map((t) => [t, new Set<string>()] as [string, Set<string>])),
    ]);
    const result = checkGraphStructure(graph, 4);
    expect(result).toContain("Hub: hub node (5 outgoing links)");
  });

  it("detects unidirectional link A→B where B exists but has no edge to A", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).toContain("A → [[B]] not reciprocated");
  });

  it("does NOT flag bidirectional link as unidirectional", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const result = checkGraphStructure(graph, 20);
    expect(result).not.toContain("not reciprocated");
  });

  it("does NOT flag dangling link (target not in graph) as unidirectional", () => {
    const graph = new Map([["A", new Set(["Ghost"])]]);
    const result = checkGraphStructure(graph, 20);
    expect(result).not.toContain("not reciprocated");
  });

  it("returns empty string when no issues", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(checkGraphStructure(graph, 20)).toBe("");
  });
});
