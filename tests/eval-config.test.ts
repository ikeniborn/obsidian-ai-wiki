import { describe, it, expect } from "vitest";
import { resolveConfigs } from "../scripts/eval-config";

describe("resolveConfigs", () => {
  it("defaults to dense,jaccard when the flag is undefined", () => {
    const cfgs = resolveConfigs(undefined, 1, 8);
    expect(cfgs.map((c) => c.name)).toEqual(["dense", "jaccard"]);
    expect(cfgs.find((c) => c.name === "dense")!.mode).toBe("embedding");
    expect(cfgs.find((c) => c.name === "jaccard")!.mode).toBe("jaccard");
  });

  it("carries bfsDepth and topK onto every record", () => {
    const cfgs = resolveConfigs("dense", 2, 5);
    expect(cfgs[0]).toEqual({ name: "dense", mode: "embedding", bfsDepth: 2, topK: 5 });
  });

  it("accepts a comma list and trims", () => {
    const cfgs = resolveConfigs("jaccard, dense", 0, 8);
    expect(cfgs.map((c) => c.name)).toEqual(["jaccard", "dense"]);
  });

  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Eval harness resolves the hybrid config]]
  it("resolves hybrid config to hybrid mode", () => {
    const cfgs = resolveConfigs("hybrid", 1, 8);
    expect(cfgs[0]).toMatchObject({ name: "hybrid", mode: "hybrid", bfsDepth: 1, topK: 8 });
  });

  it("throws on an unknown config name", () => {
    expect(() => resolveConfigs("bogus", 1, 8)).toThrow(/bogus/);
  });

  // @lat: [[tests#Tier 2 — Query Fusion#Eval resolves the dense+rrf config]]
  it("resolves dense+rrf to embedding mode with fuse=true", () => {
    const cfgs = resolveConfigs("dense+rrf", 1, 8);
    expect(cfgs[0]).toMatchObject({ name: "dense+rrf", mode: "embedding", fuse: true, bfsDepth: 1, topK: 8 });
  });

  it("leaves fuse falsy for a plain dense config", () => {
    const cfgs = resolveConfigs("dense", 1, 8);
    expect(cfgs[0].fuse).toBeFalsy();
  });
});
