import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { PageSimilarityService } = await import("../src/page-similarity");

type StubResponse = { status: number; text: string };

function embeddingResponse(vectors: number[][]): StubResponse {
  return { status: 200, text: JSON.stringify({ data: vectors.map((embedding) => ({ embedding })) }) };
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

/**
 * 100 pages of filler followed by 20 whose text matches the query verbatim, so
 * the two groups fall either side of the 100-input embedding batch boundary and
 * a Jaccard fallback would rank the second group first. Cosine scoring can only
 * return the first group, which is what tells the two paths apart.
 */
function corpus(): { pages: Map<string, string>; ids: Set<string>; scores: Record<string, number> } {
  const pages = new Map<string, string>();
  const ids = new Set<string>();
  const scores: Record<string, number> = {};
  const add = (id: string, body: string): void => {
    pages.set(`!Wiki/d/Concept/${id}.md`, `# ${id}\n\n## Detail\n${body}`);
    ids.add(id);
    scores[id] = 1;
  };
  for (let i = 0; i < 100; i++) add(`filler${String(i).padStart(3, "0")}`, "alpha bravo charlie unrelated filler prose");
  for (let i = 0; i < 20; i++) add(`match${String(i).padStart(3, "0")}`, "neural retrieval exact wording neural retrieval");
  return { pages, ids, scores };
}

function service(): InstanceType<typeof PageSimilarityService> {
  return new PageSimilarityService({
    mode: "embedding",
    topK: 10,
    baseUrl: "http://fake.local",
    apiKey: "fake",
    model: "fake",
    dimensions: 2,
  });
}

test("a failed embedding batch keeps the vectors already computed", async () => {
  const { pages, ids, scores } = corpus();
  let call = 0;
  const chunks = await withRequestUrl(
    (options) => {
      call++;
      if (call === 1) return embeddingResponse([[1, 0]]);           // the query itself
      if (call === 2) {
        const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
        return embeddingResponse(inputs.map(() => [1, 0]));          // first 100 sections
      }
      throw new Error("embedding backend refused the second batch");
    },
    () => service().selectRelevantChunks("neural retrieval", pages, ids, ids, scores, 5),
  );

  assert.ok(chunks.length > 0, "expected the already-embedded sections to still be ranked");
  const fromSecondBatch = chunks.filter((chunk) => chunk.articleId.startsWith("match"));
  assert.deepEqual(fromSecondBatch, [], "sections from the failed batch cannot be scored");
  assert.ok(
    chunks.every((chunk) => chunk.articleId.startsWith("filler")),
    `expected cosine-scored sections from the successful batch, got ${chunks.map((c) => c.articleId).join(",")}`,
  );
});

test("a failed embedding batch is reported rather than degrading silently", async () => {
  const { pages, ids, scores } = corpus();
  const svc = service();
  let call = 0;
  await withRequestUrl(
    (options) => {
      call++;
      if (call === 1) return embeddingResponse([[1, 0]]);
      if (call === 2) {
        const inputs = (JSON.parse(options.body ?? "{}") as { input: string[] }).input;
        return embeddingResponse(inputs.map(() => [1, 0]));
      }
      throw new Error("embedding backend refused the second batch");
    },
    () => svc.selectRelevantChunks("neural retrieval", pages, ids, ids, scores, 5),
  );

  assert.ok(svc.lastChunkDegrade, "expected a degrade reason to be recorded");
  assert.match(svc.lastChunkDegrade ?? "", /refused the second batch/);
});

test("a clean run records no degrade reason", async () => {
  const { pages, ids, scores } = corpus();
  const svc = service();
  await withRequestUrl(
    (options) => {
      const parsed = JSON.parse(options.body ?? "{}") as { input: string[] };
      return embeddingResponse(parsed.input.map(() => [1, 0]));
    },
    () => svc.selectRelevantChunks("neural retrieval", pages, ids, ids, scores, 5),
  );

  assert.equal(svc.lastChunkDegrade, null);
});

test("losing every vector still falls back to Jaccard", async () => {
  const { pages, ids, scores } = corpus();
  const svc = service();
  const chunks = await withRequestUrl(
    (options) => {
      const parsed = JSON.parse(options.body ?? "{}") as { input: string[] };
      if (parsed.input.length === 1) return embeddingResponse([[1, 0]]);  // the query
      throw new Error("embedding backend is down");
    },
    () => svc.selectRelevantChunks("neural retrieval", pages, ids, ids, scores, 5),
  );

  assert.ok(chunks.length > 0, "expected the Jaccard fallback to still answer");
  assert.ok(
    chunks.some((chunk) => chunk.articleId.startsWith("match")),
    "Jaccard ranks the verbatim matches first",
  );
});
