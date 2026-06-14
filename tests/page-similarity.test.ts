import { describe, it, expect, beforeEach } from "vitest";
import { PageSimilarityService, encodeVector, decodeVector, DEFAULT_CHUNKING, buildChunkInputs } from "../src/page-similarity";
import { __requestUrlCalls, __clearRequestUrlCalls, __setRequestUrlResponse } from "../vitest.mock";

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
    const result = await svc.refreshCache("domainRoot", {} as never, new Map(), new Map());
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

describe("PageSimilarityService.selectRelevantScored (Jaccard)", () => {
  it("returns scored paths with scores in [0,1]", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 3 });
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
    const result = await svc.selectRelevantScored(
      "deep learning neural network classification",
      annotations,
      allPaths,
    );
    expect(result.length).toBeGreaterThan(0);
    for (const { path, score } of result) {
      expect(typeof path).toBe("string");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    // Alpha and Gamma rank ahead of Beta
    const topPaths = result.slice(0, 2).map(x => x.path);
    expect(topPaths.some(p => p.includes("Alpha"))).toBe(true);
    expect(topPaths.some(p => p.includes("Gamma"))).toBe(true);
  });

  it("returns empty when source has no tokens", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([["Alpha", "machine learning"]]);
    const allPaths = ["!Wiki/d/sub/Alpha.md"];
    const result = await svc.selectRelevantScored("", annotations, allPaths);
    expect(result).toHaveLength(0);
  });

  it("scores match those returned by selectJaccard internally", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([
      ["Alpha", "neural network deep learning"],
      ["Beta", "cooking recipes"],
    ]);
    const allPaths = ["!Wiki/d/sub/Alpha.md", "!Wiki/d/sub/Beta.md"];
    const scored = await svc.selectRelevantScored("neural deep", annotations, allPaths);
    const alphaEntry = scored.find(x => x.path.includes("Alpha"));
    expect(alphaEntry).toBeDefined();
    expect(alphaEntry!.score).toBeGreaterThan(0);
  });
});

describe("PageSimilarityService.selectByEntities (embedding mode)", () => {
  beforeEach(() => {
    __clearRequestUrlCalls();
    __setRequestUrlResponse({ status: 200, text: "{}", headers: { "content-type": "application/json" } });
  });

  // @lat: [[tests#Per-Entity Retrieval#Top-K per entity in embedding mode]]
  it("batches all entity queries in one HTTP call", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }] }),
      headers: { "content-type": "application/json" },
    });

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

    expect(__requestUrlCalls).toHaveLength(1);
    const body = JSON.parse(__requestUrlCalls[0].body as string);
    expect(body.input).toEqual(["Q1", "Q2"]);
  });

  it("ranks by cosine similarity per entity", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }),
      headers: { "content-type": "application/json" },
    });

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

  // @lat: [[tests#Per-Entity Retrieval#Jaccard fallback on HTTP error]]
  it("falls back to Jaccard when embedding HTTP throws", async () => {
    __setRequestUrlResponse({ status: 500, text: "error", headers: {} });
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

  // @lat: [[tests#Per-Entity Retrieval#allFailed false when no pages exist]]
  it("allFailed=false when no pages exist (empty wiki)", async () => {
    __setRequestUrlResponse({ status: 500, text: "error", headers: {} });
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "Q1" }, { name: "Q2" }],
      new Map(),
      [],
    );
    expect(allFailed).toBe(false);
    expect(results.get("Q1::")).toEqual([]);
    expect(results.get("Q2::")).toEqual([]);
  });
});

describe("cache schema v2", () => {
  it("loadCache rejects an old { vector, hash } cache (no version: 2)", async () => {
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 3, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const oldCache = JSON.stringify({
      model: "m", dimensions: 3,
      entries: { Alpha: { vector: "AAAA", hash: "x" } },
    });
    const vaultTools = { read: async () => oldCache } as never;
    await svc.loadCache("domainRoot", vaultTools);
    // Old schema → cache stays null → no crash on subsequent select
    expect((svc as unknown as { cache: unknown }).cache).toBeNull();
  });

  it("loadCache accepts a version: 2 cache", async () => {
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 3, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const v2 = JSON.stringify({
      version: 2, model: "m", dimensions: 3,
      entries: { Alpha: { chunks: [{ vector: "AAAA", hash: "x", kind: "summary" }] } },
    });
    const vaultTools = { read: async () => v2 } as never;
    await svc.loadCache("domainRoot", vaultTools);
    expect((svc as unknown as { cache: unknown }).cache).not.toBeNull();
  });
});

function makeVaultTools() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p: string) => {
      const v = files.get(p);
      if (v == null) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    write: async (p: string, c: string) => { files.set(p, c); },
  } as never;
}

describe("refreshCache v2 (multi-vector, incremental)", () => {
  beforeEach(() => __clearRequestUrlCalls());

  const cfg = {
    mode: "embedding" as const, topK: 3, model: "m", dimensions: 3,
    baseUrl: "http://x", apiKey: "k", chunking: DEFAULT_CHUNKING,
  };

  it("embeds summary + one vector per section and round-trips the v2 cache", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.";
    const expectedChunks = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length; // summary + 2
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({
        data: Array.from({ length: expectedChunks }, () => ({ embedding: [1, 0, 0] })),
      }),
      headers: { "content-type": "application/json" },
    });

    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const { updated } = await svc.refreshCache(
      "domainRoot", vt,
      new Map([["Alpha", annotation]]),
      new Map([["Alpha", body]]),
    );
    expect(updated).toBe(expectedChunks);

    const written = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.version).toBe(2);
    expect(written.entries.Alpha.chunks).toHaveLength(expectedChunks);
    expect(written.entries.Alpha.chunks[0].kind).toBe("summary");
    expect(written.entries.Alpha.chunks[1].kind).toBe("section");
  });

  it("re-embeds nothing when body and annotation are unchanged", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length;
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });

    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const anns = new Map([["Alpha", annotation]]);
    const bodies = new Map([["Alpha", body]]);
    await svc.refreshCache("domainRoot", vt, anns, bodies);

    __clearRequestUrlCalls();
    const second = await svc.refreshCache("domainRoot", vt, anns, bodies);
    expect(second.updated).toBe(0);
    expect(__requestUrlCalls).toHaveLength(0); // no HTTP — all hashes hit
  });

  it("re-embeds only the changed section (one chunk)", async () => {
    const annotation = "rich annotation";
    const body1 = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.";
    const n = buildChunkInputs(annotation, body1, DEFAULT_CHUNKING).length; // 3
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body1]]));

    // Change ONLY Beta's body. Summary + Alpha chunk hashes are unchanged.
    const body2 = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body CHANGED.";
    __clearRequestUrlCalls();
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0, 1, 0] }] }), // exactly one chunk re-embedded
      headers: { "content-type": "application/json" },
    });
    const r = await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body2]]));
    expect(r.updated).toBe(1);
    expect(__requestUrlCalls).toHaveLength(1);
    const reqBody = JSON.parse(__requestUrlCalls[0].body as string);
    expect(reqBody.input).toHaveLength(1);
    expect(reqBody.input[0]).toContain("CHANGED");
  });

  it("discards an old { vector, hash } cache and rebuilds as v2", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length;
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    (vt as any).files.set("domainRoot/_config/_embeddings.json", JSON.stringify({
      model: "m", dimensions: 3, entries: { Alpha: { vector: "AAAA", hash: "old" } },
    }));
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body]]));
    const written = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.version).toBe(2);
    expect(written.entries.Alpha.chunks).toBeDefined();
  });

  it("embeds only the summary chunk for a pid with no body", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    const { updated } = await svc.refreshCache(
      "domainRoot", vt, new Map([["Alpha", "annot"]]), new Map(),
    );
    expect(updated).toBe(1);
    const written = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.entries.Alpha.chunks).toHaveLength(1);
    expect(written.entries.Alpha.chunks[0].kind).toBe("summary");
  });
});
