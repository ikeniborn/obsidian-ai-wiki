import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { PageSimilarityService, EMBED_INPUT_MAX_CHARS } = await import("../src/page-similarity");

type StubResponse = { status: number; text: string };

function embeddingResponse(count: number): StubResponse {
  return {
    status: 200,
    text: JSON.stringify({ data: Array.from({ length: count }, () => ({ embedding: [1, 0] })) }),
  };
}

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
    model: "fake",
    dimensions: 2,
    chunking: { maxChars: 40_000, overlapChars: 0, minChars: 200, maxCount: 4 },
  });
}

test("a corpus section longer than the cap is bounded before dispatch", async () => {
  const body = "alpha ".repeat(9_000);                       // ~54 000 chars in one section
  const pages = new Map([["!Wiki/d/Concept/big.md", `# Big\n\n## Detail\n${body}`]]);
  const ids = new Set(["big"]);
  const sent: string[][] = [];

  await withRequestUrl(
    (options) => {
      const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
      sent.push(inputs);
      return embeddingResponse(inputs.length);
    },
    () => service().selectRelevantChunks("alpha", pages, ids, ids, { big: 1 }, 3),
  );

  const corpusInputs = sent.slice(1).flat();
  assert.ok(corpusInputs.length > 0, "expected the section to be embedded");
  assert.ok(
    corpusInputs.every((input) => input.length <= EMBED_INPUT_MAX_CHARS),
    `expected every corpus input within ${EMBED_INPUT_MAX_CHARS} chars, longest was ${Math.max(...corpusInputs.map((i) => i.length))}`,
  );
});

test("the query embedding failure is recorded rather than swallowed", async () => {
  const pages = new Map([["!Wiki/d/Concept/p.md", "# P\n\n## Detail\nalpha bravo charlie delta echo"]]);
  const ids = new Set(["p"]);
  const svc = service();

  const chunks = await withRequestUrl(
    () => { throw new Error("query embedding rejected by provider"); },
    () => svc.selectRelevantChunks("alpha", pages, ids, ids, { p: 1 }, 3),
  );

  assert.ok(chunks.length > 0, "expected the Jaccard fallback to still answer");
  assert.match(svc.lastChunkDegrade ?? "", /query embedding rejected by provider/);
});

test("an unusable query vector is recorded too", async () => {
  const pages = new Map([["!Wiki/d/Concept/p.md", "# P\n\n## Detail\nalpha bravo charlie delta echo"]]);
  const ids = new Set(["p"]);
  const svc = service();

  await withRequestUrl(
    () => ({ status: 200, text: JSON.stringify({ data: [{ embedding: [] }] }) }),
    () => svc.selectRelevantChunks("alpha", pages, ids, ids, { p: 1 }, 3),
  );

  assert.ok(svc.lastChunkDegrade, "expected an unusable query vector to be reported");
});
