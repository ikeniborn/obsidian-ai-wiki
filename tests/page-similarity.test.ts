import { describe, it, expect, beforeEach } from "vitest";
import { PageSimilarityService, encodeVector, decodeVector, DEFAULT_CHUNKING, buildChunkInputs, probeEmbeddingDimensions } from "../src/page-similarity";
import { __requestUrlCalls, __clearRequestUrlCalls, __setRequestUrlResponse } from "../vitest.mock";
import { rrf } from "../src/rrf";

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

  // @lat: [[tests#Multi-Vector Retrieval#Offline Jaccard finds a section keyword]]
  it("offline Jaccard: a body-section keyword in the enriched annotation is load-bearing", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 1 });
    const result = await svc.selectRelevant(
      "idempotency retry",
      new Map([
        // old-style summary-only annotation — the body fact is absent
        ["OrdersPlain", "Order processing."],
        // enriched annotation — Термины harvests keywords from every body section
        ["OrdersRich", "Order processing. Термины: idempotency, retry, dedup, saga"],
      ]),
      ["!Wiki/d/x/OrdersPlain.md", "!Wiki/d/x/OrdersRich.md"],
    );
    // Only the enriched page surfaces; the plain summary-only annotation does not match the body fact.
    expect(result).toEqual(["!Wiki/d/x/OrdersRich.md"]);
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
      version: 2, model: "m", dimensions: 3,
      entries: {
        Alpha: { chunks: [{ vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x", kind: "summary" }] },
        Beta:  { chunks: [{ vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x", kind: "summary" }] },
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
      version: 2, model: "m", dimensions: 3,
      entries: {
        Alpha: { chunks: [{ vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x", kind: "summary" }] },
        Beta:  { chunks: [{ vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x", kind: "summary" }] },
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
  // @lat: [[tests#Multi-Vector Retrieval#Old cache schema loads as null]]
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

  // @lat: [[tests#Multi-Vector Retrieval#Cache v2 round-trips multiple chunks]]
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

  // @lat: [[tests#Multi-Vector Retrieval#Incremental re-embed touches only changed chunks]]
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
    expect(written.entries.Alpha.chunks.length).toBeGreaterThan(0);
    expect(written.entries.Alpha.chunks[0].kind).toBe("summary");
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

  it("preserves section chunks for a pid whose body is not supplied (incremental ingest)", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length; // summary + 2 sections
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    // Full embed of Alpha (summary + 2 sections)
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body]]));
    const after1 = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    expect(after1.entries.Alpha.chunks).toHaveLength(n);

    // Incremental ingest: annotations list BOTH pages, but only Beta's body is supplied.
    __clearRequestUrlCalls();
    const betaBody = "# T\n\n## Gamma\n\nGamma body.";
    const betaN = buildChunkInputs("beta annot", betaBody, DEFAULT_CHUNKING).length;
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: betaN }, () => ({ embedding: [0, 1, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    await svc.refreshCache(
      "domainRoot", vt,
      new Map([["Alpha", annotation], ["Beta", "beta annot"]]),
      new Map([["Beta", betaBody]]),
    );
    const after2 = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    // Alpha's section chunks survive (NOT pruned to summary-only)
    expect(after2.entries.Alpha.chunks).toHaveLength(n);
    expect(after2.entries.Alpha.chunks.filter((c: { kind: string }) => c.kind === "section")).toHaveLength(2);
    // Beta embedded fresh
    expect(after2.entries.Beta.chunks.length).toBe(betaN);
  });

  it("skips chunks when the API returns fewer vectors than requested", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body."; // summary + 2 sections = 3 chunks
    // API returns only ONE vector for a 3-input request (truncated response)
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService(cfg);
    const vt = makeVaultTools();
    await svc.refreshCache("domainRoot", vt, new Map([["Alpha", annotation]]), new Map([["Alpha", body]]));
    const written = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    // only the chunk that actually got a vector is persisted; no garbage/empty vectors
    expect(written.entries.Alpha.chunks.every((c: { vector: string }) => c.vector !== "")).toBe(true);
    expect(written.entries.Alpha.chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe("max-pool scoring", () => {
  beforeEach(() => __clearRequestUrlCalls());

  // @lat: [[tests#Multi-Vector Retrieval#Max-pool surfaces a body-section match]]
  it("surfaces a page whose only match is a body-section vector", async () => {
    // Query vector points along axis 2 (the body section), NOT the summary axis.
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0, 0, 1] }] }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    (svc as unknown as { cache: unknown }).cache = {
      version: 2, model: "m", dimensions: 3,
      entries: {
        Alpha: { chunks: [
          { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "s", kind: "summary" },
          { vector: encodeVector(new Float32Array([0, 0, 1])), hash: "b", kind: "section" }, // body match
        ] },
        Beta: { chunks: [
          { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "s", kind: "summary" },
        ] },
      },
    };
    const result = await svc.selectRelevant(
      "body section query",
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );
    expect(result).toEqual(["!Wiki/d/x/Alpha.md"]); // body-section vector wins via max-pool
  });

  it("falls back to Jaccard for a page whose vectors all failed", async () => {
    __setRequestUrlResponse({ status: 500, text: "err", headers: {} });
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const result = await svc.selectRelevant(
      "neural network",
      new Map([["Alpha", "neural network deep learning"]]),
      ["!Wiki/d/x/Alpha.md"],
    );
    // query embedding throws → whole call falls to Jaccard → Alpha matches on tokens
    expect(result).toEqual(["!Wiki/d/x/Alpha.md"]);
  });
});

describe("hybrid mode", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Hybrid mode fuses dense and jaccard seeds]]
  it("hybrid with no embedding endpoint degrades to jaccard (keyless)", async () => {
    const svc = new PageSimilarityService({ mode: "hybrid", topK: 3, rrfK: 60 });
    const annotations = new Map<string, string>([
      ["alpha", "alpha api flag error code"],
      ["beta", "beta unrelated text"],
    ]);
    const paths = ["W/d/e/alpha.md", "W/d/e/beta.md"];
    const out = await svc.selectRelevantScored("api flag error", annotations, paths);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].path).toBe("W/d/e/alpha.md"); // jaccard-on-both fusion still ranks the match first
  });
});

describe("maxSimilarityToExisting (dedup scoring)", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Dedup gate scores a candidate against existing pages]]
  it("jaccard mode: returns the closest existing page by token overlap, 0..1", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    // jaccard mode needs annotations as the existing-page corpus
    svc.setJaccardCorpus(new Map([
      ["docker-net", "docker network bridge driver"],
      ["k8s-pod",    "kubernetes pod lifecycle"],
    ]));
    const out = await svc.maxSimilarityToExisting("docker network driver", new Set());
    expect(out.pid).toBe("docker-net");
    expect(out.score).toBeGreaterThan(0);
    expect(out.score).toBeLessThanOrEqual(1);
  });

  it("respects excludePids", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    svc.setJaccardCorpus(new Map([["docker-net", "docker network bridge driver"]]));
    const out = await svc.maxSimilarityToExisting("docker network", new Set(["docker-net"]));
    expect(out).toEqual({ pid: "", score: 0 });
  });
});

describe("pairwiseNearDuplicates", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Lint surfaces near-duplicate page pairs]]
  it("returns pairs at/above threshold and skips when over the page cap", () => {
    const svc = new PageSimilarityService({ mode: "embedding", model: "m", dimensions: 2, topK: 5 });
    svc.setCacheForTest({
      version: 2, model: "m", dimensions: 2,
      entries: {
        a: { chunks: [{ vector: encodeVector(new Float32Array([1, 0])), hash: "h", kind: "summary" }] },
        b: { chunks: [{ vector: encodeVector(new Float32Array([1, 0])), hash: "h", kind: "summary" }] },
        c: { chunks: [{ vector: encodeVector(new Float32Array([0, 1])), hash: "h", kind: "summary" }] },
      },
    });
    const { pairs, skippedPageCount } = svc.pairwiseNearDuplicates(0.9, 500);
    expect(skippedPageCount).toBe(0);
    expect(pairs).toEqual([{ a: "a", b: "b", score: 1 }]); // a≈b (cosine 1), c orthogonal
    const over = svc.pairwiseNearDuplicates(0.9, 2);
    expect(over.skippedPageCount).toBe(3);
    expect(over.pairs).toEqual([]);
  });
});

describe("refreshCache persists in hybrid mode", () => {
  beforeEach(() => __clearRequestUrlCalls());

  // @lat: [[tests#Multi-Vector Retrieval#Hybrid persists the embeddings cache]]
  it("writes the v2 cache in hybrid mode (not just embedding mode)", async () => {
    const annotation = "rich annotation";
    const body = "# T\n\n## Alpha\n\nAlpha body.";
    const n = buildChunkInputs(annotation, body, DEFAULT_CHUNKING).length;
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: Array.from({ length: n }, () => ({ embedding: [1, 0, 0] })) }),
      headers: { "content-type": "application/json" },
    });
    const svc = new PageSimilarityService({
      mode: "hybrid", topK: 3, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k", chunking: DEFAULT_CHUNKING,
    });
    const vt = makeVaultTools();
    const { updated } = await svc.refreshCache(
      "domainRoot", vt,
      new Map([["Alpha", annotation]]),
      new Map([["Alpha", body]]),
    );
    expect(updated).toBe(n);
    const written = JSON.parse((vt as any).files.get("domainRoot/_config/_embeddings.json")!);
    expect(written.version).toBe(2);
    expect(written.entries.Alpha.chunks).toHaveLength(n);
  });
});

describe("probeEmbeddingDimensions", () => {
  beforeEach(() => __clearRequestUrlCalls());

  // @lat: [[tests#Multi-Vector Retrieval#Probe detects model output dimension]]
  it("detects native dimension when no value is requested (sends no dimensions field)", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
      headers: { "content-type": "application/json" },
    });
    const probe = await probeEmbeddingDimensions("http://x", "k", "m");
    expect(probe).toEqual({ actual: 4, requested: undefined, honored: true });
    const body = JSON.parse(__requestUrlCalls[0].body as string);
    expect(body.input).toEqual(["ping"]);
    expect(body.dimensions).toBeUndefined();
  });

  // @lat: [[tests#Multi-Vector Retrieval#Probe verifies a requested dimension]]
  it("sends the requested dimension and reports honored when the model returns it", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }),
      headers: { "content-type": "application/json" },
    });
    const probe = await probeEmbeddingDimensions("http://x", "k", "m", 3);
    expect(probe).toEqual({ actual: 3, requested: 3, honored: true });
    expect(JSON.parse(__requestUrlCalls[0].body as string).dimensions).toBe(3);
  });

  it("reports not honored when the model ignores the requested dimension", async () => {
    __setRequestUrlResponse({
      status: 200,
      text: JSON.stringify({ data: [{ embedding: [1, 2, 3, 4, 5, 6] }] }),
      headers: { "content-type": "application/json" },
    });
    const probe = await probeEmbeddingDimensions("http://x", "k", "m", 512);
    expect(probe).toEqual({ actual: 6, requested: 512, honored: false });
  });

  it("returns null on HTTP error", async () => {
    __setRequestUrlResponse({ status: 500, text: "err", headers: {} });
    expect(await probeEmbeddingDimensions("http://x", "k", "m", 3)).toBeNull();
  });
});
