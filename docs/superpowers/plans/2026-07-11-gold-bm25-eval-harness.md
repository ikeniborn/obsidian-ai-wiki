---
review:
  plan_hash: b0e2a78e7e46ebd6
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-gold-bm25-eval-harness-intent.md
  spec: docs/superpowers/specs/2026-07-11-gold-bm25-eval-harness-design.md
result_check:
  verdict: OK
  plan_hash: b0e2a78e7e46ebd6
  last_run: 2026-07-11
---
# Gold BM25 Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated HLD gold set and offline BM25/RRF A/B harness that measures real retrieval quality while preserving existing legacy-overlap floors.

**Architecture:** Keep the existing JSONL HLD eval command as the orchestration entry point. Add pure scoring/metrics modules for BM25 and gold-set evaluation, then extend the eval harness to compare weighted lexical, BM25 page, BM25 chunk, and fused variants. Runtime Query behavior remains unchanged.

**Tech Stack:** TypeScript, Node test runner via `node --import tsx --test`, existing JSONL HLD eval script, existing `lexical-retrieval` and `rrf` helpers, repo docs, iwiki MCP.

---

## File Structure

- Create `src/bm25.ts`
  - Pure Obsidian-free BM25 index and ranking helper.
  - Exports duplicate-preserving `tokenizeBm25`, `buildBm25Index`, `rankBm25`, and related types.
- Create `src/retrieval-eval-metrics.ts`
  - Pure gold-set validation and metrics helpers.
  - Exports gold schema types, `validateGoldSet`, `scoreGoldRanking`, and aggregate helpers.
- Create `tests/bm25.test.ts`
  - Covers BM25 ranking, length normalization, empty query/corpus, deterministic ties.
- Create `tests/retrieval-eval-metrics.test.ts`
  - Covers gold validation and `Recall@5`, `nDCG@5`, `MRR`.
- Create `docs/superpowers/evals/hld-gold-set.json`
  - Manual curated labels for the five fixed HLD queries.
- Modify `scripts/eval-jsonl-domain-storage.ts`
  - Load and validate gold set.
  - Build BM25 page/chunk indexes.
  - Produce retrieval variants and metrics.
  - Choose accepted best variant.
  - Keep current weighted lexical and legacy overlap floors.
- Modify `tests/eval-jsonl-domain-storage.test.ts`
  - Assert variant table, gold metrics, legacy floors, best variant, and accepted synthetic fixture.
- Modify `docs/rag-quality-recommendations.md`
  - Document gold metrics and BM25/RRF A/B harness.
- Update iwiki `jsonl-domain-storage` after implementation.
- Modify `docs/TODO.md`
  - Mark result after `$check-chain result`.

## Task 1: BM25 Core

**Files:**
- Create: `tests/bm25.test.ts`
- Create: `src/bm25.ts`

- [ ] **Step 1.1: Write failing BM25 tests**

Create `tests/bm25.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildBm25Index, rankBm25, tokenizeBm25 } from "../src/bm25";

test("BM25 ranks repeated exact query terms above generic overlap", () => {
  const index = buildBm25Index([
    { id: "generic", text: "экспорт данных общий документ" },
    { id: "s3", text: "экспорт экспорт s3 clickhouse витрина" },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("экспорт s3 clickhouse"), index, 2);

  assert.equal(ranked[0].id, "s3");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("BM25 length normalization prevents long template dominance", () => {
  const index = buildBm25Index([
    { id: "compact", text: "airflow балансировка отказоустойчивая архитектура" },
    { id: "template", text: "airflow балансировка " + "типовой раздел ".repeat(200) },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("airflow балансировка архитектура"), index, 2);

  assert.equal(ranked[0].id, "compact");
});

test("BM25 returns empty rankings for empty query or corpus", () => {
  const index = buildBm25Index([{ id: "a", text: "alpha" }], tokenizeBm25);
  assert.deepEqual(rankBm25([], index, 5), []);
  assert.deepEqual(rankBm25(tokenizeBm25("alpha"), buildBm25Index([], tokenizeBm25), 5), []);
});

test("BM25 tie-breaks deterministically by id", () => {
  const index = buildBm25Index([
    { id: "b", text: "same token" },
    { id: "a", text: "same token" },
  ], tokenizeBm25);

  const ranked = rankBm25(tokenizeBm25("same"), index, 2);

  assert.deepEqual(ranked.map((item) => item.id), ["a", "b"]);
});
```

- [ ] **Step 1.2: Run BM25 tests and confirm RED**

```bash
node --import tsx --test tests/bm25.test.ts
```

Expected: fails with module-not-found for `../src/bm25`.

- [ ] **Step 1.3: Implement `src/bm25.ts`**

Create `src/bm25.ts`:

```ts
export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Ranked {
  id: string;
  score: number;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще", "какие",
  "какой", "какая", "какое", "где", "через",
]);

export function tokenizeBm25(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2 && !/[a-zа-я]\d|\d[a-zа-я]/iu.test(raw)) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

interface IndexedDocument {
  id: string;
  length: number;
  termFreq: Map<string, number>;
}

export interface Bm25Index {
  documents: IndexedDocument[];
  documentFrequency: Map<string, number>;
  averageLength: number;
  size: number;
}

export function buildBm25Index(
  documents: Bm25Document[],
  tokenize: (text: string) => string[],
): Bm25Index {
  const indexed: IndexedDocument[] = [];
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    const tokens = tokenize(document.text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    for (const token of termFreq.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    indexed.push({ id: document.id, length: tokens.length, termFreq });
  }
  const averageLength = indexed.length === 0
    ? 0
    : indexed.reduce((sum, document) => sum + document.length, 0) / indexed.length;
  return { documents: indexed, documentFrequency, averageLength, size: indexed.length };
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function rankBm25(
  queryTokens: string[],
  index: Bm25Index,
  limit: number,
  options: { k1?: number; b?: number } = {},
): Bm25Ranked[] {
  if (queryTokens.length === 0 || index.size === 0 || limit <= 0) return [];
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const avg = index.averageLength || 1;
  const ranked: Bm25Ranked[] = [];
  for (const document of index.documents) {
    let score = 0;
    for (const token of queryTokens) {
      const tf = document.termFreq.get(token) ?? 0;
      if (tf === 0) continue;
      const df = index.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * document.length / avg)));
    }
    if (score > 0) ranked.push({ id: document.id, score });
  }
  return ranked
    .sort((a, b) => (b.score - a.score) || compareStable(a.id, b.id))
    .slice(0, limit);
}
```

- [ ] **Step 1.4: Run BM25 tests and commit**

```bash
node --import tsx --test tests/bm25.test.ts
git add src/bm25.ts tests/bm25.test.ts
git commit -m "feat(eval): add pure bm25 ranking helper"
```

Expected: all BM25 tests pass.

## Task 2: Gold Set and Metrics

**Files:**
- Create: `src/retrieval-eval-metrics.ts`
- Create: `tests/retrieval-eval-metrics.test.ts`
- Create: `docs/superpowers/evals/hld-gold-set.json`

- [ ] **Step 2.1: Write failing metrics tests**

Create `tests/retrieval-eval-metrics.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreGoldRanking,
  validateGoldSet,
  type GoldSet,
} from "../src/retrieval-eval-metrics";

const queryIds = ["q1", "q2"];
const knownPaths = new Set(["a.md", "b.md", "c.md", "d.md"]);

test("scoreGoldRanking computes recall, ndcg, and mrr", () => {
  const metrics = scoreGoldRanking(
    [
      { path: "a.md", grade: 3, rationale: "primary" },
      { path: "b.md", grade: 2, rationale: "direct" },
      { path: "c.md", grade: 1, rationale: "supporting" },
    ],
    ["x.md", "b.md", "a.md", "z.md", "c.md"],
    5,
  );

  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.mrr, 0.5);
  assert.ok(metrics.ndcgAtK > 0.7 && metrics.ndcgAtK < 1);
});

test("validateGoldSet rejects unknown query ids", () => {
  const gold: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { missing: { relevant: [{ path: "a.md", grade: 3, rationale: "x" }] } },
  };

  assert.throws(() => validateGoldSet(gold, queryIds, knownPaths), /unknown query/);
});

test("validateGoldSet rejects duplicate and missing paths", () => {
  const duplicate: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { q1: { relevant: [
      { path: "a.md", grade: 3, rationale: "x" },
      { path: "a.md", grade: 2, rationale: "y" },
    ] }, q2: { relevant: [{ path: "b.md", grade: 1, rationale: "z" }] } },
  };
  assert.throws(() => validateGoldSet(duplicate, queryIds, knownPaths), /duplicate/);

  const missingPath: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { q1: { relevant: [{ path: "missing.md", grade: 3, rationale: "x" }] }, q2: { relevant: [{ path: "b.md", grade: 1, rationale: "z" }] } },
  };
  assert.throws(() => validateGoldSet(missingPath, queryIds, knownPaths), /not present/);
});

test("validateGoldSet requires every query to have labels", () => {
  const gold: GoldSet = {
    version: 1,
    source: "fixture",
    queries: { q1: { relevant: [{ path: "a.md", grade: 3, rationale: "x" }] } },
  };

  assert.throws(() => validateGoldSet(gold, queryIds, knownPaths), /missing gold labels/);
});
```

- [ ] **Step 2.2: Run metrics tests and confirm RED**

```bash
node --import tsx --test tests/retrieval-eval-metrics.test.ts
```

Expected: fails with module-not-found for `../src/retrieval-eval-metrics`.

- [ ] **Step 2.3: Implement `src/retrieval-eval-metrics.ts`**

Create `src/retrieval-eval-metrics.ts` with:

```ts
export interface GoldLabel {
  path: string;
  grade: 1 | 2 | 3;
  rationale: string;
}

export interface GoldSet {
  version: 1;
  source: string;
  queries: Record<string, { relevant: GoldLabel[] }>;
}

export interface GoldMetrics {
  recallAtK: number;
  ndcgAtK: number;
  mrr: number;
}

export function validateGoldSet(gold: GoldSet, queryIds: string[], knownPaths: Set<string>): void {
  const expected = new Set(queryIds);
  for (const queryId of Object.keys(gold.queries)) {
    if (!expected.has(queryId)) throw new Error(`unknown query in gold set: ${queryId}`);
  }
  for (const queryId of queryIds) {
    const labels = gold.queries[queryId]?.relevant;
    if (!labels || labels.length === 0) throw new Error(`missing gold labels for query: ${queryId}`);
    const seen = new Set<string>();
    for (const label of labels) {
      if (seen.has(label.path)) throw new Error(`duplicate gold label for ${queryId}: ${label.path}`);
      seen.add(label.path);
      if (!knownPaths.has(label.path)) throw new Error(`gold path not present in eval domain for ${queryId}: ${label.path}`);
      if (![1, 2, 3].includes(label.grade)) throw new Error(`invalid gold grade for ${queryId}: ${label.path}`);
      if (label.rationale.trim().length === 0) throw new Error(`missing gold rationale for ${queryId}: ${label.path}`);
    }
  }
}

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + ((2 ** grade - 1) / Math.log2(index + 2)), 0);
}

export function scoreGoldRanking(labels: GoldLabel[], rankedPaths: string[], k: number): GoldMetrics {
  const labelByPath = new Map(labels.map((label) => [label.path, label.grade]));
  const top = rankedPaths.slice(0, k);
  const relevantHits = top.filter((path) => labelByPath.has(path));
  const denominator = Math.min(k, labels.length);
  const recallAtK = denominator === 0 ? 0 : relevantHits.length / denominator;
  const rankedGrades = top.map((path) => labelByPath.get(path) ?? 0);
  const idealGrades = labels.map((label) => label.grade).sort((a, b) => b - a).slice(0, k);
  const ideal = dcg(idealGrades);
  const ndcgAtK = ideal === 0 ? 0 : dcg(rankedGrades) / ideal;
  const firstHit = top.findIndex((path) => labelByPath.has(path));
  const mrr = firstHit === -1 ? 0 : 1 / (firstHit + 1);
  return { recallAtK, ndcgAtK, mrr };
}
```

- [ ] **Step 2.4: Add first gold set file**

Create `docs/superpowers/evals/hld-gold-set.json` with labels for all five fixed queries. Use deterministic eval paths from the latest report. Include at least:

- data export: `экспорт-витрин-из-гп-в-кх-через-s3`, `экспорт-в-слой-распространения-s3`, `ппа-clickstream-ппа-clickstream-hld`, `1лтп-1лтп-hld`, `rt-widestore-clickhouse-s3-storage-optimize-fix`;
- airflow: the four `rt-dataexporter-airflow-ha-architecture-v*` pages plus `rt-dataexporter-airflow-balancing-analysis`;
- integrations: `интеграция-систем-потребителей-с-етп-дата`, `интеграция-дзо-с-витринными-бд`, `интеграция-rt-dv`, `интеграция-с-gus`, `template-hld-v2-standard`;
- migration: `миграция-на-gitflame`, `rt-widestore-технический-план-миграции-кластера-clickhouse-через-бэкап`, `rt-widestore-join-clickhouse-etl-join-analysis`, `template-hld-v2-standard`, `template-hld-v3-full`;
- ownership: `су-ноп`, `template-readme`, `ппа-clickstream-ппа-clickstream-draft`, `1лтп-1лтп-draft`, `1лтп-1лтп-hld`.

- [ ] **Step 2.5: Run metrics tests and commit**

```bash
node --import tsx --test tests/retrieval-eval-metrics.test.ts
git add src/retrieval-eval-metrics.ts tests/retrieval-eval-metrics.test.ts docs/superpowers/evals/hld-gold-set.json
git commit -m "test(eval): add hld gold set metrics"
```

Expected: metrics tests pass.

## Task 3: A/B Variants in HLD Eval

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Modify: `tests/eval-jsonl-domain-storage.test.ts`
- Update: `docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md`

- [ ] **Step 3.1: Add failing eval assertions**

In `tests/eval-jsonl-domain-storage.test.ts`, add assertions after report read:

```ts
assert.ok(result.bestVariant);
assert.ok(result.aggregateGoldMetrics.ndcgAtK >= result.weightedLexicalGoldMetrics.ndcgAtK);
assert.match(report, /## Retrieval variants/);
assert.match(report, /Best variant:/);
assert.match(report, /Recall@5/);
assert.match(report, /nDCG@5/);
assert.match(report, /MRR/);
assert.match(report, /LegacyOverlap@5/);
```

Add fixture gold-set file creation in the temp source test, and pass it through a new option:

```ts
const goldPath = path.join(root, "gold.json");
await writeFile(goldPath, JSON.stringify({
  version: 1,
  source: "fixture",
  queries: {
    "data-export-s3-clickhouse": { relevant: [{ path: "!Wiki/hld-jsonl-eval/pages/export.md", grade: 3, rationale: "fixture" }] },
    "airflow-ha-balancing": { relevant: [{ path: "!Wiki/hld-jsonl-eval/pages/airflow.md", grade: 3, rationale: "fixture" }] },
    "integrations-consumers-marts": { relevant: [{ path: "!Wiki/hld-jsonl-eval/pages/integrations.md", grade: 3, rationale: "fixture" }] },
    "migration-gitflame": { relevant: [{ path: "!Wiki/hld-jsonl-eval/pages/gitflame.md", grade: 3, rationale: "fixture" }] },
    "ownership-components": { relevant: [{ path: "!Wiki/hld-jsonl-eval/pages/ownership.md", grade: 3, rationale: "fixture" }] }
  }
}), "utf8");

const result = await runHldEval({ source, outPath: out, evalRoot, goldPath });
```

- [ ] **Step 3.2: Run eval test and confirm RED**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: fails because `goldPath`, `bestVariant`, and gold metrics do not exist.

- [ ] **Step 3.3: Extend eval types and options**

In `scripts/eval-jsonl-domain-storage.ts`:

- import `buildBm25Index`, `rankBm25`;
- import gold metrics helpers;
- add `goldPath?: string` to `RunHldEvalOptions`;
- add result types:

```ts
export type RetrievalVariantId =
  | "weighted-lexical"
  | "bm25-page"
  | "bm25-chunk"
  | "rrf-weighted-bm25"
  | "rrf-weighted-bm25-legacy";

export interface VariantMetrics {
  id: RetrievalVariantId;
  recallAt5: number;
  ndcgAt5: number;
  mrr: number;
  legacyOverlapAt5: number;
  accepted: boolean;
}
```

Add `bestVariant`, `variantMetrics`, `aggregateGoldMetrics`, and `weightedLexicalGoldMetrics` to `HldEvalResult`.

- [ ] **Step 3.4: Build BM25 page/chunk variants**

Inside `runQueries`, build:

- `bm25PageTop`;
- `bm25ChunkTop`;
- `rrfWeightedBm25Top`;
- `rrfWeightedBm25LegacyTop`.

Use page ids for RRF and map back to paths through `pathByArticleId`.

- [ ] **Step 3.5: Load and validate gold set**

In `runHldEval`, after building the eval domain and parsing page records:

```ts
const goldPath = options.goldPath ?? path.join("docs", "superpowers", "evals", "hld-gold-set.json");
const gold = JSON.parse(await readFile(goldPath, "utf8")) as GoldSet;
validateGoldSet(gold, buildHldQueries().map((query) => query.id), new Set(pageRecords.map((record) => record.path)));
```

Pass `gold` into `runQueries`.

- [ ] **Step 3.6: Compute metrics and choose best variant**

For each query and variant:

- compute `scoreGoldRanking(labels, topPaths, 5)`;
- compute legacy overlap floor with existing `overlapRatio`;
- mark accepted only when legacy floor passes.

Aggregate macro averages. Choose best accepted variant by `nDCG@5`, then `Recall@5`, then `MRR`. Reject aggregate verdict if best variant does not beat `weighted-lexical` on at least one gold aggregate metric.

- [ ] **Step 3.7: Render report variant table**

Add a `## Retrieval variants` section with one table-like markdown block:

```md
| Variant | Recall@5 | nDCG@5 | MRR | LegacyOverlap@5 | Accepted |
|---|---:|---:|---:|---:|---|
```

Add `Best variant: ...`.

- [ ] **Step 3.8: Run synthetic test and live HLD eval**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
npx tsx scripts/eval-jsonl-domain-storage.ts --source /home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная\ архитектура/HLD --out docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
```

Expected:

- synthetic eval accepted;
- live eval validates gold set;
- report contains variant table, best variant, gold metrics, and legacy floor status;
- no legacy floor drops below current values.

- [ ] **Step 3.9: Commit eval variants**

```bash
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts docs/superpowers/evals/jsonl-domain-storage-hld-2026-07-11.md
git commit -m "test(eval): compare bm25 rrf variants against hld gold set"
```

## Task 4: Docs, Verification, Result Gate, Push

**Files:**
- Modify: `docs/rag-quality-recommendations.md`
- Modify: `docs/TODO.md`
- Modify: `docs/superpowers/plans/2026-07-11-gold-bm25-eval-harness.md`
- Create: `docs/superpowers/reports/gold-bm25-eval-harness-results.html`
- Update: iwiki `jsonl-domain-storage`
- Update: `dist/main.js` if build changes it

- [ ] **Step 4.1: Run full focused tests**

```bash
node --import tsx --test tests/bm25.test.ts tests/retrieval-eval-metrics.test.ts tests/eval-jsonl-domain-storage.test.ts tests/lexical-retrieval.test.ts tests/wiki-index-jsonl.test.ts
```

Expected: all pass.

- [ ] **Step 4.2: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: lint has no new errors; existing import warnings may remain. Build passes.

- [ ] **Step 4.3: Update docs and iwiki**

Update `docs/rag-quality-recommendations.md` to say HLD retrieval quality now uses curated gold metrics plus BM25/RRF A/B variants, while legacy overlap remains no-regression guard.

Use iwiki MCP:

1. `wiki_status`
2. `wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")`
3. `wiki_update_page` for `jsonl-domain-storage`, heading `Eval`, with final best variant and gold metric summary.
4. `wiki_lint(domain="obsidian-ai-wiki")`

- [ ] **Step 4.4: Run `$check-chain result`**

Set result evidence:

- plan hash unchanged;
- `docs/TODO.md` row `gold-bm25-eval-harness` closed with `Result: OK`;
- final HTML report under `docs/superpowers/reports/gold-bm25-eval-harness-results.html`;
- verification evidence includes focused tests, live HLD eval, lint, build, and wiki lint.

- [ ] **Step 4.5: Commit docs/result and push**

```bash
git status --short
git add docs/rag-quality-recommendations.md docs/TODO.md docs/superpowers/plans/2026-07-11-gold-bm25-eval-harness.md docs/superpowers/reports/gold-bm25-eval-harness-results.html dist/main.js
git commit -m "docs(eval): document gold bm25 harness result"
git push -u origin dev-gold-bm25-eval-harness
```

Expected: branch pushed and ready for PR.

## Acceptance Checklist

- [ ] Gold set exists and validates against built eval paths.
- [ ] BM25 helper is pure and deterministic.
- [ ] A/B harness compares weighted lexical, BM25 page, BM25 chunk, and RRF variants.
- [ ] Report includes `Recall@5`, `nDCG@5`, `MRR`, and `LegacyOverlap@5`.
- [ ] Accepted best variant improves gold metrics over weighted lexical and does not drop legacy floors.
- [ ] Runtime Query behavior is unchanged.
- [ ] Focused tests, live HLD eval, lint, build, and `wiki_lint` pass.
