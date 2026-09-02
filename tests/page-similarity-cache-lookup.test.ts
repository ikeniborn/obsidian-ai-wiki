import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { PageSimilarityService, encodeVector, DEFAULT_CHUNKING } = await import("../src/page-similarity");

type StubResponse = { status: number; text: string };

async function withRequestUrl<T>(
  handler: (options: { body?: string }) => StubResponse,
  fn: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as { __obsidianRequestUrlForTest?: unknown };
  const previous = globals.__obsidianRequestUrlForTest;
  globals.__obsidianRequestUrlForTest = handler;
  try {
    return await fn();
  } finally {
    if (previous) globals.__obsidianRequestUrlForTest = previous;
    else delete globals.__obsidianRequestUrlForTest;
  }
}

function service(): InstanceType<typeof PageSimilarityService> {
  return new PageSimilarityService({
    mode: "embedding",
    topK: 5,
    baseUrl: "http://fake.local",
    apiKey: "fake",
    model: "m",
    dimensions: 2,
    chunking: DEFAULT_CHUNKING,
  });
}

const PAGES = new Map([[
  "!Wiki/d/Concept/p.md",
  "# Page\n\n## Detail\nneural retrieval evidence lives here and is long enough to chunk on its own.",
]]);
const IDS = new Set(["p"]);
const SCORES = { p: 1 };
const vec = (a: number, b: number): string => encodeVector(new Float32Array([a, b]));

// Characterization tests for the cache lookup and the single-vector scoring path,
// pinned before those loops were rewritten for cost. Behavior must not move.

test("a cache full of non-matching chunks neither shadows nor drops the section", async () => {
  const decoys = Array.from({ length: 200 }, (_, i) => ({
    vector: vec(0, 1),
    hash: `decoy-${i}`,
    kind: "section" as const,
  }));
  const svc = service();
  svc.setCacheForTest({ version: 3, model: "m", dimensions: 2, entries: { p: { chunks: decoys } } });

  let calls = 0;
  const chunks = await withRequestUrl(
    (options) => {
      calls++;
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      return { status: 200, text: JSON.stringify({ data: inputs.map(() => ({ embedding: [1, 0] })) }) };
    },
    () => svc.selectRelevantChunks("neural retrieval", PAGES, IDS, IDS, SCORES, 3),
  );

  assert.ok(chunks.length > 0, "expected the section to be ranked despite a decoy-filled cache");
  assert.ok(calls >= 2, "expected the query embedding plus a live section embedding");
});

test("a summary chunk never satisfies a section lookup", async () => {
  const svc = service();
  svc.setCacheForTest({
    version: 3,
    model: "m",
    dimensions: 2,
    entries: { p: { chunks: [{ vector: vec(0, 1), hash: "any", kind: "summary" }] } },
  });

  let embeddedSections = 0;
  await withRequestUrl(
    (options) => {
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      if (inputs.some((input) => input.includes("Detail"))) embeddedSections += inputs.length;
      return { status: 200, text: JSON.stringify({ data: inputs.map(() => ({ embedding: [1, 0] })) }) };
    },
    () => svc.selectRelevantChunks("neural retrieval", PAGES, IDS, IDS, SCORES, 3),
  );

  assert.ok(embeddedSections > 0, "the section had to be embedded live, not taken from a summary chunk");
});

test("a cache from another model is ignored entirely", async () => {
  const svc = service();
  svc.setCacheForTest({
    version: 3,
    model: "other-model",
    dimensions: 2,
    entries: { p: { chunks: [{ vector: vec(0, 1), hash: "any", kind: "section" }] } },
  });

  let embeddedSections = 0;
  await withRequestUrl(
    (options) => {
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      if (inputs.some((input) => input.includes("Detail"))) embeddedSections += inputs.length;
      return { status: 200, text: JSON.stringify({ data: inputs.map(() => ({ embedding: [1, 0] })) }) };
    },
    () => svc.selectRelevantChunks("neural retrieval", PAGES, IDS, IDS, SCORES, 3),
  );

  assert.ok(embeddedSections > 0, "a foreign-model cache must not supply vectors");
});

test("scoring a single vector gives the plain cosine", async () => {
  const chunks = await withRequestUrl(
    (options) => {
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      // Query and section embed to the same direction, so cosine is exactly 1.
      return { status: 200, text: JSON.stringify({ data: inputs.map(() => ({ embedding: [3, 4] })) }) };
    },
    () => service().selectRelevantChunks("neural retrieval", PAGES, IDS, IDS, SCORES, 3),
  );

  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.ok(Math.abs(chunk.score - 1) < 1e-6, `expected cosine 1, got ${chunk.score}`);
  }
});

test("an orthogonal vector scores zero and is dropped", async () => {
  const chunks = await withRequestUrl(
    (options) => {
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      const isQuery = inputs.length === 1 && !inputs[0].includes("Detail");
      return {
        status: 200,
        text: JSON.stringify({ data: inputs.map(() => ({ embedding: isQuery ? [1, 0] : [0, 1] })) }),
      };
    },
    () => service().selectRelevantChunks("neural retrieval", PAGES, IDS, IDS, SCORES, 3),
  );

  assert.deepEqual(chunks, [], "a zero-scoring section is not returned");
});
