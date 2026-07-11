---
review:
  plan_hash: 5c39df899796df85
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-lexical-retrieval-quality-intent.md
  spec: docs/superpowers/specs/2026-07-11-lexical-retrieval-quality-design.md
---
# Lexical Retrieval Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain Jaccard lexical ranking with a deterministic weighted lexical scorer shared by runtime Query and the HLD JSONL eval harness, reaching `avg Overlap@5 >= 0.65`.

**Architecture:** Add one Obsidian-free scorer module in `src/lexical-retrieval.ts`. Runtime seed/page ranking keeps existing public APIs but delegates scoring to the shared module; runtime chunk fallback delegates section ranking to the same scorer. The HLD harness preserves the old baseline for comparison and reports improved page, chunk, fused, and aggregate metrics.

**Tech Stack:** TypeScript, Node test runner via `node --import tsx --test`, existing `rrf` helper, existing JSONL eval harness, Obsidian plugin runtime code, iwiki MCP for docs evidence.

---

## File Structure

- Create `src/lexical-retrieval.ts`
  - Own tokenization, legacy-compatible stop words, page scoring, chunk scoring, deterministic sorting, and page/chunk RRF fusion.
- Create `tests/lexical-retrieval.test.ts`
  - Prove title/path boost, heading boost, length normalization, RRF fusion, empty-query behavior, and deterministic ties.
- Modify `src/wiki-seeds.ts`
  - Keep exports `tokenize`, `scoreSeed`, and `selectSeeds`.
  - Delegate tokenization and page scoring to `src/lexical-retrieval.ts`.
- Modify `src/page-similarity.ts`
  - Replace plain chunk Jaccard fallback with `scoreLexicalChunk`.
  - Keep dense embedding computation untouched.
  - Let `selectJaccardScored`, embedding fallbacks, entity fallback, and hybrid sparse side benefit through `scoreSeed`.
- Modify `tests/page-similarity-jsonl.test.ts`
  - Add focused runtime fallback tests for chunk heading/path ranking and hybrid sparse side behavior.
- Modify `scripts/eval-jsonl-domain-storage.ts`
  - Preserve current baseline scorer locally as `scoreLegacyBaseline`.
  - Rank improved pages/chunks through `lexical-retrieval`.
  - Fuse improved page and chunk ranks with RRF.
  - Add old vs improved `Overlap@5`, `delta`, and aggregate average to result/report.
  - Gate verdict on avg `>= 0.65`, no per-query regression, and all query statuses `accepted`.
- Modify `tests/eval-jsonl-domain-storage.test.ts`
  - Assert report includes old/improved metrics and aggregate avg gate.
- Modify `docs/rag-quality-recommendations.md`
  - Document that lexical retrieval is weighted lexical scoring with page/chunk fusion, still offline.
- Modify iwiki page `jsonl-domain-storage` or retrieval-related page after implementation.
- Modify `docs/TODO.md`
  - Mark `Plan` as passed after plan gate; later close after result gate.

## Constants

Use these current HLD baselines for the no-regression gate:

```ts
const CURRENT_OVERLAP_AT_5: Record<string, number> = {
  "data-export-s3-clickhouse": 0.40,
  "airflow-ha-balancing": 1.00,
  "integrations-consumers-marts": 0.40,
  "migration-gitflame": 0.60,
  "ownership-components": 0.20,
};

const MIN_AVERAGE_OVERLAP_AT_5 = 0.65;
const MAX_LATENCY_GROWTH = 1.25;
```

## Task 1: Add Shared Lexical Scorer Tests

**Files:**
- Create: `tests/lexical-retrieval.test.ts`

- [ ] **Step 1.1: Write failing scorer tests**

Create `tests/lexical-retrieval.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  fuseLexicalRanks,
  rankLexicalChunks,
  rankLexicalPages,
  scoreLexicalChunk,
  scoreLexicalPage,
  tokenizeLexical,
} from "../src/lexical-retrieval";

test("tokenizeLexical keeps current Russian/English token behavior", () => {
  assert.deepEqual([...tokenizeLexical("Какие HLD for S3 и ClickHouse?")].sort(), ["clickhouse", "hld", "s3"]);
});

test("page title and path outrank generic body-only overlap", () => {
  const query = tokenizeLexical("экспорт s3 clickhouse");
  const titleHit = scoreLexicalPage(query, {
    id: "export-s3-clickhouse",
    path: "!Wiki/hld/pages/export-s3-clickhouse.md",
    title: "Export S3 ClickHouse",
    description: "Краткое описание.",
  });
  const bodyOnly = scoreLexicalPage(query, {
    id: "generic",
    path: "!Wiki/hld/pages/generic.md",
    title: "Generic",
    description: "экспорт s3 clickhouse " + "шаблон ".repeat(120),
  });
  assert.ok(titleHit.score > bodyOnly.score);
  assert.ok(titleHit.evidence.title > 0);
  assert.ok(titleHit.evidence.path > 0);
});

test("chunk heading boost outranks body-only overlap", () => {
  const query = tokenizeLexical("airflow балансировка");
  const headed = scoreLexicalChunk(query, {
    articleId: "airflow",
    path: "!Wiki/hld/pages/airflow.md",
    heading: "## Airflow балансировка",
    body: "Краткое решение.",
  });
  const bodyOnly = scoreLexicalChunk(query, {
    articleId: "generic",
    path: "!Wiki/hld/pages/generic.md",
    heading: "## Notes",
    body: "airflow балансировка " + "описание ".repeat(120),
  });
  assert.ok(headed.score > bodyOnly.score);
  assert.ok(headed.evidence.heading > 0);
});

test("length normalization prevents large template text from dominating", () => {
  const query = tokenizeLexical("компоненты ответственность");
  const compact = scoreLexicalChunk(query, {
    articleId: "owner",
    path: "!Wiki/hld/pages/owner.md",
    heading: "## Компоненты",
    body: "зоны ответственности проектов",
  });
  const template = scoreLexicalChunk(query, {
    articleId: "template",
    path: "!Wiki/hld/pages/template.md",
    heading: "## Template",
    body: "компоненты ответственность " + "типовой раздел ".repeat(240),
  });
  assert.ok(compact.score > template.score);
});

test("rankLexicalPages and rankLexicalChunks are deterministic", () => {
  const query = tokenizeLexical("миграция gitflame");
  const pages = rankLexicalPages(query, [
    { id: "b", path: "!Wiki/hld/pages/b.md", title: "GitFlame", description: "миграция" },
    { id: "a", path: "!Wiki/hld/pages/a.md", title: "GitFlame", description: "миграция" },
  ], 2);
  assert.deepEqual(pages.map((page) => page.id), ["a", "b"]);

  const chunks = rankLexicalChunks(query, [
    { articleId: "b", path: "!Wiki/hld/pages/b.md", heading: "## GitFlame", body: "миграция", ordinal: 1 },
    { articleId: "a", path: "!Wiki/hld/pages/a.md", heading: "## GitFlame", body: "миграция", ordinal: 1 },
  ], 2);
  assert.deepEqual(chunks.map((chunk) => chunk.articleId), ["a", "b"]);
});

test("fuseLexicalRanks promotes a page present in both page and chunk ranks", () => {
  const fused = fuseLexicalRanks(
    [{ id: "page-a", score: 0.9 }, { id: "page-b", score: 0.8 }],
    [{ articleId: "page-b", score: 0.95 }, { articleId: "page-c", score: 0.7 }],
    3,
    10,
  );
  assert.equal(fused[0].id, "page-b");
});

test("empty query returns zero scores and empty ranks", () => {
  const empty = tokenizeLexical("и или для");
  assert.equal(scoreLexicalPage(empty, { id: "x", description: "anything" }).score, 0);
  assert.deepEqual(rankLexicalPages(empty, [{ id: "x", description: "anything" }], 5), []);
  assert.deepEqual(rankLexicalChunks(empty, [{ articleId: "x", path: "x.md", body: "anything" }], 5), []);
});
```

- [ ] **Step 1.2: Run the new tests and confirm they fail**

```bash
node --import tsx --test tests/lexical-retrieval.test.ts
```

Expected: fail with module-not-found for `../src/lexical-retrieval`.

- [ ] **Step 1.3: Commit failing tests**

```bash
git add tests/lexical-retrieval.test.ts
git commit -m "test(retrieval): cover weighted lexical scorer"
```

## Task 2: Implement Shared Lexical Scorer and Wire Seed Ranking

**Files:**
- Create: `src/lexical-retrieval.ts`
- Modify: `src/wiki-seeds.ts`

- [ ] **Step 2.1: Implement `src/lexical-retrieval.ts`**

Create `src/lexical-retrieval.ts` with pure scoring helpers. Required exported shape:

```ts
import { rrf } from "./rrf";

export interface LexicalEvidence {
  path: number;
  title: number;
  heading: number;
  description: number;
  body: number;
  exact: number;
  phrase: number;
  lengthPenalty: number;
}

export interface LexicalScore {
  score: number;
  evidence: LexicalEvidence;
}

export interface LexicalPageInput {
  id: string;
  path?: string;
  title?: string;
  description?: string;
  content?: string;
  annotation?: string;
}

export interface LexicalChunkInput {
  articleId: string;
  path: string;
  heading?: string;
  body?: string;
  embedText?: string;
  ordinal?: number;
}

export interface RankedLexicalPage {
  id: string;
  path?: string;
  score: number;
  evidence: LexicalEvidence;
}

export interface RankedLexicalChunk {
  articleId: string;
  path: string;
  heading?: string;
  body?: string;
  ordinal?: number;
  score: number;
  evidence: LexicalEvidence;
}
```

Implementation requirements:

- `tokenizeLexical(text)` uses current stop-word behavior from `wiki-seeds.ts`.
- `scoreLexicalPage(queryTokens, input)` combines:
  - path coverage `coverage(query, tokenize(path)) * 2.2`;
  - title/id coverage `coverage(query, tokenize(title || id)) * 2.0`;
  - description/annotation coverage `coverage(query, tokenize(description || annotation)) * 1.0`;
  - content lead coverage `coverage(query, tokenize(strip frontmatter + first 500 chars)) * 0.6`;
  - exact hit bonus `min(exactHits, query.size) / query.size * 0.4`;
  - phrase-adjacent bonus up to `0.25`;
  - length penalty for descriptions over 1500 chars, floor `0.55`.
- `scoreLexicalChunk(queryTokens, input)` combines:
  - path coverage `* 1.5`;
  - heading coverage `* 2.3`;
  - body/embedText coverage `* 1.0`;
  - exact hit bonus `* 0.35`;
  - phrase-adjacent bonus up to `0.25`;
  - length penalty for body over 1200 chars, floor `0.50`.
- Ranking functions filter `score > 0`, sort by score desc, then id/path/ordinal asc.
- `fuseLexicalRanks(pageRank, chunkRank, limit, rrfK = 60)` calls existing `rrf`.

- [ ] **Step 2.2: Delegate `wiki-seeds.ts` to the scorer**

Modify `src/wiki-seeds.ts`:

```ts
import { pageId } from "./wiki-graph";
import {
  scoreLexicalPage,
  tokenizeLexical,
  type RankedLexicalPage,
} from "./lexical-retrieval";

export function tokenize(s: string): Set<string> {
  return tokenizeLexical(s);
}
```

Keep `bodyContent` and `parseFmKeywords`. Replace `scoreSeed` body with a call to `scoreLexicalPage`:

```ts
export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,
): number {
  const keywords = [...parseFmKeywords(content)].join(" ");
  return scoreLexicalPage(questionTokens, {
    id: pageIdValue,
    title: pageIdValue,
    path: pageIdValue,
    description: [annotation, keywords].filter(Boolean).join("\n"),
    content: bodyContent(content),
  }).score;
}
```

Update `selectSeeds` sorting to keep deterministic tie-breakers:

```ts
scored.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
```

- [ ] **Step 2.3: Run scorer and existing seed-adjacent tests**

```bash
node --import tsx --test tests/lexical-retrieval.test.ts tests/query-jsonl-index.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.4: Commit shared scorer**

```bash
git add src/lexical-retrieval.ts src/wiki-seeds.ts tests/lexical-retrieval.test.ts
git commit -m "feat(retrieval): add weighted lexical scorer"
```

## Task 3: Wire Runtime Chunk Ranking and Sparse Fallbacks

**Files:**
- Modify: `src/page-similarity.ts`
- Modify: `tests/page-similarity-jsonl.test.ts`

- [ ] **Step 3.1: Add runtime tests**

Append to `tests/page-similarity-jsonl.test.ts`:

```ts
import { PageSimilarityService, DEFAULT_CHUNKING } from "../src/page-similarity";

test("jaccard chunk fallback prefers heading and path evidence", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/airflow-ha.md", "# Airflow\n\n## Балансировка Airflow\nРешение через active-active."],
    ["!Wiki/hld/pages/generic.md", "# Generic\n\n## Notes\n" + "airflow балансировка " + "шаблон ".repeat(120)],
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
```

- [ ] **Step 3.2: Run runtime tests and confirm current chunk fallback fails**

```bash
node --import tsx --test tests/page-similarity-jsonl.test.ts
```

Expected before implementation: first new test fails because plain Jaccard lets body-only generic evidence compete with heading/path evidence.

- [ ] **Step 3.3: Replace `rankChunksJaccard` internals**

Modify imports in `src/page-similarity.ts`:

```ts
import { tokenize, scoreSeed } from "./wiki-seeds";
import { scoreLexicalChunk } from "./lexical-retrieval";
```

Replace the score line inside `rankChunksJaccard`:

```ts
const score = scoreLexicalChunk(queryTokens, {
  articleId: section.articleId,
  path: section.path,
  heading: section.heading,
  body: section.body,
  embedText: section.embedText,
  ordinal: section.ordinal,
}).score;
```

Keep `sortSelectedChunks(scored).slice(0, limit)` unchanged so runtime tie-breakers stay stable.

- [ ] **Step 3.4: Keep embedding dense path untouched**

Diff-check `src/page-similarity.ts` manually:

```bash
git diff -- src/page-similarity.ts
```

Expected: changed lines are import plus lexical fallback/chunk score delegation; `fetchEmbeddings`, `maxCosine`, cache decode/encode, and vector scoring logic are not modified.

- [ ] **Step 3.5: Run focused runtime tests**

```bash
node --import tsx --test tests/lexical-retrieval.test.ts tests/page-similarity-jsonl.test.ts tests/query-jsonl-index.test.ts
```

Expected: all tests pass.

- [ ] **Step 3.6: Commit runtime wiring**

```bash
git add src/page-similarity.ts tests/page-similarity-jsonl.test.ts
git commit -m "feat(retrieval): use lexical scorer in runtime fallback"
```

## Task 4: Upgrade HLD Eval Harness and Quality Gate

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Modify: `tests/eval-jsonl-domain-storage.test.ts`
- Update generated: `docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md`

- [ ] **Step 4.1: Add eval report assertions**

Modify the existing HLD eval test in `tests/eval-jsonl-domain-storage.test.ts`:

```ts
assert.ok(result.averageImprovedOverlapAt5 >= 0.65);
assert.equal(result.queries.every((query) => query.improvedOverlapAt5 >= query.baselineOverlapAt5), true);
assert.equal(result.queries.every((query) => query.status === "accepted"), true);
assert.match(report, /Average improved Overlap@5:/);
assert.match(report, /Baseline Overlap@5:/);
assert.match(report, /Improved Overlap@5:/);
assert.match(report, /Delta:/);
```

Update `QueryEvalResult` expectations in the test when TypeScript requires fields:

```ts
baselineOverlapAt5: number;
improvedOverlapAt5: number;
overlapDelta: number;
```

- [ ] **Step 4.2: Run eval test and confirm type/runtime failure**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: fail because `averageImprovedOverlapAt5`, `baselineOverlapAt5`, `improvedOverlapAt5`, and `overlapDelta` do not exist yet.

- [ ] **Step 4.3: Preserve old baseline locally**

In `scripts/eval-jsonl-domain-storage.ts`, change imports:

```ts
import {
  fuseLexicalRanks,
  rankLexicalChunks,
  rankLexicalPages,
  tokenizeLexical,
} from "../src/lexical-retrieval";
import { tokenize } from "../src/wiki-seeds";
```

Add local legacy baseline helper near the old `jaccardCoeff`:

```ts
function scoreLegacySeed(questionTokens: Set<string>, pageIdValue: string, content: string, annotation?: string): number {
  if (questionTokens.size === 0) return 0;
  const pageTokens = tokenize(pageIdValue);
  for (const token of tokenize(stripMarkdown(content).slice(0, 500))) pageTokens.add(token);
  if (annotation) for (const token of tokenize(annotation)) pageTokens.add(token);
  if (pageTokens.size === 0) return 0;
  let inter = 0;
  for (const token of questionTokens) if (pageTokens.has(token)) inter++;
  return inter / questionTokens.size;
}
```

Use `scoreLegacySeed` only inside `scoreBaseline`, so current baseline remains comparable after runtime `scoreSeed` changes.

- [ ] **Step 4.4: Add eval result fields and gates**

Extend interfaces:

```ts
export interface QueryEvalResult extends HldQuery {
  status: QueryEvalStatus;
  baselineTop: string[];
  jsonlTop: string[];
  improvedPageTop: string[];
  improvedChunkTop: string[];
  chunkTop: Array<{ path: string; heading: string; score: number }>;
  baselineOverlapAt5: number;
  improvedOverlapAt5: number;
  overlapDelta: number;
  overlapAt5: number;
  latencyMs: number;
}

export interface HldEvalResult {
  // existing fields stay
  averageImprovedOverlapAt5: number;
}
```

Add constants:

```ts
const CURRENT_OVERLAP_AT_5: Record<string, number> = {
  "data-export-s3-clickhouse": 0.40,
  "airflow-ha-balancing": 1.00,
  "integrations-consumers-marts": 0.40,
  "migration-gitflame": 0.60,
  "ownership-components": 0.20,
};

const MIN_AVERAGE_OVERLAP_AT_5 = 0.65;
```

Inside `runQueries`, replace improved scoring with shared helpers:

```ts
const queryTokens = evalQueryTokens(query);
const pageRank = rankLexicalPages(queryTokens, pageRecords.map((record) => ({
  id: record.articleId,
  path: record.path,
  title: path.basename(record.path, ".md"),
  description: record.description,
})), 10);

const chunkRank = rankLexicalChunks(queryTokens, files.flatMap((file) =>
  splitEvalSections(file.content).map((section) => ({
    articleId: pageId(file.vaultPath),
    path: file.vaultPath,
    heading: section.heading,
    body: section.window,
    embedText: `${section.heading}\n${section.window}`.trim(),
    ordinal: section.ordinal,
  })).filter((section) => chunkRecordKeys.has(`${section.articleId}:${section.ordinal}`))
), 10);

const fused = fuseLexicalRanks(pageRank, chunkRank, 10, 45);
const jsonlTop = uniqueTop(fused.map((item) => {
  const page = pageRecords.find((record) => record.articleId === item.id);
  return page?.path ?? item.id;
}), 10);
const baselineOverlapAt5 = overlapRatio(baselineTop, baselineTop, 5);
const improvedOverlapAt5 = overlapRatio(baselineTop, jsonlTop, 5);
const currentFloor = CURRENT_OVERLAP_AT_5[query.id] ?? 0;
const status: QueryEvalStatus =
  baselineTop.length === 0 || jsonlTop.length === 0 ? "rejected"
    : chunkRank.length === 0 || improvedOverlapAt5 < currentFloor ? "needs_tuning"
      : "accepted";
```

Map `chunkTop` from `chunkRank.slice(0, 5)`. Preserve `overlapAt5: improvedOverlapAt5` for compatibility.

In `runHldEval`, compute:

```ts
const averageImprovedOverlapAt5 = queryResults.reduce((sum, query) => sum + query.improvedOverlapAt5, 0) / queryResults.length;
const regressions = queryResults
  .filter((query) => query.status !== "accepted" || query.improvedOverlapAt5 < (CURRENT_OVERLAP_AT_5[query.id] ?? 0))
  .map((query) => `${query.id}: ${query.status} improved=${query.improvedOverlapAt5.toFixed(2)} floor=${(CURRENT_OVERLAP_AT_5[query.id] ?? 0).toFixed(2)}`);
if (averageImprovedOverlapAt5 < MIN_AVERAGE_OVERLAP_AT_5) regressions.push(`average Overlap@5 ${averageImprovedOverlapAt5.toFixed(2)} < ${MIN_AVERAGE_OVERLAP_AT_5.toFixed(2)}`);
```

- [ ] **Step 4.5: Update markdown report rendering**

In `renderReport`, add aggregate and per-query metrics:

```ts
lines.push(`Average improved Overlap@5: ${result.averageImprovedOverlapAt5.toFixed(2)}`);
```

For each query:

```ts
lines.push(`Baseline Overlap@5: ${query.baselineOverlapAt5.toFixed(2)}`);
lines.push(`Improved Overlap@5: ${query.improvedOverlapAt5.toFixed(2)}`);
lines.push(`Delta: ${query.overlapDelta >= 0 ? "+" : ""}${query.overlapDelta.toFixed(2)}`);
```

Also render `Improved page top:` and `Improved chunk top:` before `JSONL retrieval top:`.

- [ ] **Step 4.6: Run synthetic eval test**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.7: Run live HLD eval quality gate**

```bash
npx tsx scripts/eval-jsonl-domain-storage.ts --source /home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная\ архитектура/HLD --out docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
```

Expected:

- aggregate verdict is `accepted`;
- `Average improved Overlap@5 >= 0.65`;
- no query below current floor values;
- `ownership-components > 0.20`;
- query latency stays within 25% of the current 42-55 ms range, unless explained by local filesystem variance.

- [ ] **Step 4.8: If the live gate fails, adjust only generic weights**

Allowed changes are restricted to `src/lexical-retrieval.ts` weights and eval RRF `k`. Stop and ask the user if passing requires HLD-specific runtime synonyms, schema changes, default-mode changes, dense retrieval changes, or network/model dependencies.

- [ ] **Step 4.9: Commit eval harness upgrade**

```bash
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
git commit -m "test(eval): gate hld lexical retrieval quality"
```

## Task 5: Verification, Docs, Wiki, and Chain Result

**Files:**
- Modify: `docs/rag-quality-recommendations.md`
- Modify: `docs/TODO.md`
- Modify: `docs/superpowers/plans/2026-07-11-lexical-retrieval-quality.md`
- Update iwiki domain `obsidian-ai-wiki`
- Push branch `dev-jsonl-domain-storage`

- [ ] **Step 5.1: Run focused tests**

```bash
node --import tsx --test tests/lexical-retrieval.test.ts tests/page-similarity-jsonl.test.ts tests/query-jsonl-index.test.ts tests/eval-jsonl-domain-storage.test.ts tests/wiki-index-jsonl.test.ts
```

Expected: all tests pass.

- [ ] **Step 5.2: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: lint has no new errors. The existing warnings in `src/claude-cli-client.ts` and `src/okf-export-fs.ts` may remain if unchanged. Build passes.

- [ ] **Step 5.3: Update repository docs**

In `docs/rag-quality-recommendations.md`, update the JSONL HLD harness paragraph to state:

```md
For lexical/offline retrieval, Query no longer uses plain Jaccard alone. It uses a deterministic weighted lexical scorer: title/path and headings are stronger signals than long generic body overlap, page and chunk ranks are fused through RRF, and the path remains fully offline. The JSONL HLD harness reports old lexical baseline vs improved weighted lexical metrics, including average `Overlap@5`.
```

- [ ] **Step 5.4: Update iwiki**

Use iwiki MCP:

1. `wiki_status`
2. `wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")`
3. `wiki_update_page` for `jsonl-domain-storage` or the relevant retrieval page, updating the eval/retrieval behavior section with weighted lexical scoring and avg `Overlap@5` evidence.
4. `wiki_lint(domain="obsidian-ai-wiki")`

Expected: no broken refs, stale pages, or blockers.

- [ ] **Step 5.5: Run `$check-chain result`**

Reconcile implementation diff against:

- intent `docs/superpowers/intents/2026-07-11-lexical-retrieval-quality-intent.md`;
- spec `docs/superpowers/specs/2026-07-11-lexical-retrieval-quality-design.md`;
- plan `docs/superpowers/plans/2026-07-11-lexical-retrieval-quality.md`.

Expected:

- `result_check.verdict: OK`;
- `docs/TODO.md` row `lexical-retrieval-quality` is `done`;
- final HTML report exists at `docs/superpowers/reports/lexical-retrieval-quality-results.html`.

- [ ] **Step 5.6: Final commit and push**

```bash
git status --short
git add docs/rag-quality-recommendations.md docs/TODO.md docs/superpowers/plans/2026-07-11-lexical-retrieval-quality.md docs/superpowers/reports/lexical-retrieval-quality-results.html
git commit -m "docs(retrieval): document lexical quality gate"
git push
```

Expected: branch pushed to PR #50.

## Acceptance Checklist

- [ ] `src/lexical-retrieval.ts` is pure and Obsidian-free.
- [ ] Runtime `selectSeeds`, Jaccard mode, embedding fallback, entity fallback, and hybrid sparse side use the weighted lexical scorer.
- [ ] Dense vector computation and `index.jsonl` schema are unchanged.
- [ ] HLD eval report shows old vs improved metrics.
- [ ] HLD eval aggregate `Average improved Overlap@5 >= 0.65`.
- [ ] `ownership-components` improves above `0.20`.
- [ ] No HLD query regresses below current floors.
- [ ] All five HLD queries remain `accepted`.
- [ ] Focused tests, lint, build, live HLD eval, and `wiki_lint` pass.
