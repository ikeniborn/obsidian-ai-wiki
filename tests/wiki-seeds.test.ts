import { describe, it, expect } from "vitest";
import { tokenize, scoreSeed, selectSeeds } from "../src/wiki-seeds";

describe("tokenize", () => {
  it("lowercases and splits on non-word", () => {
    expect([...tokenize("Hello, World!")]).toEqual(["hello", "world"]);
  });

  it("drops tokens of length <= 2", () => {
    expect([...tokenize("ab cd efg")]).toEqual(["efg"]);
  });

  it("drops english stop-words", () => {
    expect([...tokenize("the quick brown fox")]).toEqual(["quick", "brown", "fox"]);
  });

  it("drops russian stop-words", () => {
    expect([...tokenize("что такое нейронная сеть")]).toEqual(["такое", "нейронная", "сеть"]);
  });

  it("returns empty set on empty string", () => {
    expect(tokenize("").size).toBe(0);
  });

  it("handles mixed RU + EN", () => {
    const t = tokenize("Машинное обучение neural network");
    expect(t.has("машинное")).toBe(true);
    expect(t.has("neural")).toBe(true);
  });
});

describe("scoreSeed", () => {
  it("returns 1 for identical token sets", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "alpha", "beta")).toBeCloseTo(1, 5);
  });

  it("returns 0 for disjoint sets", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "gamma", "delta")).toBe(0);
  });

  it("is in [0,1] range", () => {
    const q = tokenize("alpha beta gamma");
    const s = scoreSeed(q, "alpha", "delta epsilon");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("returns 0 when question is empty", () => {
    expect(scoreSeed(new Set(), "alpha", "beta")).toBe(0);
  });
});

describe("selectSeeds", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "alpha content here"],
    ["wiki/Beta.md", "beta unrelated"],
    ["wiki/Gamma.md", "gamma neural network details"],
  ]);

  it("respects topK", () => {
    const r = selectSeeds("alpha beta gamma", pages, 1, 0);
    expect(r.length).toBe(1);
  });

  it("filters by minScore", () => {
    const r = selectSeeds("alpha", pages, 10, 0.5);
    expect(r).toContain("Alpha");
    expect(r).not.toContain("Beta");
  });

  it("sorts by score descending", () => {
    const r = selectSeeds("alpha gamma neural", pages, 10, 0);
    expect(r[0]).toBe("Gamma");
  });

  it("returns [] when nothing passes threshold", () => {
    expect(selectSeeds("xyz", pages, 10, 0.5)).toEqual([]);
  });

  it("matches content-only references (not in pageId)", () => {
    const r = selectSeeds("neural network", pages, 10, 0);
    expect(r).toContain("Gamma");
  });

  it("caps content tokenization to first 200 chars", () => {
    const big = new Map([["wiki/Big.md", "irrelevant ".repeat(50) + "needle"]]);
    expect(selectSeeds("needle", big, 10, 0)).toEqual([]);
  });
});
