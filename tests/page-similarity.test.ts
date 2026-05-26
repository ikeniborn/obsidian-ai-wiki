import { describe, it, expect } from "vitest";
import { PageSimilarityService, encodeVector, decodeVector } from "../src/page-similarity";

const makeService = (topK = 3) =>
  new PageSimilarityService({ mode: "jaccard", topK });

describe("PageSimilarityService (Jaccard)", () => {
  it("returns top-K paths ranked by annotation similarity", async () => {
    const svc = makeService(2);
    const annotations = new Map([
      ["Alpha", "machine learning neural network deep"],
      ["Beta",  "cooking recipes ingredients kitchen"],
      ["Gamma", "machine learning classification model"],
    ]);
    const allPaths = [
      "!Wiki/d/alpha/Alpha.md",
      "!Wiki/d/beta/Beta.md",
      "!Wiki/d/gamma/Gamma.md",
    ];
    const result = await svc.selectRelevant(
      "deep learning neural network classification",
      annotations,
      allPaths,
    );
    expect(result).toHaveLength(2);
    // Alpha and Gamma score higher than Beta
    expect(result.some(p => p.includes("Alpha"))).toBe(true);
    expect(result.some(p => p.includes("Gamma"))).toBe(true);
    expect(result.every(p => !p.includes("Beta"))).toBe(true);
  });

  it("excludes paths not in indexAnnotations (score 0)", async () => {
    const svc = makeService(5);
    const annotations = new Map([["Known", "neural network"]]);
    const allPaths = ["!Wiki/d/sub/Known.md", "!Wiki/d/sub/Unknown.md"];
    const result = await svc.selectRelevant("neural", annotations, allPaths);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Known");
  });

  it("returns empty when source has no tokens", async () => {
    const svc = makeService(5);
    const annotations = new Map([["Alpha", "machine learning"]]);
    const allPaths = ["!Wiki/d/sub/Alpha.md"];
    const result = await svc.selectRelevant("", annotations, allPaths);
    expect(result).toHaveLength(0);
  });

  it("refreshCache returns { updated: 0 } in Jaccard mode", async () => {
    const svc = makeService(5);
    const result = await svc.refreshCache("domainRoot", {} as never, new Map());
    expect(result).toEqual({ updated: 0 });
  });
});

describe("vector encoding", () => {
  it("round-trips Float32Array through base64", () => {
    const vec = new Float32Array([0.1, 0.5, -0.3, 1.0]);
    const encoded = encodeVector(vec);
    const decoded = decodeVector(encoded);
    expect(decoded.length).toBe(4);
    // Float32 precision loss is acceptable
    for (let i = 0; i < vec.length; i++) {
      expect(decoded[i]).toBeCloseTo(vec[i], 4);
    }
  });
});
