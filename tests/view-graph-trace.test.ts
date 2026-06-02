import { describe, it, expect } from "vitest";
import { formatGraphStatsLines } from "../src/view";

describe("formatGraphStatsLines", () => {
  const baseEvent = {
    kind: "graph_stats" as const,
    seeds: ["ArticleA", "ArticleB", "ArticleC"],
    expanded: 7,
    total: 42,
    fromCache: false,
    seedScores: { ArticleA: 0.87, ArticleB: 0.72, ArticleC: 0.41 },
    expandedByHop: { 1: ["ArticleD", "ArticleE"], 2: ["ArticleF", "ArticleG"] },
  };

  it("compact mode: returns single line without scores", () => {
    const lines = formatGraphStatsLines(baseEvent, false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Граф:");
    expect(lines[0]).toContain("3 seeds");
    expect(lines[0]).not.toContain("0.87");
  });

  it("compact mode: truncates seeds to 3 in preview", () => {
    const lines = formatGraphStatsLines(baseEvent, false);
    expect(lines[0]).toContain("ArticleA");
    expect(lines[0]).toContain("ArticleB");
    expect(lines[0]).toContain("ArticleC");
  });

  it("compact mode: shows cache hit hint", () => {
    const cached = { ...baseEvent, fromCache: true };
    const lines = formatGraphStatsLines(cached, false);
    expect(lines[0]).toContain("cache hit");
  });

  it("trace mode: shows scores formatted to 2 decimal places", () => {
    const lines = formatGraphStatsLines(baseEvent, true);
    expect(lines.some(l => l.includes("ArticleA (0.87)"))).toBe(true);
    expect(lines.some(l => l.includes("ArticleB (0.72)"))).toBe(true);
  });

  it("trace mode: truncates seeds to 5 with …+N", () => {
    const many = {
      ...baseEvent,
      seeds: ["A", "B", "C", "D", "E", "F", "G"],
      seedScores: { A: 0.9, B: 0.8, C: 0.7, D: 0.6, E: 0.5, F: 0.4, G: 0.3 },
    };
    const lines = formatGraphStatsLines(many, true);
    expect(lines.some(l => l.includes("…+2"))).toBe(true);
    expect(lines.every(l => !l.includes("(0.40)"))).toBe(true); // F not shown
  });

  it("trace mode: shows BFS hop lines", () => {
    const lines = formatGraphStatsLines(baseEvent, true);
    const bfs1 = lines.findIndex(l => l.includes("BFS +1"));
    const bfs2 = lines.findIndex(l => l.includes("BFS +2"));
    expect(bfs1).toBeGreaterThan(-1);
    expect(bfs2).toBeGreaterThan(-1);
    expect(lines[bfs1 + 1]).toContain("ArticleD");
    expect(lines[bfs2 + 1]).toContain("ArticleF");
  });

  it("trace mode: omits BFS lines when expandedByHop is empty", () => {
    const noHops = { ...baseEvent, expandedByHop: {} };
    const lines = formatGraphStatsLines(noHops, true);
    expect(lines.every(l => !l.includes("BFS"))).toBe(true);
  });

  it("trace mode: omits seeds with score 0.00", () => {
    const zeroScore = {
      ...baseEvent,
      seeds: ["ArticleA", "ArticleZ"],
      seedScores: { ArticleA: 0.87, ArticleZ: 0 },
      expandedByHop: {},
    };
    const lines = formatGraphStatsLines(zeroScore, true);
    // ArticleZ with score 0 should not appear as "(0.00)"
    expect(lines[0]).not.toContain("(0.00)");
  });
});
