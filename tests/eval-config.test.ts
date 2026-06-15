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

  it("throws on an unknown config name", () => {
    expect(() => resolveConfigs("hybrid", 1, 8)).toThrow(/hybrid/);
  });
});
