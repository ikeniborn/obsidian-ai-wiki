import { describe, it, expect } from "vitest";
import { recallAt, mrr } from "../scripts/eval-metrics";

describe("recallAt", () => {
  it("counts gold hits within the top-k window, divided by |gold|", () => {
    // gold = 2 ids, both in top-3 → 1.0
    expect(recallAt(["A", "B", "C"], ["A", "B"], 3)).toBe(1);
    // only A is within top-2 → 0.5
    expect(recallAt(["A", "X", "B"], ["A", "B"], 2)).toBe(0.5);
  });

  it("ignores ranks beyond k", () => {
    expect(recallAt(["X", "Y", "A"], ["A"], 2)).toBe(0);
  });

  it("returns 0 for empty gold", () => {
    expect(recallAt(["A"], [], 3)).toBe(0);
  });
});

describe("mrr", () => {
  it("is the reciprocal of the 1-based rank of the first gold hit", () => {
    expect(mrr(["X", "A", "B"], ["A", "B"])).toBe(1 / 2);
    expect(mrr(["A"], ["A"])).toBe(1);
  });

  it("is 0 when no gold id appears in the ranked list", () => {
    expect(mrr(["X", "Y"], ["A"])).toBe(0);
  });
});

import { averageLayer, K_VALUES } from "../scripts/eval-metrics";

describe("averageLayer", () => {
  it("averages recall per k and mrr across questions", () => {
    const ranked = [
      ["A", "B", "C"], // q1
      ["X", "A", "Y"], // q2
    ];
    const gold = [
      ["A"], // q1: A at rank 1
      ["A"], // q2: A at rank 2
    ];
    const m = averageLayer(ranked, gold, [3]);
    // recall@3: q1 hit (1.0) + q2 hit (1.0) → 1.0
    expect(m.recall[3]).toBe(1);
    // mrr: (1/1 + 1/2) / 2 = 0.75
    expect(m.mrr).toBe(0.75);
  });

  it("exposes the fixed k set [3,5,8]", () => {
    expect([...K_VALUES]).toEqual([3, 5, 8]);
  });

  it("returns zeros for an empty question set", () => {
    const m = averageLayer([], [], [3, 5, 8]);
    expect(m.mrr).toBe(0);
    expect(m.recall[3]).toBe(0);
  });
});
