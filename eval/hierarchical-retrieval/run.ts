import "./register";
import { createRequire } from "node:module";
import type { ChunkingConfig, EmbeddingCacheFile, SelectedChunk } from "../../src/page-similarity";
import type { DomainEntry } from "../../src/domain";
import type { LlmClient, RunEvent } from "../../src/types";
import type { VaultTools } from "../../src/vault-tools";

const req = createRequire(import.meta.url);
const {
  DEFAULT_CHUNKING,
  PageSimilarityService,
  buildChunkInputs,
  encodeVector,
  renderContextChunks,
} = req("../../src/page-similarity.ts") as {
  DEFAULT_CHUNKING: ChunkingConfig;
  PageSimilarityService: new (config: {
    mode: "jaccard" | "embedding";
    topK: number;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    dimensions?: number;
  }) => {
    refreshCache?: (
      domainRoot: string,
      vaultTools: VaultTools,
      indexAnnotations: Map<string, string>,
      pageBodies: Map<string, string>,
      opts?: { fullCorpus?: boolean },
    ) => Promise<{ updated: number }>;
    selectRelevantScoredDiag?: (
      sourceContent: string,
      indexAnnotations: Map<string, string>,
      allPaths: string[],
    ) => Promise<{ results: { path: string; score: number }[] }>;
    selectRelevant?: (
      sourceContent: string,
      indexAnnotations: Map<string, string>,
      allPaths: string[],
    ) => Promise<string[]>;
    selectByEntities?: (
      entities: { name: string; type?: string; context_snippet?: string }[],
      indexAnnotations: Map<string, string>,
      allPaths: string[],
    ) => Promise<{ results: Map<string, string[]>; allFailed: boolean }>;
    selectRelevantChunks?: (
      query: string,
      pages: Map<string, string>,
      selectedIds: Set<string>,
      seedIds: Set<string>,
      scores: Record<string, number>,
      maxChunks: number,
    ) => Promise<SelectedChunk[]>;
    setCacheForTest?: (cache: EmbeddingCacheFile) => void;
  };
  buildChunkInputs: typeof import("../../src/page-similarity").buildChunkInputs;
  encodeVector: typeof import("../../src/page-similarity").encodeVector;
  renderContextChunks?: (chunks: SelectedChunk[]) => string;
};
const { runCrossDomainQuery } = req("../../src/phases/query-cross-domain.ts") as typeof import("../../src/phases/query-cross-domain");
const { runQuery } = req("../../src/phases/query.ts") as typeof import("../../src/phases/query");

let pass = 0, fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function fakeVault(files: Record<string, string>): VaultTools {
  const map = new Map(Object.entries(files));
  return {
    read: async (path: string) => {
      const value = map.get(path);
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return value;
    },
    write: async (path: string, content: string) => { map.set(path, content); },
    exists: async (path: string) => map.has(path),
    mkdir: async () => {},
    remove: async (path: string) => { map.delete(path); },
    listFiles: async (dir: string) => [...map.keys()].filter((path) => path.startsWith(dir)),
    readAll: async (paths: string[]) => new Map(paths.map((path) => [path, map.get(path) ?? ""])),
  } as unknown as VaultTools;
}

function fakeLlm(answer: string): { llm: LlmClient; calls: () => number; prompts: () => string[] } {
  let calls = 0;
  const prompts: string[] = [];
  const llm = {
    chat: { completions: { create: async (params: { messages?: { content?: string }[]; stream?: boolean }) => {
      calls++;
      prompts.push((params.messages ?? []).map((message) => String(message.content ?? "")).join("\n"));
      if (params.stream) {
        return (async function* () { yield { choices: [{ delta: { content: answer } }] }; })();
      }
      return { choices: [{ message: { content: answer } }] };
    } } },
  } as unknown as LlmClient;
  return { llm, calls: () => calls, prompts: () => prompts };
}

async function drive(gen: AsyncGenerator<RunEvent, void>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const dom = (id: string): DomainEntry => ({
  id,
  name: id,
  wiki_folder: id,
  source_paths: [],
  entity_types: [],
  analyzed_sources: {},
} as DomainEntry);

async function main(): Promise<void> {
  section("scaffold");
  check("eval scaffold runs", true);

  section("clean chunk inputs and cache version");
  {
    const body = [
      "# Page",
      "",
      "## Details",
      "body text about neural retrieval",
    ].join("\n");
    const inputs = buildChunkInputs("broad article description", body, DEFAULT_CHUNKING);
    const summary = inputs.find((input) => input.kind === "summary");
    const sectionInput = inputs.find((input) => input.kind === "section");

    check("summary input is the description", summary?.embedText === "broad article description");
    check(
      "section input excludes description",
      !!sectionInput &&
        sectionInput.embedText.includes("## Details") &&
        sectionInput.embedText.includes("body text about neural retrieval") &&
        !sectionInput.embedText.includes("broad article description"),
      `embedText=${sectionInput?.embedText}`,
    );
    check("section input carries heading", sectionInput?.heading === "## Details");
    check("section input carries ordinal", sectionInput?.ordinal === 0, `ordinal=${sectionInput?.ordinal}`);

    const cache: EmbeddingCacheFile = {
      version: 3,
      model: "fake",
      dimensions: 2,
      entries: {},
    };
    check("cache version is 3", cache.version === 3);

    const oldCachePath = "!Wiki/work/_config/_embeddings.json";
    const oldRawCache = JSON.stringify({
      version: 2,
      model: "fake",
      dimensions: 2,
      entries: {
        wiki_one: { chunks: [{ vector: "old-one", hash: "one", kind: "summary" }] },
        wiki_two: { chunks: [{ vector: "old-two", hash: "two", kind: "summary" }] },
      },
    }, null, 2);
    const vault = fakeVault({ [oldCachePath]: oldRawCache });
    const similarity = new PageSimilarityService({
      mode: "embedding",
      topK: 10,
      baseUrl: "http://127.0.0.1:9",
      apiKey: "fake",
      model: "fake",
      dimensions: 2,
    });
    const refresh = await similarity.refreshCache?.(
      "!Wiki/work",
      vault,
      new Map([
        ["wiki_one", "one description"],
        ["wiki_two", "two description"],
      ]),
      new Map([["wiki_one", "# One\n\n## Body\nupdated body"]]),
    );
    const rawAfterPartial = await vault.read(oldCachePath);
    check("partial v2 upgrade skips writes", refresh?.updated === 0);
    check("partial v2 upgrade leaves raw cache unchanged", rawAfterPartial === oldRawCache);

    const ingestShapeVault = fakeVault({ [oldCachePath]: oldRawCache });
    const ingestShapeSimilarity = new PageSimilarityService({
      mode: "embedding",
      topK: 10,
      baseUrl: "http://127.0.0.1:9",
      apiKey: "fake",
      model: "fake",
      dimensions: 2,
    });
    const ingestShapeRefresh = await ingestShapeSimilarity.refreshCache?.(
      "!Wiki/work",
      ingestShapeVault,
      new Map([["wiki_one", "one updated description"]]),
      new Map([["wiki_one", "# One\n\n## Body\nupdated body"]]),
    );
    const rawAfterIngestShape = await ingestShapeVault.read(oldCachePath);
    check("ingest-shape partial v2 upgrade skips writes", ingestShapeRefresh?.updated === 0);
    check("ingest-shape partial v2 upgrade leaves raw cache unchanged", rawAfterIngestShape === oldRawCache);

    const staleRawCache = JSON.stringify({
      version: 2,
      model: "fake",
      dimensions: 2,
      entries: {
        wiki_one: { chunks: [{ vector: "old-one", hash: "one", kind: "summary" }] },
        wiki_stale: { chunks: [{ vector: "old-stale", hash: "stale", kind: "summary" }] },
      },
    }, null, 2);
    const fullVault = fakeVault({ [oldCachePath]: staleRawCache });
    const fullSimilarity = new PageSimilarityService({
      mode: "embedding",
      topK: 10,
      baseUrl: "http://fake.local",
      apiKey: "fake",
      model: "fake",
      dimensions: 2,
    });
    const fullRefresh = await fullSimilarity.refreshCache?.(
      "!Wiki/work",
      fullVault,
      new Map([["wiki_one", "one current description"]]),
      new Map([["wiki_one", "# One\n\n## Body\ncurrent body"]]),
      { fullCorpus: true },
    );
    const fullCacheAfter = JSON.parse(await fullVault.read(oldCachePath)) as EmbeddingCacheFile;
    check("full v2 rebuild with stale old pid writes vectors", (fullRefresh?.updated ?? 0) > 0);
    check("full v2 rebuild writes version 3", fullCacheAfter.version === 3);
    check("full v2 rebuild drops stale old pid", !("wiki_stale" in fullCacheAfter.entries));
    check("full v2 rebuild keeps current pid", "wiki_one" in fullCacheAfter.entries);

    const currentInputs = buildChunkInputs(
      "one current description",
      "# One\n\n## Body\ncurrent body",
      DEFAULT_CHUNKING,
    );
    const staleV3RawCache = JSON.stringify({
      version: 3,
      model: "fake",
      dimensions: 2,
      entries: {
        wiki_one: {
          chunks: currentInputs.map((input) => ({
            vector: encodeVector(new Float32Array([1, 0])),
            hash: input.hash,
            kind: input.kind,
            heading: input.heading,
            ordinal: input.ordinal,
          })),
        },
        wiki_deleted: { chunks: [{ vector: encodeVector(new Float32Array([0, 1])), hash: "deleted", kind: "summary" }] },
      },
    }, null, 2);
    const staleV3Vault = fakeVault({ [oldCachePath]: staleV3RawCache });
    const staleV3Similarity = new PageSimilarityService({
      mode: "embedding",
      topK: 10,
      baseUrl: "http://fake.local",
      apiKey: "fake",
      model: "fake",
      dimensions: 2,
    });
    await staleV3Similarity.refreshCache?.(
      "!Wiki/work",
      staleV3Vault,
      new Map([["wiki_one", "one current description"]]),
      new Map([["wiki_one", "# One\n\n## Body\ncurrent body"]]),
      { fullCorpus: true },
    );
    const staleV3After = JSON.parse(await staleV3Vault.read(oldCachePath)) as EmbeddingCacheFile;
    check("full v3 refresh drops stale old pid", !("wiki_deleted" in staleV3After.entries));

    const denseSimilarity = new PageSimilarityService({
      mode: "embedding",
      topK: 2,
      baseUrl: "http://fake.local",
      apiKey: "fake",
      model: "fake",
      dimensions: 2,
    });
    denseSimilarity.setCacheForTest?.({
      version: 3,
      model: "fake",
      dimensions: 2,
      entries: {
        wiki_good_summary: {
          chunks: [{ vector: encodeVector(new Float32Array([0.8, 0.6])), hash: "good-summary", kind: "summary" }],
        },
        wiki_section_leak: {
          chunks: [
            { vector: encodeVector(new Float32Array([0, 1])), hash: "leak-summary", kind: "summary" },
            { vector: encodeVector(new Float32Array([1, 0])), hash: "leak-section", kind: "section" },
          ],
        },
      },
    });
    const dense = await denseSimilarity.selectRelevantScoredDiag?.(
      "query vector",
      new Map([
        ["wiki_good_summary", "good summary"],
        ["wiki_section_leak", "section leak"],
      ]),
      [
        "!Wiki/work/Entity/wiki_good_summary.md",
        "!Wiki/work/Entity/wiki_section_leak.md",
      ],
    );
    check("seed dense scoring ignores section vectors", dense?.results[0]?.path.endsWith("wiki_good_summary.md") === true);
    const selected = await denseSimilarity.selectRelevant?.(
      "query vector",
      new Map([
        ["wiki_good_summary", "good summary"],
        ["wiki_section_leak", "section leak"],
      ]),
      [
        "!Wiki/work/Entity/wiki_good_summary.md",
        "!Wiki/work/Entity/wiki_section_leak.md",
      ],
    );
    check("selectRelevant ignores section vectors", selected?.[0]?.endsWith("wiki_good_summary.md") === true);
    const entitySelected = await denseSimilarity.selectByEntities?.(
      [{ name: "query vector" }],
      new Map([
        ["wiki_good_summary", "good summary"],
        ["wiki_section_leak", "section leak"],
      ]),
      [
        "!Wiki/work/Entity/wiki_good_summary.md",
        "!Wiki/work/Entity/wiki_section_leak.md",
      ],
    );
    const entityTop = [...(entitySelected?.results.values() ?? [])][0]?.[0] ?? "";
    check("entity retrieval ignores section vectors", entityTop.endsWith("wiki_good_summary.md"));
  }

  section("chunk context rendering");
  {
    const chunks: SelectedChunk[] = [
      {
        articleId: "wiki_embeddings",
        path: "!Wiki/work/Entity/wiki_embeddings.md",
        heading: "## Cache format",
        body: "Embedding cache stores summary and section vectors.",
        score: 0.9,
        source: "seed",
        ordinal: 0,
      },
    ];
    const rendered = renderContextChunks?.(chunks) ?? "";
    check("context includes article id", rendered.includes("article: wiki_embeddings"));
    check("context includes heading", rendered.includes("heading: ## Cache format"));
    check("context includes body", rendered.includes("Embedding cache stores summary and section vectors."));
    check("context omits full page path wrapper", !rendered.includes("--- !Wiki/work/Entity/wiki_embeddings.md ---"));
  }

  section("Jaccard chunk ranking filters graph noise");
  {
    const pages = new Map<string, string>([
      ["!Wiki/work/Entity/wiki_seed.md", "# Seed\n\n## Main\nseed page links to [[wiki_graph_relevant]] and [[wiki_graph_noise]]"],
      ["!Wiki/work/Entity/wiki_graph_relevant.md", "# Relevant\n\n## Evidence\nneural chunk retrieval evidence"],
      ["!Wiki/work/Entity/wiki_graph_noise.md", "# Noise\n\n## Other\nunrelated cooking notes"],
    ]);
    const similarity = new PageSimilarityService({ mode: "jaccard", topK: 10 });
    const chunks = await similarity.selectRelevantChunks?.(
      "neural retrieval",
      pages,
      new Set(["wiki_seed", "wiki_graph_relevant", "wiki_graph_noise"]),
      new Set(["wiki_seed"]),
      { wiki_seed: 1, wiki_graph_relevant: 0.8, wiki_graph_noise: 0.2 },
      5,
    ) ?? [];
    const ids = chunks.map((chunk) => chunk.articleId);
    check("relevant graph chunk selected", ids.includes("wiki_graph_relevant"), ids.join(","));
    check("irrelevant graph article excluded", !ids.includes("wiki_graph_noise"), ids.join(","));
    check("selected chunks carry headings", chunks.every((chunk) => chunk.heading.startsWith("## ")));
  }

  section("query flows render chunks");
  {
    const files = {
      "!Wiki/work/_config/_index.md": "- [[wiki_seed]] - seed description neural retrieval",
      "!Wiki/work/Entity/wiki_seed.md": [
        "---",
        "description: seed description neural retrieval",
        "---",
        "# Seed",
        "",
        "## Main",
        "neural retrieval seed body",
        "[[wiki_graph_relevant]] [[wiki_graph_noise]]",
      ].join("\n"),
      "!Wiki/work/Entity/wiki_graph_relevant.md": "# Relevant\n\n## Evidence\nneural chunk retrieval evidence",
      "!Wiki/work/Entity/wiki_graph_noise.md": "# Noise\n\n## Other\nunrelated cooking notes",
    };
    const vault = fakeVault(files);
    const { llm, prompts } = fakeLlm("Answer about [[wiki_graph_relevant]].");
    const events = await drive(runQuery(
      ["neural retrieval"], false, vault, llm, "fake-model", [dom("work")], "", new AbortController().signal,
      1, {}, 5, 0, 10, undefined, 3, 0, false, 60,
    ) as AsyncGenerator<RunEvent, void>);
    const queryStats = events.find((event) => event.kind === "query_stats") as Extract<RunEvent, { kind: "query_stats" }> | undefined;
    const evalMeta = events.find((event) => event.kind === "eval_meta") as Extract<RunEvent, { kind: "eval_meta" }> | undefined;
    const promptText = prompts().join("\n");

    check("single-domain emits chunksSelected", typeof queryStats?.chunksSelected === "number" && queryStats.chunksSelected > 0);
    check("single-domain context includes chunk heading", promptText.includes("heading: ## Evidence") || promptText.includes("heading: ## Main"));
    check("single-domain context excludes graph noise", !promptText.includes("unrelated cooking notes"));
    check("single-domain eval has found_chunks", Array.isArray(evalMeta?.fields.found_chunks));

    const crossVault = fakeVault({
      ...files,
      "!Wiki/home/_config/_index.md": "- [[wiki_home_seed]] - home description neural retrieval",
      "!Wiki/home/Entity/wiki_home_seed.md": "# Home\n\n## Home Evidence\nneural retrieval home evidence",
    });
    const cross = fakeLlm("Cross answer.");
    const crossEvents = await drive(runCrossDomainQuery(
      "neural retrieval",
      crossVault,
      cross.llm,
      "fake-model",
      [dom("work"), dom("home")],
      new AbortController().signal,
      { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 },
      60,
      3,
      {},
    ));
    const crossStats = crossEvents.find((event) => event.kind === "query_stats") as Extract<RunEvent, { kind: "query_stats" }> | undefined;
    const crossPrompt = cross.prompts().join("\n");
    check("cross-domain emits chunksSelected", typeof crossStats?.chunksSelected === "number" && crossStats.chunksSelected > 0);
    check("cross-domain context includes chunk marker", crossPrompt.includes("--- article:"));
    check("cross-domain context excludes full path wrapper", !crossPrompt.includes("--- !Wiki/"));
  }

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} - ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:\n" + failures.map((item) => `  - ${item}`).join("\n"));
    process.exit(1);
  }
}

void main();
