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
    expect(r[0]).toHaveProperty("id");
    expect(r[0]).toHaveProperty("score");
  });

  it("filters by minScore", () => {
    const r = selectSeeds("alpha", pages, 10, 0.5);
    expect(r.map(x => x.id)).toContain("Alpha");
    expect(r.map(x => x.id)).not.toContain("Beta");
  });

  it("sorts by score descending", () => {
    const r = selectSeeds("alpha gamma neural", pages, 10, 0);
    expect(r[0].id).toBe("Gamma");
  });

  it("returns [] when nothing passes threshold", () => {
    expect(selectSeeds("xyz", pages, 10, 0.5)).toEqual([]);
  });

  it("matches content-only references (not in pageId)", () => {
    const r = selectSeeds("neural network", pages, 10, 0);
    expect(r.map(x => x.id)).toContain("Gamma");
  });

  it("caps content tokenization to first 500 chars", () => {
    const big = new Map([["wiki/Big.md", "irrelevant ".repeat(50) + "needle"]]);
    expect(selectSeeds("needle", big, 10, 0)).toEqual([]);
  });
});

describe("bodyContent (internal via scoreSeed)", () => {
  it("skips YAML frontmatter and reads body", () => {
    const q = tokenize("deepseek модель");
    const content = "---\nwiki_sources: []\nwiki_updated: 2026-05-01\n---\nDeepSeek языковая модель.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when keyword is only in frontmatter YAML", () => {
    const q = tokenize("wiki_sources");
    const content = "---\nwiki_sources: [note.md]\n---\nBody text here.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBe(0);
  });
});

describe("parseFmKeywords (internal via scoreSeed)", () => {
  it("boosts score via wiki_keywords in frontmatter", () => {
    const q = tokenize("deepseek инференс");
    const content = "---\nwiki_keywords: [deepseek, инференс, облако]\n---\n# Page\nКонтент.";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });

  it("is case-insensitive for wiki_keywords", () => {
    const q = tokenize("DeepSeek");
    const content = "---\nwiki_keywords: [deepseek]\n---\n# Page";
    const score = scoreSeed(q, "Other", content);
    expect(score).toBeGreaterThan(0);
  });
});

describe("scoreSeed with annotation", () => {
  it("uses annotation text for scoring", () => {
    const q = tokenize("кластеризация данных");
    const content = "---\n---\n# Clustering\nAlgorithm.";
    const score = scoreSeed(q, "Clustering", content, "алгоритм кластеризации данных без учителя");
    expect(score).toBeGreaterThan(0);
  });

  it("without annotation behaves same as before for non-frontmatter content", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "alpha", "beta")).toBeCloseTo(1, 5);
  });
});

describe("selectSeeds with indexAnnotations", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "# Alpha\nalpha content here"],
    ["wiki/Beta.md", "# Beta\nbeta unrelated"],
  ]);

  it("uses annotation from indexAnnotations map", () => {
    const annotations = new Map([["Alpha", "альфа-частица физика ядро"]]);
    const r = selectSeeds("альфа физика", pages, 10, 0.1, annotations);
    expect(r.map(x => x.id)).toContain("Alpha");
  });

  it("works without indexAnnotations (backward compat)", () => {
    const r = selectSeeds("alpha content", pages, 10, 0);
    expect(r.map(x => x.id)).toContain("Alpha");
  });
});
