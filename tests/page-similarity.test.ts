import { describe, it, expect, beforeEach, vi } from "vitest";
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

describe("PageSimilarityService.selectByEntities (Jaccard mode)", () => {
  it("returns top-K paths per entity", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
    const annotations = new Map([
      ["Alpha", "neural network deep learning"],
      ["Beta",  "cooking recipes kitchen"],
      ["Gamma", "machine learning classification"],
    ]);
    const allPaths = [
      "!Wiki/d/x/Alpha.md",
      "!Wiki/d/x/Beta.md",
      "!Wiki/d/x/Gamma.md",
    ];
    const { results, allFailed } = await svc.selectByEntities(
      [
        { name: "Neural Nets", context_snippet: "deep learning" },
        { name: "Recipes", context_snippet: "cooking" },
      ],
      annotations,
      allPaths,
    );
    expect(allFailed).toBe(false);
    expect(results.size).toBe(2);
    expect(results.get("Neural Nets::")?.some((p) => p.includes("Alpha"))).toBe(true);
    expect(results.get("Recipes::")?.some((p) => p.includes("Beta"))).toBe(true);
  });

  it("returns empty array for entity with no annotation matches", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([["Alpha", "neural network"]]);
    const allPaths = ["!Wiki/d/x/Alpha.md"];
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "Completely Unrelated", context_snippet: "xyzzy plugh" }],
      annotations,
      allPaths,
    );
    expect(allFailed).toBe(false);
    expect(results.get("Completely Unrelated::")).toEqual([]);
  });

  it("uses type in key: `${name}::${type}`", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 1 });
    const { results } = await svc.selectByEntities(
      [{ name: "Foo", type: "Concept" }],
      new Map([["Foo", "Foo concept"]]),
      ["!Wiki/d/x/Foo.md"],
    );
    expect([...results.keys()]).toEqual(["Foo::Concept"]);
  });
});

describe("PageSimilarityService.selectByEntities (embedding mode)", () => {
  beforeEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn();
  });

  it("batches all entity queries in one HTTP call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [1, 0, 0] },
          { embedding: [0, 1, 0] },
        ],
      }),
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    (svc as unknown as { cache: unknown }).cache = {
      model: "m", dimensions: 3,
      entries: {
        Alpha: { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x" },
        Beta:  { vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x" },
      },
    };

    await svc.selectByEntities(
      [{ name: "Q1" }, { name: "Q2" }],
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toEqual(["Q1", "Q2"]);
  });

  it("ranks by cosine similarity per entity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    (svc as unknown as { cache: unknown }).cache = {
      model: "m", dimensions: 3,
      entries: {
        Alpha: { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x" },
        Beta:  { vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x" },
      },
    };

    const { results } = await svc.selectByEntities(
      [{ name: "Q" }],
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );
    expect(results.get("Q::")).toEqual(["!Wiki/d/x/Alpha.md"]);
  });

  it("falls back to Jaccard when embedding HTTP throws", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "neural network" }],
      new Map([["Alpha", "neural network deep learning"]]),
      ["!Wiki/d/x/Alpha.md"],
    );
    expect(allFailed).toBe(false);
    expect(results.get("neural network::")).toEqual(["!Wiki/d/x/Alpha.md"]);
  });

  it("allFailed=true when annotations map is empty (no candidates at all)", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("dead"));
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "Q1" }, { name: "Q2" }],
      new Map(),
      [],
    );
    expect(allFailed).toBe(true);
    expect(results.get("Q1::")).toEqual([]);
    expect(results.get("Q2::")).toEqual([]);
  });
});
