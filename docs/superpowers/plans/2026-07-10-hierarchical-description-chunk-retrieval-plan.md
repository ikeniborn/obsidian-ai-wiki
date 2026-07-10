---
review:
  plan_hash: 4dd294c5dbcbacfd
  last_run: 2026-07-10
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-10-hierarchical-description-chunk-retrieval-intent.md
  spec: docs/superpowers/specs/2026-07-10-hierarchical-description-chunk-retrieval-design.md
---
# Hierarchical Description-to-Chunk Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace description-prefixed section retrieval with hierarchical description seed selection, graph article expansion, and clean chunk context.

**Architecture:** `src/page-similarity.ts` owns cache versioning, clean chunk construction, and chunk ranking. `src/phases/query.ts` and `src/phases/query-cross-domain.ts` keep article-pool retrieval but switch final context rendering from full pages to selected chunks. Eval scripts prove cache shape, fallback behavior, graph filtering, single-domain context, and cross-domain context.

**Tech Stack:** TypeScript, Obsidian plugin APIs, existing `tsx` eval harnesses, existing embedding/Jaccard retrieval helpers, iwiki MCP for documentation evidence.

---

## File Structure

- Modify `src/page-similarity.ts`
  - Bump embedding cache version from `2` to `3`.
  - Preserve `summary` chunks as description vectors.
  - Build `section` chunks from `heading + "\n" + window` only.
  - Add selected chunk types and ranking helpers.
- Modify `src/phases/query.ts`
  - Use article candidates from the current seed and graph flow.
  - Call chunk ranking after graph expansion.
  - Render selected chunk context instead of full page context.
  - Emit `chunksSelected` and candidate-pool diagnostics.
- Modify `src/phases/query-cross-domain.ts`
  - Keep cross-domain article merge.
  - Rank chunks inside the merged final article pool.
  - Render selected chunk context and emit chunk diagnostics.
- Modify `src/types.ts`
  - Extend `query_stats` with `chunksSelected` and `candidatePages`.
- Modify `src/eval-log.ts`
  - Extend retrieval config and eval metadata with hierarchical retrieval and selected chunk diagnostics.
- Create `eval/hierarchical-retrieval/run.ts`
  - Deterministic out-of-vault eval covering clean chunks, cache version, graph filtering, Jaccard fallback, single-domain query, and cross-domain query.
- Create `eval/hierarchical-retrieval/register.ts`
  - Reuse the existing markdown-loader and Obsidian stub pattern from `eval/cross-domain/register.ts`.
- Modify iwiki page for retrieval behavior after implementation.

## Task 1: Write Hierarchical Retrieval Eval Harness

**Covers:** R1, R3, R4, R5, R6, R7

**Files:**
- Create: `eval/hierarchical-retrieval/register.ts`
- Create: `eval/hierarchical-retrieval/run.ts`

- [ ] **Step 1.1: Create eval register file**

Create `eval/hierarchical-retrieval/register.ts` with the same loader purpose as the cross-domain eval:

```ts
import "../cross-domain/register";
```

Expected result: imports of prompt markdown and Obsidian APIs work in the new eval.

- [ ] **Step 1.2: Add failing eval scaffold**

Create `eval/hierarchical-retrieval/run.ts` with this scaffold:

```ts
import "./register";
import {
  DEFAULT_CHUNKING,
  PageSimilarityService,
  buildChunkInputs,
  renderContextChunks,
  type EmbeddingCacheFile,
  type SelectedChunk,
} from "../../src/page-similarity";
import { runCrossDomainQuery } from "../../src/phases/query-cross-domain";
import { runQuery } from "../../src/phases/query";
import type { DomainEntry } from "../../src/domain";
import type { LlmClient, RunEvent } from "../../src/types";
import type { VaultTools } from "../../src/vault-tools";

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

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} - ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:\n" + failures.map((item) => `  - ${item}`).join("\n"));
    process.exit(1);
  }
}

void main();
```

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: PASS with only the scaffold case.

- [ ] **Step 1.3: Add failing clean chunk and cache tests**

Add this block inside `main()` after the scaffold section:

```ts
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
}
```

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: FAIL because `ChunkInput` lacks `heading` and `ordinal`, and `EmbeddingCacheFile.version` is still `2`.

- [ ] **Step 1.4: Add failing chunk rendering test**

Add this block inside `main()`:

```ts
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
  const rendered = renderContextChunks(chunks);
  check("context includes article id", rendered.includes("article: wiki_embeddings"));
  check("context includes heading", rendered.includes("heading: ## Cache format"));
  check("context includes body", rendered.includes("Embedding cache stores summary and section vectors."));
  check("context omits full page path wrapper", !rendered.includes("--- !Wiki/work/Entity/wiki_embeddings.md ---"));
}
```

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: FAIL because `SelectedChunk` and `renderContextChunks` do not exist.

- [ ] **Step 1.5: Add failing Jaccard graph filtering test**

Add this block inside `main()`:

```ts
section("Jaccard chunk ranking filters graph noise");
{
  const pages = new Map<string, string>([
    ["!Wiki/work/Entity/wiki_seed.md", "# Seed\n\n## Main\nseed page links to [[wiki_graph_relevant]] and [[wiki_graph_noise]]"],
    ["!Wiki/work/Entity/wiki_graph_relevant.md", "# Relevant\n\n## Evidence\nneural chunk retrieval evidence"],
    ["!Wiki/work/Entity/wiki_graph_noise.md", "# Noise\n\n## Other\nunrelated cooking notes"],
  ]);
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: 10 });
  const chunks = await similarity.selectRelevantChunks(
    "neural retrieval",
    pages,
    new Set(["wiki_seed", "wiki_graph_relevant", "wiki_graph_noise"]),
    new Set(["wiki_seed"]),
    { wiki_seed: 1, wiki_graph_relevant: 0.8, wiki_graph_noise: 0.2 },
    5,
  );
  const ids = chunks.map((chunk) => chunk.articleId);
  check("relevant graph chunk selected", ids.includes("wiki_graph_relevant"), ids.join(","));
  check("irrelevant graph article excluded", !ids.includes("wiki_graph_noise"), ids.join(","));
  check("selected chunks carry headings", chunks.every((chunk) => chunk.heading.startsWith("## ")));
}
```

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: FAIL because `selectRelevantChunks` does not exist.

- [ ] **Step 1.6: Add failing single-domain and cross-domain context tests**

Add this block inside `main()`:

```ts
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
```

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: FAIL because query flows still render full pages and do not emit `chunksSelected` or `found_chunks`.

## Task 2: Implement Clean Cache Inputs And Chunk Metadata

**Covers:** R1

**Files:**
- Modify: `src/page-similarity.ts`
- Test: `eval/hierarchical-retrieval/run.ts`

- [ ] **Step 2.1: Extend chunk metadata types**

Modify `src/page-similarity.ts` type declarations:

```ts
export interface EmbeddingChunk {
  vector: string;  // base64 Float32Array
  hash: string;
  kind: "summary" | "section";
  heading?: string;
  ordinal?: number;
}

export interface EmbeddingCacheFile {
  version: 3;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

export interface ChunkInput {
  kind: "summary" | "section";
  embedText: string;
  hash: string;
  heading?: string;
  window?: string;
  ordinal?: number;
}
```

Expected result: TypeScript now allows section metadata and rejects version `2` cache construction.

- [ ] **Step 2.2: Build clean section chunk inputs**

Modify `buildChunkInputs` in `src/page-similarity.ts`:

```ts
export function buildChunkInputs(
  annotation: string,
  body: string,
  chunking: ChunkingConfig,
): ChunkInput[] {
  const inputs: ChunkInput[] = [
    { kind: "summary", embedText: annotation, hash: annotationHash(`summary\n${annotation}`) },
  ];
  splitSections(body, chunking).forEach(({ heading, window }, ordinal) => {
    const embedText = `${heading}\n${window}`.trim();
    inputs.push({
      kind: "section",
      embedText,
      hash: annotationHash(`section\n${ordinal}\n${embedText}`),
      heading,
      window,
      ordinal,
    });
  });
  return inputs;
}
```

Expected result: section inputs are independent from article descriptions.

- [ ] **Step 2.3: Bump cache version checks and writes**

In `loadCache`, accept only `parsed.version === 3`:

```ts
if (parsed.version === 3 && parsed.model === model && parsed.dimensions === dimensions) {
  this.cache = parsed;
}
```

In `refreshCache`, initialize cache files with version `3`:

```ts
cacheFile =
  parsed.version === 3 && parsed.model === model && parsed.dimensions === dimensions
    ? parsed
    : { version: 3, model, dimensions, entries: {} };
```

and:

```ts
cacheFile = { version: 3, model, dimensions, entries: {} };
```

Expected result: old version `2` vectors are ignored and rebuilt.

- [ ] **Step 2.4: Preserve metadata when reusing and writing chunks**

In `refreshCache`, replace the old hash-to-vector map with hash-to-chunk reuse:

```ts
const oldByHash = new Map(
  (cacheFile.entries[pid]?.chunks ?? []).map((chunk) => [chunk.hash, chunk]),
);
```

When iterating inputs, preserve heading and ordinal:

```ts
for (const { kind, embedText, hash, heading, ordinal } of inputs) {
  const reuse = oldByHash.get(hash);
  chunks.push({
    vector: reuse?.vector ?? "",
    hash,
    kind,
    heading,
    ordinal,
  });
  if (reuse === undefined) pending.push({ pid, idx: chunks.length - 1, embedText });
}
```

Expected result: cached section vectors carry the metadata needed to map back to split sections.

- [ ] **Step 2.5: Run focused eval**

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: clean chunk and cache-version checks pass; later task checks still fail.

- [ ] **Step 2.6: Commit Task 2**

Run:

```bash
git add src/page-similarity.ts eval/hierarchical-retrieval/register.ts eval/hierarchical-retrieval/run.ts
git commit -m "feat(retrieval): build clean section embedding chunks"
```

Expected: commit contains eval harness plus cache/input changes.

## Task 3: Implement Selected Chunk Ranking And Rendering

**Covers:** R3, R5, R6

**Files:**
- Modify: `src/page-similarity.ts`
- Test: `eval/hierarchical-retrieval/run.ts`

- [ ] **Step 3.1: Add selected chunk types**

Add near the chunk input types in `src/page-similarity.ts`:

```ts
export interface SelectedChunk {
  articleId: string;
  path: string;
  heading: string;
  body: string;
  score: number;
  source: "seed" | "graph";
  articleScore?: number;
  ordinal: number;
}

interface CandidateSection {
  articleId: string;
  path: string;
  heading: string;
  body: string;
  embedText: string;
  hash: string;
  source: "seed" | "graph";
  articleScore?: number;
  ordinal: number;
}
```

Expected result: selected chunks have the context and diagnostic fields required by the spec.

- [ ] **Step 3.2: Add candidate section collection helper**

Add this helper in `src/page-similarity.ts`:

```ts
function collectCandidateSections(
  pages: Map<string, string>,
  candidateIds: Set<string>,
  seedIds: Set<string>,
  articleScores: Record<string, number>,
  chunking: ChunkingConfig,
): CandidateSection[] {
  const sections: CandidateSection[] = [];
  for (const [path, content] of pages) {
    const articleId = pageId(path);
    if (!candidateIds.has(articleId)) continue;
    splitSections(content, chunking).forEach(({ heading, window }, ordinal) => {
      const embedText = `${heading}\n${window}`.trim();
      if (!embedText) return;
      sections.push({
        articleId,
        path,
        heading,
        body: window,
        embedText,
        hash: annotationHash(`section\n${ordinal}\n${embedText}`),
        source: seedIds.has(articleId) ? "seed" : "graph",
        articleScore: articleScores[articleId],
        ordinal,
      });
    });
  }
  return sections;
}
```

Expected result: chunk ranking uses the same clean section text as cache construction.

- [ ] **Step 3.3: Add deterministic selected chunk ordering**

Add this helper in `src/page-similarity.ts`:

```ts
function sortSelectedChunks(items: SelectedChunk[]): SelectedChunk[] {
  return items.sort((a, b) =>
    (b.score - a.score) ||
    (Number(b.source === "seed") - Number(a.source === "seed")) ||
    ((b.articleScore ?? 0) - (a.articleScore ?? 0)) ||
    a.articleId.localeCompare(b.articleId) ||
    (a.ordinal - b.ordinal)
  );
}
```

Expected result: ties are stable and seed chunks win over graph chunks at equal chunk score.

- [ ] **Step 3.4: Add Jaccard chunk ranking**

Add this helper in `src/page-similarity.ts`:

```ts
function rankChunksJaccard(queryTokens: Set<string>, sections: CandidateSection[], limit: number): SelectedChunk[] {
  const scored: SelectedChunk[] = [];
  for (const section of sections) {
    const score = scoreSeed(queryTokens, section.articleId, section.embedText);
    if (score <= 0) continue;
    scored.push({
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      score,
      source: section.source,
      articleScore: section.articleScore,
      ordinal: section.ordinal,
    });
  }
  return sortSelectedChunks(scored).slice(0, limit);
}
```

Expected result: fallback scores clean chunks, not article descriptions or full pages.

- [ ] **Step 3.5: Add `selectRelevantChunks` to `PageSimilarityService`**

Add this public method inside `PageSimilarityService`:

```ts
async selectRelevantChunks(
  query: string,
  pages: Map<string, string>,
  candidateIds: Set<string>,
  seedIds: Set<string>,
  articleScores: Record<string, number>,
  limit: number,
): Promise<SelectedChunk[]> {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0 || candidateIds.size === 0 || limit <= 0) return [];
  const chunking = this.config.chunking ?? DEFAULT_CHUNKING;
  const sections = collectCandidateSections(pages, candidateIds, seedIds, articleScores, chunking);
  if (sections.length === 0) return [];
  if (this.config.mode === "jaccard") return rankChunksJaccard(queryTokens, sections, limit);

  const { baseUrl, apiKey, model } = this.config;
  if (!baseUrl || !model) return rankChunksJaccard(queryTokens, sections, limit);

  let queryVec: Float32Array;
  try {
    [queryVec] = await fetchEmbeddings(baseUrl, apiKey ?? "", model, [query.slice(0, 2000)], this.config.dimensions);
  } catch {
    return rankChunksJaccard(queryTokens, sections, limit);
  }

  const vectors = new Map<string, Float32Array>();
  if (this.cache && this.cache.model === model) {
    for (const section of sections) {
      const entry = this.cache.entries[section.articleId];
      const cached = entry?.chunks.find((chunk) => chunk.kind === "section" && chunk.hash === section.hash && chunk.vector);
      if (cached) vectors.set(section.hash, decodeVector(cached.vector));
    }
  }

  const missing = sections.filter((section) => !vectors.has(section.hash));
  for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, batch.map((section) => section.embedText), this.config.dimensions);
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) vectors.set(batch[j].hash, vecs[j]);
      }
    } catch {
      return rankChunksJaccard(queryTokens, sections, limit);
    }
  }

  const scored: SelectedChunk[] = [];
  for (const section of sections) {
    const vec = vectors.get(section.hash);
    if (!vec) continue;
    const score = maxCosine(queryVec, [vec]);
    if (score <= 0) continue;
    scored.push({
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      score,
      source: section.source,
      articleScore: section.articleScore,
      ordinal: section.ordinal,
    });
  }
  return sortSelectedChunks(scored).slice(0, limit);
}
```

Expected result: embedding chunk ranking uses cached clean section vectors when present and falls back to Jaccard on any embedding failure.

- [ ] **Step 3.6: Add chunk context renderer**

Add this exported function in `src/page-similarity.ts`:

```ts
export function renderContextChunks(chunks: SelectedChunk[]): string {
  return chunks
    .map((chunk) => [
      `--- article: ${chunk.articleId}, heading: ${chunk.heading} ---`,
      chunk.body,
    ].join("\n"))
    .join("\n\n");
}
```

Expected result: context format includes article id, heading, and body without full page wrappers.

- [ ] **Step 3.7: Run focused eval**

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: clean chunk, cache-version, rendering, and Jaccard graph-filtering checks pass; query-flow checks still fail.

- [ ] **Step 3.8: Commit Task 3**

Run:

```bash
git add src/page-similarity.ts eval/hierarchical-retrieval/run.ts
git commit -m "feat(retrieval): rank clean chunks inside article pools"
```

Expected: commit contains selected chunk ranking and renderer.

## Task 4: Integrate Chunk Context Into Single-Domain Query

**Covers:** R2, R3, R4, R5, R6

**Files:**
- Modify: `src/types.ts`
- Modify: `src/eval-log.ts`
- Modify: `src/phases/query.ts`
- Test: `eval/hierarchical-retrieval/run.ts`
- Test: `eval/cross-domain/run.ts`

- [ ] **Step 4.1: Extend query stats and eval metadata types**

In `src/types.ts`, extend `query_stats`:

```ts
chunksSelected?: number;
candidatePages?: number;
```

In `src/eval-log.ts`, extend `RetrievalConfigSnapshot` and `EvalMetaFields`:

```ts
hierarchicalChunkRetrieval?: boolean;
```

and:

```ts
found_chunks?: { articleId: string; heading: string; score: number }[];
```

Expected result: diagnostics can record article-pool size and final chunk count.

- [ ] **Step 4.2: Import chunk helpers in single-domain query**

In `src/phases/query.ts`, change the import from `page-similarity`:

```ts
import { PageSimilarityService, renderContextChunks, type SelectedChunk } from "../page-similarity";
```

Expected result: `query.ts` can call the chunk selector and renderer.

- [ ] **Step 4.3: Replace full-page context selection in `runQuery`**

Replace the `contextPages` and `contextBlock` construction after `fusedOrder` with:

```ts
const finalArticleIds = bfsFusion && fusedOrder
  ? new Set(fusedOrder.filter((id) => selectedIds.has(id)).slice(0, topK * 3))
  : selectedIds;
const articleScores = { ...expandedScores, ...seedScores };
const chunkLimit = topK * 3;
const fallbackSimilarity = new PageSimilarityService({ mode: "jaccard", topK: chunkLimit });
const chunkSimilarity = similarity ?? fallbackSimilarity;
const selectedChunks: SelectedChunk[] = await chunkSimilarity.selectRelevantChunks(
  question, pages, finalArticleIds, seedSet, articleScores, chunkLimit,
);
if (selectedChunks.length === 0) {
  yield { kind: "error", message: "No relevant pages found for this query." };
  return;
}
const contextBlock = renderContextChunks(selectedChunks);
const finalSelectedIds = new Set(selectedChunks.map((chunk) => chunk.articleId));
```

Expected result: single-domain query context is chunk-based and never uses `renderContextPages` on the final path.

- [ ] **Step 4.4: Update link target list and answer call**

Replace later uses of `selectedIds` for final answer context with `finalSelectedIds` where the value describes final context articles:

```ts
const wikiFirst = [...finalSelectedIds].sort((a, b) =>
  Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
```

and in `answerFromContext`:

```ts
selectedIds: finalSelectedIds,
```

Expected result: WikiLink validation allows only articles represented by selected chunks.

- [ ] **Step 4.5: Update single-domain query stats and eval metadata**

Replace page-context counts with selected chunk diagnostics:

```ts
const seedCount = [...finalSelectedIds].filter((id) => seedSet.has(id)).length;
const graphCount = finalSelectedIds.size - seedCount;

yield {
  kind: "query_stats",
  crossDomain: false,
  domainName: domain.name,
  pagesScanned: cand.pagesScanned,
  pagesSelected: finalSelectedIds.size,
  candidatePages: selectedIds.size,
  chunksSelected: selectedChunks.length,
  seedCount,
  graphCount,
};
```

In `eval_meta.fields`, use:

```ts
found_pages: [...finalSelectedIds],
found_chunks: selectedChunks.map((chunk) => ({
  articleId: chunk.articleId,
  heading: chunk.heading,
  score: chunk.score,
})),
retrievalConfig: {
  mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
  seedTopK,
  bfsTopK,
  bfsMinScoreRatio,
  bfsFusion,
  seedSimilarityThreshold,
  hybridRetrieval: similarity?.config.mode === "hybrid",
  hierarchicalChunkRetrieval: true,
},
```

Expected result: eval output records final chunks and keeps `found_pages` compatible.

- [ ] **Step 4.6: Keep legacy context helpers for non-query callers**

Leave `buildContextBlock`, `selectContextPages`, and `renderContextPages` in `src/phases/query.ts` unless lint proves they are unused exports with no callers. Do not delete them in this task.

Run:

```bash
rg -n "buildContextBlock|selectContextPages|renderContextPages" src eval
```

Expected: remaining references are understood before any deletion. For this task, the accepted result is that single-domain `runQuery` no longer calls `renderContextPages` for final context.

- [ ] **Step 4.7: Run single-domain evals**

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
npx tsx eval/cross-domain/run.ts
```

Expected: hierarchical single-domain checks pass. Existing cross-domain eval may fail until Task 5 updates cross-domain expectations.

- [ ] **Step 4.8: Commit Task 4**

Run:

```bash
git add src/types.ts src/eval-log.ts src/phases/query.ts eval/hierarchical-retrieval/run.ts
git commit -m "feat(retrieval): use chunk context for single-domain queries"
```

Expected: commit contains single-domain chunk-context integration.

## Task 5: Integrate Chunk Context Into Cross-Domain Query

**Covers:** R4, R7

**Files:**
- Modify: `src/phases/query-cross-domain.ts`
- Modify: `eval/cross-domain/run.ts`
- Modify: `eval/hierarchical-retrieval/run.ts`

- [ ] **Step 5.1: Import chunk helpers in cross-domain query**

In `src/phases/query-cross-domain.ts`, replace the `buildContextBlock` import and add chunk imports:

```ts
import { retrieveDomainCandidates, type RetrieveCfg } from "./query";
import { PageSimilarityService, renderContextChunks, type SelectedChunk } from "../page-similarity";
```

Expected result: cross-domain flow no longer depends on full-page context rendering.

- [ ] **Step 5.2: Rank chunks inside merged final article pool**

Replace the `contextBlock = buildContextBlock(...)` line with:

```ts
const fallbackSimilarity = new PageSimilarityService({ mode: "jaccard", topK: cfg.seedTopK * 3 });
const chunkSimilarity = similarity ?? fallbackSimilarity;
const articleScores = { ...merged.mergedExpandedScores, ...merged.mergedSeedScores };
const selectedChunks: SelectedChunk[] = await chunkSimilarity.selectRelevantChunks(
  q,
  merged.mergedPages,
  finalSet,
  merged.mergedSeedSet,
  articleScores,
  Math.max(1, Math.min(50, Math.floor(cfg.seedTopK))) * 3,
);
if (selectedChunks.length === 0) {
  yield { kind: "error", message: "No relevant pages found across domains." };
  return;
}
const contextBlock = renderContextChunks(selectedChunks);
const finalChunkIds = new Set(selectedChunks.map((chunk) => chunk.articleId));
```

Expected result: only chunks from the final merged article pool enter cross-domain context.

- [ ] **Step 5.3: Use selected chunk article ids for final domains and links**

Replace `finalSet` with `finalChunkIds` in final-domain detection and WikiLink targets:

```ts
const finalDomains = [...new Set(
  poolList
    .filter((candidate) => [...candidate.candidateIds].some((id) => finalChunkIds.has(id)))
    .map((candidate) => candidate.domainId)
)];
```

and:

```ts
const wikiFirst = [...finalChunkIds].sort((a, b) => Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
```

Pass `selectedIds: finalChunkIds` to `answerFromContext`.

Expected result: validation and available links reflect final chunk articles, not every merged article candidate.

- [ ] **Step 5.4: Update cross-domain stats and eval metadata**

Update `query_stats`:

```ts
yield {
  kind: "query_stats",
  crossDomain: true,
  domainsStudied: poolList.length,
  domainsTotal: domains.length,
  fromDomains: finalNames,
  pagesScanned: poolList.reduce((sum, candidate) => sum + candidate.pagesScanned, 0),
  pagesSelected: finalChunkIds.size,
  candidatePages: finalSet.size,
  chunksSelected: selectedChunks.length,
};
```

Update `eval_meta.fields`:

```ts
found_pages: [...finalChunkIds],
found_chunks: selectedChunks.map((chunk) => ({
  articleId: chunk.articleId,
  heading: chunk.heading,
  score: chunk.score,
})),
retrievalConfig: {
  mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
  seedTopK: cfg.seedTopK,
  bfsTopK: cfg.bfsTopK,
  bfsMinScoreRatio: cfg.bfsMinScoreRatio ?? 0,
  bfsFusion: true,
  seedSimilarityThreshold: cfg.seedSimilarityThreshold,
  hybridRetrieval: similarity?.config.mode === "hybrid",
  hierarchicalChunkRetrieval: true,
  crossDomain: true,
  domainsSearched: domains.length,
},
```

Expected result: cross-domain eval metadata has final chunk diagnostics.

- [ ] **Step 5.5: Update existing cross-domain eval expectations**

In `eval/cross-domain/run.ts`, update assertions that equate `pagesSelected` to `found_pages.length` so they still pass with chunk context:

```ts
check("query_stats.pagesSelected == found_pages length",
  !!qs && !!evalMeta && qs.pagesSelected === (evalMeta.fields.found_pages as string[]).length,
  `pagesSelected=${qs?.pagesSelected}`);
check("query_stats.chunksSelected > 0",
  !!qs && typeof qs.chunksSelected === "number" && qs.chunksSelected > 0,
  `chunksSelected=${qs?.chunksSelected}`);
```

Expected result: existing eval validates chunk stats without expecting full-page context.

- [ ] **Step 5.6: Run query evals**

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
npx tsx eval/cross-domain/run.ts
```

Expected: both eval scripts report `OK`.

- [ ] **Step 5.7: Commit Task 5**

Run:

```bash
git add src/phases/query-cross-domain.ts eval/cross-domain/run.ts eval/hierarchical-retrieval/run.ts
git commit -m "feat(retrieval): use chunk context for cross-domain queries"
```

Expected: commit contains cross-domain chunk-context integration.

## Task 6: Verify Baseline, Build, Lint, And Documentation

**Covers:** R1, R2, R3, R4, R5, R6, R7, R8

**Files:**
- Modify: iwiki page for retrieval behavior
- Modify: repository docs only if an existing retrieval doc is found outside iwiki
- Test: all changed evals

- [ ] **Step 6.1: Run focused evals**

Run:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
npx tsx eval/cross-domain/run.ts
npx tsx eval/retrieval-prune/run.ts
```

Expected: each script reports `OK`.

- [ ] **Step 6.2: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 6.3: Capture latency and quality evidence**

Run the focused retrieval eval once before final documentation notes and record command durations from the shell:

```bash
time npx tsx eval/hierarchical-retrieval/run.ts
```

Expected: eval reports `OK`; elapsed time is recorded in the result summary. If the elapsed time is clearly unsuitable for interactive query flow, stop and escalate before result validation.

- [ ] **Step 6.4: Update iwiki retrieval documentation**

Use iwiki MCP tools:

1. `wiki_status`
2. `wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")`
3. `wiki_search` with query `retrieval query chunks graph context`
4. If a retrieval page exists, update its retrieval section with:

```md
Retrieval now uses a hierarchical flow: article descriptions select seed articles,
wiki graph expansion builds the candidate article pool, and clean section chunks are
ranked inside that pool. Final query context contains only selected chunk bodies with
article identifiers and section headings. Section embedding inputs exclude article
descriptions; Jaccard fallback preserves the same hierarchy when embeddings are not
available.
```

5. If no retrieval page exists, create a retrieval page with that behavior summary and source paths `src/page-similarity.ts`, `src/phases/query.ts`, and `src/phases/query-cross-domain.ts`.
6. Run `wiki_lint(domain="obsidian-ai-wiki")`.

Expected: iwiki documents the new behavior and lint has no broken refs, no stale pages, and no orphan pages introduced by this update.

- [ ] **Step 6.5: Run final git diff review**

Run:

```bash
git diff HEAD
```

Expected: diff contains only retrieval implementation, evals, type metadata, docs/wiki evidence generated by MCP, and chain artifacts. No user-visible setting default changed.

- [ ] **Step 6.6: Commit Task 6**

Run:

```bash
git add src/page-similarity.ts src/phases/query.ts src/phases/query-cross-domain.ts src/types.ts src/eval-log.ts eval/hierarchical-retrieval eval/cross-domain/run.ts docs/TODO.md docs/superpowers/plans/2026-07-10-hierarchical-description-chunk-retrieval-plan.md
git commit -m "test(retrieval): verify hierarchical chunk retrieval"
```

Expected: final implementation branch has focused commits and all verification evidence is ready for `$check-chain result`.

## Coverage Map

| Spec requirement | Plan coverage |
|---|---|
| R1. Section embedding inputs exclude article descriptions | Task 1.3, Task 2 |
| R2. Article seed selection uses descriptions | Task 4.5 diagnostics, existing `collectDescriptions` seed flow preserved |
| R3. Graph expansion precedes final chunk retrieval | Task 1.5, Task 4.3, Task 5.2 |
| R4. Final context renders selected chunks only | Task 1.4, Task 4, Task 5 |
| R5. Graph-derived articles require relevant chunks | Task 1.5, Task 3.4, Task 3.5 |
| R6. Jaccard fallback preserves hierarchy | Task 1.5, Task 3.4, Task 3.5 |
| R7. Cross-domain uses same context shape | Task 1.6, Task 5 |
| R8. No user-visible settings/default changes | Task 6.5 |

## Verification Summary

Required commands before result validation:

```bash
npx tsx eval/hierarchical-retrieval/run.ts
npx tsx eval/cross-domain/run.ts
npx tsx eval/retrieval-prune/run.ts
npm run lint
npm run build
```

Expected final state:

- Section chunk embedding input is clean.
- Cache version is `3`.
- Single-domain and cross-domain query context uses selected chunks.
- `chunksSelected` and `found_chunks` diagnostics are present.
- Jaccard fallback works without embeddings.
- iwiki documents the new retrieval behavior.
