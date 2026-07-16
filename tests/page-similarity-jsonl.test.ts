import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { buildChunkInputs, DEFAULT_CHUNKING, PageSimilarityService } from "../src/page-similarity";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import { upsertPageIndex } from "../src/wiki-index-store";
import {
  chunkRecordToEmbeddingChunk,
  embeddingChunkToChunkRecord,
  parseWikiIndexJsonl,
  type ChunkIndexRecord,
  type PageIndexRecord,
} from "../src/wiki-index-jsonl";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

test("embedding chunks convert to index chunk records with vector metadata", () => {
  const record = embeddingChunkToChunkRecord({
    articleId: "a",
    path: "!Wiki/hld/concept/a.md",
    heading: "## Detail",
    ordinal: 1,
    bodyHash: "body",
    embedTextHash: "embed",
    vector: [0.1, 0.2],
    vectorModel: "nomic",
    dimensions: 2,
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.deepEqual(chunkRecordToEmbeddingChunk(record).vector, [0.1, 0.2]);
});

test("summary and first section use distinct persistent chunk identities", () => {
  const inputs = buildChunkInputs(
    "Alpha description",
    "# Alpha\n\n## Facts\nAlpha facts.",
    DEFAULT_CHUNKING,
  );

  assert.deepEqual(inputs.map((input) => input.ordinal), [0, 1]);
  const records = chunkRecords(pageRecord("a"), inputs);
  assert.equal(new Set(records.map((record) => `${record.articleId}:${record.ordinal}`)).size, records.length);
});

test("jaccard chunk fallback prefers heading and path evidence", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/airflow-ha.md", "# Airflow\n\n## Балансировка Airflow\nРешение через active-active."],
    ["!Wiki/hld/pages/generic.md", "# Generic\n\n## X\nairflow балансировка"],
  ]);
  const ids = new Set(["airflow-ha", "generic"]);
  const service = new PageSimilarityService({ mode: "jaccard", topK: 2, chunking: DEFAULT_CHUNKING });

  const chunks = await service.selectRelevantChunks(
    "airflow балансировка",
    pages,
    ids,
    ids,
    { "airflow-ha": 1, generic: 1 },
    2,
  );

  assert.equal(chunks[0].articleId, "airflow-ha");
  assert.equal(chunks[0].heading, "## Балансировка Airflow");
});

test("jaccard chunk fallback does not demote HLD or README template names", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/template-readme.md", "# Template\n\n## Компоненты ответственность\nкомпоненты ответственность проектов"],
    ["!Wiki/hld/pages/owner.md", "# Owner\n\n## Компоненты\nответственность проектов"],
    ["!Wiki/hld/pages/support-a.md", "# Support A\n\n## Компоненты\nпроекты"],
    ["!Wiki/hld/pages/support-b.md", "# Support B\n\n## Notes\nответственность"],
  ]);
  const ids = new Set(["template-readme", "owner", "support-a", "support-b"]);
  const service = new PageSimilarityService({
    mode: "jaccard",
    topK: 4,
    chunking: DEFAULT_CHUNKING,
    boilerplateDemotion: { enabled: true, factor: 0.15 },
  });

  const chunks = await service.selectRelevantChunks(
    "компоненты ответственность",
    pages,
    ids,
    ids,
    { "template-readme": 1, owner: 1, "support-a": 1, "support-b": 1 },
    4,
  );

  assert.equal(chunks[0].articleId, "template-readme");
  const owner = chunks.find((chunk) => chunk.articleId === "owner");
  const template = chunks.find((chunk) => chunk.articleId === "template-readme");
  assert.ok(owner && template);
  assert.ok(template.score > owner.score);
});

test("hybrid sparse side uses weighted lexical page score", async () => {
  const service = new PageSimilarityService({ mode: "hybrid", topK: 2 });
  const scored = await service.selectRelevantScored(
    "экспорт s3 clickhouse",
    new Map([
      ["export-s3-clickhouse", "Краткое описание."],
      ["generic", "экспорт s3 clickhouse " + "шаблон ".repeat(120)],
    ]),
    ["!Wiki/hld/pages/export-s3-clickhouse.md", "!Wiki/hld/pages/generic.md"],
  );

  assert.equal(scored[0].path, "!Wiki/hld/pages/export-s3-clickhouse.md");
});

test("chunk refresh preserves page records and uses their governed page paths", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const page: PageIndexRecord = {
    kind: "page",
    schemaVersion: 1,
    articleId: "a",
    path: "!Wiki/d/concept/a.md",
    type: "concept",
    description: "Alpha description",
    resource: ["source"],
    bodyHash: "page-body",
    descriptionHash: "page-description",
  };
  const body = "# Alpha\n\n## Facts\nAlpha facts.";
  const inputs = buildChunkInputs(page.description, body, DEFAULT_CHUNKING);
  const vector = [...new Float32Array([0.1, 0.2])];
  const chunks: ChunkIndexRecord[] = inputs.map((input, ordinal) => ({
    kind: "chunk",
    schemaVersion: 1,
    articleId: "a",
    path: page.path,
    heading: input.heading ?? "",
    ordinal: input.ordinal ?? ordinal,
    bodyHash: input.hash,
    embedTextHash: input.hash,
    vector,
    vectorModel: "m",
    dimensions: 2,
    updatedAt: "2026-07-16T00:00:00.000Z",
  }));
  const stale: ChunkIndexRecord = { ...chunks[0], articleId: "stale", path: "!Wiki/d/concept/stale.md" };
  const adapter = new MemoryAdapter(new Map([
    [indexPath, [page, ...chunks, stale].map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const service = new PageSimilarityService({
    mode: "embedding",
    topK: 2,
    model: "m",
    dimensions: 2,
    baseUrl: "http://unused",
  });

  const result = await service.refreshCache(
    domainRoot,
    new VaultTools(adapter, ""),
    new Map([["a", page.description]]),
    new Map([["a", body]]),
    { fullCorpus: true },
  );

  assert.equal(result.updated, 0);
  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  assert.deepEqual(records.find((record) => record.kind === "page"), page);
  assert.equal(records.filter((record) => record.kind === "chunk").every((record) => record.path === page.path), true);
});

test("chunk refresh rejects malformed JSONL and preserves exact index bytes", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const page = pageRecord("a");
  const original = `${JSON.stringify(page)}\r\n{bad}\r\n`;
  const adapter = new MemoryAdapter(new Map([[indexPath, original]]));
  const service = embeddingService();

  await assert.rejects(
    service.refreshCache(
      domainRoot,
      new VaultTools(adapter, ""),
      new Map([["a", page.description]]),
      new Map([["a", "# Alpha\n\n## Facts\nAlpha facts."]]),
      { fullCorpus: true },
    ),
    (error: Error) => error.name === "JsonlParseError" && error.message.includes(`${indexPath}:2:`),
  );
  assert.equal(adapter.files.get(indexPath), original);
});

test("chunk refresh rejects atomically when a pending embedding batch fails", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const page = pageRecord("a");
  const oldBody = "# Alpha\n\n## Facts\nOld alpha facts.";
  const oldChunks = chunkRecords(page, buildChunkInputs(page.description, oldBody, DEFAULT_CHUNKING));
  const future = { kind: "future", value: { preserve: true } };
  const original = [page, future, ...oldChunks].map((record) => JSON.stringify(record)).join("\r\n") + "\r\n";
  const adapter = new MemoryAdapter(new Map([[indexPath, original]]));

  let completed = false;
  await assert.rejects(
    embeddingService().refreshCache(
      domainRoot,
      new VaultTools(adapter, ""),
      new Map([[page.articleId, "Changed description requiring a new vector"]]),
      new Map([[page.articleId, "# Alpha\n\n## Facts\nChanged alpha facts requiring a new vector."]]),
      { fullCorpus: true },
    ).then(() => { completed = true; }),
    /embedding/i,
  );

  assert.equal(completed, false);
  assert.equal(adapter.files.get(indexPath), original);
});

test("cache load rejects malformed JSONL instead of treating it as missing", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const original = `${JSON.stringify(pageRecord("a"))}\n{bad}\n`;
  const adapter = new MemoryAdapter(new Map([[indexPath, original]]));

  await assert.rejects(
    embeddingService().loadCache(domainRoot, new VaultTools(adapter, "")),
    (error: Error) => error.name === "JsonlParseError" && error.message.includes(`${indexPath}:2:`),
  );
  assert.equal(adapter.files.get(indexPath), original);
});

test("queued chunk refresh and page upsert preserve both mutations", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const pageA = pageRecord("a");
  const pageB = pageRecord("b");
  const future = { kind: "future", value: 1 };
  const body = "# Alpha\n\n## Facts\nAlpha facts.";
  const inputs = buildChunkInputs(pageA.description, body, DEFAULT_CHUNKING);
  const chunks = chunkRecords(pageA, inputs);
  const stale = { ...chunks[0], articleId: "stale", path: "!Wiki/d/concept/stale.md" };
  const adapter = new MemoryAdapter(new Map([
    [indexPath, [pageA, future, ...chunks, stale].map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const gate = adapter.pauseNextWrite(indexPath);
  const vaultTools = new VaultTools(adapter, "");

  const refresh = embeddingService().refreshCache(
    domainRoot,
    vaultTools,
    new Map([["a", pageA.description]]),
    new Map([["a", body]]),
    { fullCorpus: true },
  );
  await gate.started;
  const pageUpsert = upsertPageIndex(vaultTools, domainRoot, pageB);
  await new Promise<void>((resolve) => setImmediate(resolve));
  gate.release();
  await Promise.all([refresh, pageUpsert]);

  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  assert.deepEqual(records.find((record) => record.kind === "page" && record.articleId === "a"), pageA);
  assert.deepEqual(records.find((record) => record.kind === "page" && record.articleId === "b"), pageB);
  assert.deepEqual(records.find((record) => record.kind === "future"), future);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "a"), true);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "stale"), false);
});

test("concurrent refreshes through different VaultTools wrappers merge changed article chunks", async () => {
  const domainRoot = "!Wiki/d";
  const indexPath = `${domainRoot}/index.jsonl`;
  const pageA = pageRecord("a");
  const pageB = pageRecord("b");
  const future = { kind: "future", value: { keep: true } };
  const bodyA = "# Alpha\n\n## Facts\nAlpha facts.";
  const bodyB = "# Beta\n\n## Facts\nBeta facts.";
  const desiredA = chunkRecords(pageA, buildChunkInputs(pageA.description, bodyA, DEFAULT_CHUNKING));
  const desiredB = chunkRecords(pageB, buildChunkInputs(pageB.description, bodyB, DEFAULT_CHUNKING));
  const staleA = { ...desiredA[0], heading: "## Stale A", ordinal: 99, bodyHash: "stale-a", embedTextHash: "stale-a" };
  const staleB = { ...desiredB[0], heading: "## Stale B", ordinal: 99, bodyHash: "stale-b", embedTextHash: "stale-b" };
  const adapter = new MemoryAdapter(new Map([
    [indexPath, [pageA, pageB, future, ...desiredA, staleA, ...desiredB, staleB]
      .map((record) => JSON.stringify(record)).join("\n") + "\n"],
  ]));
  const gate = adapter.pauseNextWrite(indexPath);
  const annotations = new Map([
    [pageA.articleId, pageA.description],
    [pageB.articleId, pageB.description],
  ]);

  const refreshA = embeddingService().refreshCache(
    domainRoot,
    new VaultTools(adapter, ""),
    annotations,
    new Map([[pageA.articleId, bodyA]]),
  );
  await gate.started;
  const refreshB = embeddingService().refreshCache(
    domainRoot,
    new VaultTools(adapter, ""),
    annotations,
    new Map([[pageB.articleId, bodyB]]),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  gate.release();
  await Promise.all([refreshA, refreshB]);

  const records = parseWikiIndexJsonl(adapter.files.get(indexPath)!, indexPath);
  assert.deepEqual(records.filter((record) => record.kind === "page"), [pageA, pageB]);
  assert.deepEqual(records.find((record) => record.kind === "future"), future);
  assert.deepEqual(
    records.filter((record) => record.kind === "chunk" && record.articleId === "a").map((record) => record.ordinal),
    desiredA.map((record) => record.ordinal),
  );
  assert.deepEqual(
    records.filter((record) => record.kind === "chunk" && record.articleId === "b").map((record) => record.ordinal),
    desiredB.map((record) => record.ordinal),
  );
});

function pageRecord(id: string): PageIndexRecord {
  return {
    kind: "page",
    schemaVersion: 1,
    articleId: id,
    path: `!Wiki/d/concept/${id}.md`,
    type: "concept",
    description: `${id} description`,
    resource: ["source"],
    bodyHash: `body-${id}`,
    descriptionHash: `description-${id}`,
  };
}

function chunkRecords(page: PageIndexRecord, inputs: ReturnType<typeof buildChunkInputs>): ChunkIndexRecord[] {
  const vector = [...new Float32Array([0.1, 0.2])];
  return inputs.map((input, ordinal) => ({
    kind: "chunk",
    schemaVersion: 1,
    articleId: page.articleId,
    path: page.path,
    heading: input.heading ?? "",
    ordinal: input.ordinal ?? ordinal,
    bodyHash: input.hash,
    embedTextHash: input.hash,
    vector,
    vectorModel: "m",
    dimensions: 2,
    updatedAt: "2026-07-16T00:00:00.000Z",
  }));
}

function embeddingService(): PageSimilarityService {
  return new PageSimilarityService({
    mode: "embedding",
    topK: 2,
    model: "m",
    dimensions: 2,
    baseUrl: "http://unused",
  });
}

class MemoryAdapter implements VaultAdapter {
  private pausedWrite?: {
    path: string;
    started: () => void;
    release: Promise<void>;
  };

  constructor(readonly files: Map<string, string>) {}

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> {
    const pause = this.pausedWrite;
    if (pause?.path === path) {
      this.pausedWrite = undefined;
      pause.started();
      await pause.release;
    }
    this.files.set(path, data);
  }
  async append(path: string, data: string): Promise<void> { this.files.set(path, (this.files.get(path) ?? "") + data); }
  async list(): Promise<{ files: string[]; folders: string[] }> { return { files: [], folders: [] }; }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async mkdir(): Promise<void> {}

  pauseNextWrite(path: string): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.pausedWrite = { path, started: markStarted, release: released };
    return { started, release };
  }
}
