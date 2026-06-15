// tests/rrf.test.ts
import { describe, it, expect } from "vitest";
import { rrf } from "../src/rrf";

describe("rrf", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#RRF fuses ranked lists by reciprocal rank]]
  it("fuses two lists; an item ranked high in both wins", () => {
    const dense = ["A", "B", "C"];
    const sparse = ["B", "A", "D"];
    const fused = rrf([dense, sparse], 60);
    expect(fused.map((x) => x.id)).toEqual(["A", "B", "C", "D"]);
    // A: 1/61 + 1/62 ; B: 1/62 + 1/61 -> A == B mathematically; tie broken by first-seen (A before B)
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("returns a single list unchanged in order", () => {
    expect(rrf([["X", "Y", "Z"]], 60).map((x) => x.id)).toEqual(["X", "Y", "Z"]);
  });

  it("ignores empty lists and never throws", () => {
    expect(rrf([[], ["P"]], 60).map((x) => x.id)).toEqual(["P"]);
    expect(rrf([], 60)).toEqual([]);
  });
});
