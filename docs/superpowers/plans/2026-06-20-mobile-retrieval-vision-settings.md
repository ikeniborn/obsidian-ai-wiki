---
review:
  plan_hash: 05f33186ab376a6d
  spec_hash: 232a25cb20a0da09
  last_run: 2026-06-20
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: INFO
      section: "(document) repeated step headings + self-review attestation"
      section_hash: 05f33186ab376a6d
      text: "Step headings 'Commit'/'Typecheck' repeat per task (scoped, normal). The lone TODO/TBD grep hit is the Self-Review attestation line, not a placeholder."
      verdict: accepted
      verdict_at: 2026-06-20
    - id: F-002
      phase: verifiability
      severity: INFO
      section: "Tasks 6/7/10/12 manual-verification steps"
      section_hash: 05f33186ab376a6d
      text: "Manual UI/replay checks (Task 6.4 live replay, Task 7.4, Task 10.3, Task 12.1 iwiki) have no automated command but state explicit observational DoD — acceptable for UI/integration."
      verdict: accepted
      verdict_at: 2026-06-20
    - id: F-003
      phase: coverage
      severity: INFO
      section: "File Structure"
      section_hash: 05f33186ab376a6d
      text: "File Structure lists 'src/types.ts (vision settings shape) add imageOnly?', but Task 9 edits the inline visionSettings param type in format.ts; types.ts is not touched for imageOnly. Summary-only redundancy; tasks are authoritative."
      verdict: accepted
      verdict_at: 2026-06-20
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-20-mobile-retrieval-vision-settings-design.md
---

# Mobile fixes (retrieval gate / settings / vision format / source-suggest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make vector/hybrid retrieval actually used on the native backend (fix the threshold-scale bug), surface the retrieval path in progress, hide ingest-only settings on mobile, enable vision-format on mobile, and stop `!Wiki` appearing as a domain source.

**Architecture:** Approach A for retrieval — the seed-quality gate compares the configured `seedSimilarityThreshold` against the **dense cosine** confidence (`denseMax`), not the RRF-fused score. New obsidian-free helpers (`src/retrieval-diag.ts`) hold the gate decision and progress-tag formatting so they are unit-testable headlessly. A new `PageSimilarityService.selectRelevantScoredDiag` exposes `{ results, denseMax, embedFailed }` without changing the existing `selectRelevantScored` (still used by `wiki-graph.ts`). Settings hiding, the mobile format button, the `imageOnly` vision flag, and the source-folder filter are small surgical edits, each with a pure helper extracted for an out-of-vault eval.

**Tech Stack:** TypeScript, esbuild (plugin bundle + out-of-vault eval harness with `--alias:obsidian=stub`), Obsidian plugin API, OpenAI-compatible embeddings (`bge-m3` via `requestUrl`).

**Spec:** `docs/superpowers/specs/2026-06-20-mobile-retrieval-vision-settings-design.md`

**Branch:** `dev/mobile-retrieval-vision` (already created; commit per task).

---

## File Structure

**Created**
- `src/retrieval-diag.ts` — obsidian-free: `SeedDiag` type, `RetrievalMode`, `SeedFallbackReason`, `seedPassesGate()`, `retrievalTag()`.
- `eval/mobile-fixes/run.ts` — out-of-vault deterministic eval (gate, tag, cosine→denseMax, mobile-vision ext, source-folder filter).
- `eval/mobile-fixes/obsidian-stub.ts` — minimal `requestUrl` stub.
- `eval/mobile-fixes/.gitignore` — ignore the built `run.cjs`.
- `docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md` — how to run the eval + live replay.

**Modified**
- `src/page-similarity.ts` — export `maxCosine`; add `selectEmbeddingScoredDiag` + `selectRelevantScoredDiag`; refactor `selectEmbeddingScored`/`selectHybridScored` to delegate (DRY).
- `src/types.ts` — extend the `graph_stats` event (`retrievalMode`, `denseMax`, `seedFallbackReason`).
- `src/phases/query.ts` — use the diag method; gate on `denseMax`; record retrieval fields.
- `src/view.ts` — `formatGraphStatsLines` retrieval tag (compact + trace); mobile Format button.
- `src/settings.ts` — wrap chunking + "Graph health" in `!Platform.isMobile`.
- `src/phases/attachment-analyzer.ts` — `isVisionSupportedOnMobile()`; `imageOnly` skip in `analyzeSingleAttachment`.
- `src/phases/format.ts` — thread `imageOnly`; "skipped (unsupported on mobile)" note.
- `src/agent-runner.ts` — constructor `isMobile`; set `visionSettings.imageOnly`.
- `src/controller.ts` — pass `Platform.isMobile` to `AgentRunner`.
- `src/types.ts` (vision settings shape used in `runFormat`) — add `imageOnly?`.
- `src/source-paths.ts` — `isSelectableSourceFolder()`.
- `src/modals.ts` — `FolderInputSuggest.getSuggestions` filters `!Wiki`.

---

# Part 1 — Retrieval gate fix + observability

## Task 1: Obsidian-free retrieval-diag helpers + eval scaffold

**Files:**
- Create: `src/retrieval-diag.ts`
- Create: `eval/mobile-fixes/obsidian-stub.ts`
- Create: `eval/mobile-fixes/.gitignore`
- Create: `eval/mobile-fixes/run.ts`

- [ ] **Step 1: Create the helper module**

Create `src/retrieval-diag.ts`:

```ts
// Obsidian-free retrieval diagnostics — shared by the query seed gate and the
// progress view, kept dependency-light so the out-of-vault eval can import it.

export type RetrievalMode = "jaccard" | "embedding" | "hybrid";
export type SeedFallbackReason = "low-similarity" | "embed-failed";

export interface SeedDiag {
  /** Final ranked seeds for the mode (hybrid RRF, embedding cosine, or jaccard). */
  results: { path: string; score: number }[];
  /** Max raw cosine of the dense side. 0 in jaccard mode or when embedding failed. */
  denseMax: number;
  /** True when the embedding HTTP call threw and the dense side degraded to jaccard. */
  embedFailed: boolean;
}

/**
 * Seed-quality gate. Returns true when the dense embedding signal is strong enough
 * to trust the embedding/hybrid ranking. Compares against the raw cosine `denseMax`,
 * NOT the RRF-fused score (whose max is ~2/(k+1) ≈ 0.033 and never clears a
 * cosine-scaled threshold — the bug this fixes).
 */
export function seedPassesGate(denseMax: number, threshold: number): boolean {
  return denseMax >= threshold;
}

/**
 * Short retrieval tag for the progress view, e.g. `vector`, `jaccard (low 0.21)`,
 * `jaccard (embed failed)`, `llm seeds`, `jaccard`.
 */
export function retrievalTag(
  mode: RetrievalMode,
  seedFallback: "none" | "jaccard" | "llm",
  reason: SeedFallbackReason | undefined,
  denseMax: number | undefined,
): string {
  if (mode === "jaccard") return "jaccard";
  if (seedFallback === "llm") return "llm seeds";
  if (seedFallback === "jaccard") {
    return reason === "embed-failed"
      ? "jaccard (embed failed)"
      : `jaccard (low ${(denseMax ?? 0).toFixed(2)})`;
  }
  return "vector";
}
```

- [ ] **Step 2: Create the eval stub and gitignore**

Create `eval/mobile-fixes/obsidian-stub.ts`:

```ts
// Minimal `obsidian` stub for the out-of-vault mobile-fixes eval.
// The import tree pulls only `requestUrl` (src/page-similarity.ts); the deterministic
// tests never call it.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the mobile-fixes eval");
}
```

Create `eval/mobile-fixes/.gitignore`:

```
run.cjs
```

- [ ] **Step 3: Write the failing eval (gate + tag only for now)**

Create `eval/mobile-fixes/run.ts`:

```ts
/**
 * Out-of-vault deterministic eval for the mobile-fixes branch. Exercises the REAL pure
 * helpers from src/ — retrieval gate, progress tag, dense cosine, mobile-vision ext,
 * and source-folder filter — with no Obsidian vault and no LLM.
 *
 * Run: see docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md
 */
import { seedPassesGate, retrievalTag } from "../../src/retrieval-diag";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

section("seedPassesGate — gate on dense cosine, not RRF");
check("strong cosine passes", seedPassesGate(0.62, 0.3) === true);
check("RRF-scale score fails (the bug)", seedPassesGate(0.033, 0.3) === false);
check("embed-failed (0) fails", seedPassesGate(0, 0.3) === false);
check("threshold 0 always passes", seedPassesGate(0, 0) === true);

section("retrievalTag");
check("hybrid vector used", retrievalTag("hybrid", "none", undefined, 0.62) === "vector");
check("hybrid low-similarity", retrievalTag("hybrid", "jaccard", "low-similarity", 0.21) === "jaccard (low 0.21)");
check("hybrid embed-failed", retrievalTag("hybrid", "jaccard", "embed-failed", 0) === "jaccard (embed failed)");
check("pure jaccard mode", retrievalTag("jaccard", "none", undefined, 0) === "jaccard");
check("llm fallback", retrievalTag("embedding", "llm", undefined, 0.1) === "llm seeds");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(failures.join("\n")); process.exit(1); }
```

- [ ] **Step 4: Build and run the eval — expect PASS**

Run:
```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
```
Expected: `ALL PASS: 9 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/retrieval-diag.ts eval/mobile-fixes/run.ts eval/mobile-fixes/obsidian-stub.ts eval/mobile-fixes/.gitignore
git commit -m "feat(retrieval): obsidian-free seed-gate + retrieval-tag helpers with eval"
```

---

## Task 2: Extend the `graph_stats` event type

**Files:**
- Modify: `src/types.ts:77-89` (the `graph_stats` variant)

- [ ] **Step 1: Add the new fields**

In `src/types.ts`, the `graph_stats` event variant currently ends:

```ts
      expandedByHop?: Record<number, string[]>;
      seedFallback?: "none" | "jaccard" | "llm";
    };
```

Replace with:

```ts
      expandedByHop?: Record<number, string[]>;
      seedFallback?: "none" | "jaccard" | "llm";
      retrievalMode?: import("./retrieval-diag").RetrievalMode;
      denseMax?: number;
      seedFallbackReason?: import("./retrieval-diag").SeedFallbackReason;
    };
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds (no new type errors in `src/types.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): graph_stats retrievalMode/denseMax/seedFallbackReason"
```

---

## Task 3: PageSimilarityService diagnostics (`denseMax` + `embedFailed`)

**Files:**
- Modify: `src/page-similarity.ts` — export `maxCosine` (line 201); add `selectEmbeddingScoredDiag` + `selectRelevantScoredDiag`; refactor `selectEmbeddingScored` (653) and `selectHybridScored` (717) to delegate.
- Modify: `eval/mobile-fixes/run.ts` — add cosine→denseMax assertions.

- [ ] **Step 1: Export `maxCosine`**

In `src/page-similarity.ts` line 201, change:

```ts
function maxCosine(query: Float32Array, vecs: Float32Array[]): number {
```
to:
```ts
export function maxCosine(query: Float32Array, vecs: Float32Array[]): number {
```

- [ ] **Step 2: Import the diag type**

At the top of `src/page-similarity.ts`, after the existing imports, add:

```ts
import type { SeedDiag } from "./retrieval-diag";
```

- [ ] **Step 3: Add `selectEmbeddingScoredDiag` and refactor `selectEmbeddingScored`**

Replace the whole `selectEmbeddingScored` method (currently `src/page-similarity.ts:653-715`) with the diag-returning variant plus a thin compatibility wrapper:

```ts
  /** Embedding-scored selection that also reports dense-cosine confidence and failure. */
  private async selectEmbeddingScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<SeedDiag> {
    const { baseUrl, apiKey, model } = this.config;
    if (!baseUrl || !model) {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: false };
    }

    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated], this.config.dimensions);
    } catch {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: true };
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array[]>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], entry.chunks.map((c) => decodeVector(c.vector)));
      }
    }

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i] || pageVecs.has(pids[i])) continue;
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) { batches.push(cur); cur = { pids: [], texts: [] }; }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey!, model, batch.texts, this.config.dimensions);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], [vecs[i]]);
      } catch {
        for (const pid of batch.pids) pageVecs.set(pid, []);
      }
    }

    let denseMax = 0;
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vecs = pageVecs.get(pid);
      if (!vecs) continue;
      if (vecs.length === 0) {
        const s = scoreSeed(queryTokens, pid, "", annotations[i]);
        if (s > 0) scored.push({ path: allPaths[i], score: s });
      } else {
        const c = maxCosine(queryVec, vecs);
        if (c > denseMax) denseMax = c;
        if (c > 0) scored.push({ path: allPaths[i], score: c });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { results: scored.slice(0, limit), denseMax, embedFailed: false };
  }

  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<{ path: string; score: number }[]> {
    return (await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, limit)).results;
  }
```

> Behavior is identical to the old `selectEmbeddingScored` for the `.results` path — the only additions are `denseMax` (max cosine over pages with real vectors) and `embedFailed` (query-vector fetch threw).

- [ ] **Step 4: Add `selectRelevantScoredDiag` and refactor `selectHybridScored`**

Replace the whole `selectHybridScored` method (currently `src/page-similarity.ts:717-734`) with a diag-returning method plus the existing `.results` wrapper:

```ts
  /** Hybrid (dense ⊕ sparse) selection that also reports dense-cosine confidence. */
  private async selectHybridScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<SeedDiag> {
    const pool = Math.max(this.config.topK, RRF_CANDIDATE_POOL);
    const dense = await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, pool);
    const sparse = this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, pool);
    const fused = rrf([dense.results.map((x) => x.path), sparse.map((x) => x.path)], this.config.rrfK ?? 60);
    const results = fused.slice(0, this.config.topK).map((f) => ({ path: f.id, score: f.score }));
    return { results, denseMax: dense.denseMax, embedFailed: dense.embedFailed };
  }

  private async selectHybridScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<{ path: string; score: number }[]> {
    return (await this.selectHybridScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens)).results;
  }

  /** Diagnostics-bearing seed selection used by the query gate. */
  async selectRelevantScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<SeedDiag> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return { results: [], denseMax: 0, embedFailed: false };
    if (this.config.mode === "jaccard") {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths), denseMax: 0, embedFailed: false };
    }
    if (this.config.mode === "hybrid") {
      return this.selectHybridScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens);
    }
    return this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens);
  }
```

> `selectRelevantScored` (the non-diag method at line 397) is unchanged — `wiki-graph.ts:147` still uses it.

- [ ] **Step 5: Add the cosine→denseMax eval assertions**

In `eval/mobile-fixes/run.ts`, add this import at the top (after the existing import):

```ts
import { maxCosine } from "../../src/page-similarity";
```

And append before the final summary block:

```ts
section("maxCosine → denseMax feeds the gate");
const f = (xs: number[]) => Float32Array.from(xs);
check("identical vectors cosine 1", Math.abs(maxCosine(f([1, 0, 0]), [f([1, 0, 0])]) - 1) < 1e-6);
check("orthogonal vectors cosine 0", Math.abs(maxCosine(f([1, 0, 0]), [f([0, 1, 0])])) < 1e-6);
{
  const dense = maxCosine(f([1, 1, 0]), [f([0, 1, 0]), f([1, 1, 0])]); // best = exact match
  check("max-pool picks best chunk", Math.abs(dense - 1) < 1e-6);
  check("strong denseMax passes gate", seedPassesGate(dense, 0.3) === true);
}
check("orthogonal denseMax fails gate", seedPassesGate(maxCosine(f([1, 0]), [f([0, 1])]), 0.3) === false);
```

- [ ] **Step 6: Rebuild eval + plugin, run**

Run:
```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
npm run build
```
Expected: eval `ALL PASS: 14 passed, 0 failed`; `npm run build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/page-similarity.ts eval/mobile-fixes/run.ts
git commit -m "feat(retrieval): selectRelevantScoredDiag exposing denseMax + embedFailed"
```

---

## Task 4: Gate the query seed selection on `denseMax`

**Files:**
- Modify: `src/phases/query.ts:73-106` (seed block) and the `graph_stats` yield at line 155.

- [ ] **Step 1: Import the gate helper**

In `src/phases/query.ts`, add to the imports:

```ts
import { seedPassesGate } from "../retrieval-diag";
import type { RetrievalMode, SeedFallbackReason } from "../retrieval-diag";
```

- [ ] **Step 2: Rewrite the seed block**

Replace the current block (`src/phases/query.ts:74-106`):

```ts
  let seeds: string[];
  let seedScores: Record<string, number> = {};
  let seedFallback: "none" | "jaccard" | "llm" = "none";
  const syntheticPages = new Map<string, string>(
    [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );
  if (similarity && (similarity.config.mode === "embedding" || similarity.config.mode === "hybrid")) {
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const selected = await similarity.selectRelevantScored(question, indexAnnotations, allAnnotatedPaths);
    const topSelected = selected.slice(0, topK);
    seeds = topSelected.map((x) => pageId(x.path));
    seedScores = Object.fromEntries(topSelected.map((x) => [pageId(x.path), x.score]));

    // Threshold gate: weak seeds fall back to Jaccard, then to llmSelectSeeds.
    const maxSeedScore = seeds.length ? Math.max(...Object.values(seedScores)) : 0;
    if (maxSeedScore < seedSimilarityThreshold) {
      const jaccardSeeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
      if (jaccardSeeds.length > 0) {
        seeds = jaccardSeeds.map((x) => x.id);
        seedScores = Object.fromEntries(jaccardSeeds.map((x) => [x.id, x.score]));
        seedFallback = "jaccard";
      } else {
        seeds = [];
        seedScores = {};
        seedFallback = "llm"; // existing empty-seeds guard runs llmSelectSeeds below
      }
    }
  } else {
    const seedResults = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
    seeds = seedResults.map((x) => x.id);
    seedScores = Object.fromEntries(seedResults.map((x) => [x.id, x.score]));
  }
```

with:

```ts
  let seeds: string[];
  let seedScores: Record<string, number> = {};
  let seedFallback: "none" | "jaccard" | "llm" = "none";
  let retrievalMode: RetrievalMode = "jaccard";
  let denseMax = 0;
  let seedFallbackReason: SeedFallbackReason | undefined;
  const syntheticPages = new Map<string, string>(
    [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );
  if (similarity && (similarity.config.mode === "embedding" || similarity.config.mode === "hybrid")) {
    retrievalMode = similarity.config.mode;
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const diag = await similarity.selectRelevantScoredDiag(question, indexAnnotations, allAnnotatedPaths);
    denseMax = diag.denseMax;
    const topSelected = diag.results.slice(0, topK);
    seeds = topSelected.map((x) => pageId(x.path));
    seedScores = Object.fromEntries(topSelected.map((x) => [pageId(x.path), x.score]));

    // Threshold gate on the DENSE COSINE confidence (not the fused/RRF score):
    // weak embedding signal falls back to Jaccard, then to llmSelectSeeds.
    if (!seedPassesGate(denseMax, seedSimilarityThreshold)) {
      seedFallbackReason = diag.embedFailed ? "embed-failed" : "low-similarity";
      const jaccardSeeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
      if (jaccardSeeds.length > 0) {
        seeds = jaccardSeeds.map((x) => x.id);
        seedScores = Object.fromEntries(jaccardSeeds.map((x) => [x.id, x.score]));
        seedFallback = "jaccard";
      } else {
        seeds = [];
        seedScores = {};
        seedFallback = "llm"; // existing empty-seeds guard runs llmSelectSeeds below
      }
    }
  } else {
    const seedResults = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
    seeds = seedResults.map((x) => x.id);
    seedScores = Object.fromEntries(seedResults.map((x) => [x.id, x.score]));
  }
```

- [ ] **Step 3: Carry the new fields into the `graph_stats` yield**

In `src/phases/query.ts` line 155, change:

```ts
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback };
```
to:
```ts
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback, retrievalMode, denseMax, seedFallbackReason };
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts
git commit -m "fix(query): gate seeds on dense cosine, not RRF-fused score"
```

---

## Task 5: Show the retrieval tag in progress

**Files:**
- Modify: `src/view.ts:16-53` (`formatGraphStatsLines`).

- [ ] **Step 1: Import the tag helper**

In `src/view.ts`, add to the imports near the top:

```ts
import { retrievalTag } from "./retrieval-diag";
```

- [ ] **Step 2: Compact form — append the tag**

In `formatGraphStatsLines`, the compact branch currently (`src/view.ts:21-25`):

```ts
    const preview = ev.seeds.slice(0, 3).join(", ");
    const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
    const cacheHint = ev.fromCache ? " (cache hit)" : "";
    return [`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`];
```

Replace the `return` line with:

```ts
    const tag = ev.retrievalMode
      ? ` · ${retrievalTag(ev.retrievalMode, ev.seedFallback ?? "none", ev.seedFallbackReason, ev.denseMax)}`
      : "";
    return [`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}${tag}`];
```

- [ ] **Step 3: Trace form — replace the bare fallback line**

In the trace branch, replace (`src/view.ts:41-43`):

```ts
  if (ev.seedFallback && ev.seedFallback !== "none") {
    lines.push(`Seed fallback: ${ev.seedFallback}`);
  }
```
with:
```ts
  if (ev.retrievalMode) {
    lines.push(`Retrieval: ${retrievalTag(ev.retrievalMode, ev.seedFallback ?? "none", ev.seedFallbackReason, ev.denseMax)}`);
  } else if (ev.seedFallback && ev.seedFallback !== "none") {
    lines.push(`Seed fallback: ${ev.seedFallback}`);
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): retrieval tag in compact + trace progress"
```

---

## Task 6: Eval doc + live replay verification

**Files:**
- Create: `docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md`

- [ ] **Step 1: Write the eval doc**

Create `docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md`:

```markdown
# Mobile retrieval eval (gate + observability)

## Deterministic (no key)

```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
```
Expected: `ALL PASS`. Covers seed gate (dense cosine vs RRF-scale), retrieval tag,
cosine→denseMax, mobile-vision ext, source-folder filter.

## Live replay (homelab, native-agent hybrid)

Reproduces session `1781951993383`. With `hybridRetrieval: true`,
`seedSimilarityThreshold: 0.3`, `bge-m3`, run the query "График закаливания?" against
`https://homelab.ikeniborn.ru/v1`. Confirm `graph_stats` reports
`retrievalMode: hybrid`, a non-zero `denseMax ≥ 0.3`, NO `seedFallback`, and the
compact progress line ends with `· vector`. Before the fix the same query showed
`seedFallback: "jaccard"` and no vector tag.
```

- [ ] **Step 2: Run the deterministic eval once more to confirm**

Run:
```bash
node eval/mobile-fixes/run.cjs
```
Expected: `ALL PASS`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md
git commit -m "docs(eval): mobile retrieval gate eval + live replay steps"
```

- [ ] **Step 4: Manual live replay (record result)**

Perform the live replay from the eval doc in Obsidian (desktop is fine — same
`native-agent` hybrid path). Confirm the `· vector` tag appears and no Jaccard
fallback. Note the observed `denseMax` in the PR description. (No code change.)

---

# Part 2 — Hide mobile-irrelevant settings

## Task 7: Wrap chunking + Graph health in `!Platform.isMobile`

**Files:**
- Modify: `src/settings.ts` — chunking fields (`~746-765`) and the "Graph health" subsection (`~797-837`). `Platform` is already imported (line 1).

- [ ] **Step 1: Wrap the chunking fields**

In `src/settings.ts`, the four `chunkField(...)` calls (`Chunk size`, `Chunk overlap`,
`Min chunk size`, `Max chunks per page`) sit right after the `chunkField` helper
definition. Wrap exactly those four calls in a mobile guard:

```ts
        if (!Platform.isMobile) {
          chunkField("Chunk size (chars)",
            T.settings.chunkSize_desc(DEFAULT_CHUNKING.maxChars),
            String(DEFAULT_CHUNKING.maxChars),
            () => s.nativeAgent.chunkMaxChars ?? DEFAULT_CHUNKING.maxChars,
            (n) => { s.nativeAgent.chunkMaxChars = n; });
          chunkField("Chunk overlap (chars)",
            T.settings.chunkOverlap_desc(DEFAULT_CHUNKING.overlapChars),
            String(DEFAULT_CHUNKING.overlapChars),
            () => s.nativeAgent.chunkOverlapChars ?? DEFAULT_CHUNKING.overlapChars,
            (n) => { s.nativeAgent.chunkOverlapChars = n; });
          chunkField("Min chunk size (merge)",
            T.settings.chunkMin_desc(DEFAULT_CHUNKING.minChars),
            String(DEFAULT_CHUNKING.minChars),
            () => s.nativeAgent.chunkMinChars ?? DEFAULT_CHUNKING.minChars,
            (n) => { s.nativeAgent.chunkMinChars = n; });
          chunkField("Max chunks per page",
            T.settings.chunkMaxCount_desc(DEFAULT_CHUNKING.maxCount),
            String(DEFAULT_CHUNKING.maxCount),
            () => s.nativeAgent.chunkMaxCount ?? DEFAULT_CHUNKING.maxCount,
            (n) => { s.nativeAgent.chunkMaxCount = n; });
        }
```

(Replace the existing four un-wrapped `chunkField(...)` calls verbatim with the guarded version above.)

- [ ] **Step 2: Wrap the "Graph health" subsection**

Wrap the entire "Graph health" block — from `new Setting(containerEl).setName("Graph health").setHeading();` through the `mergeDeleteWarnThreshold` slider `Setting` (currently `src/settings.ts:797-837`) — in:

```ts
        if (!Platform.isMobile) {
          new Setting(containerEl).setName("Graph health").setHeading();
          // … Dedup on ingest, Dedup threshold, Lint near-duplicate report,
          //    Near-duplicate threshold, Merge-delete warn threshold (unchanged) …
        }
```

Keep all five inner `Setting(...)` blocks exactly as they are; only add the
`if (!Platform.isMobile) {` opening before the heading and the matching `}` after
the `mergeDeleteWarnThreshold` slider.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

In Obsidian settings (desktop): Semantic Search still shows Chunk* and Graph health.
Emulate mobile (or reason from the guard): both groups are absent; Semantic Search /
Retrieval / Graph / Jaccard / Vision remain. `timeouts` field unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): hide chunking + graph-health on mobile (ingest/lint-only)"
```

---

# Part 3 — Vision formatting on mobile

## Task 8: Image-only vision guard (pure helper + skip)

**Files:**
- Modify: `src/phases/attachment-analyzer.ts` — add `isVisionSupportedOnMobile`; add an `imageOnly` param to `analyzeSingleAttachment`.
- Modify: `eval/mobile-fixes/run.ts` — assert the helper.

- [ ] **Step 1: Add the pure helper**

In `src/phases/attachment-analyzer.ts`, after `getMimeType` (ends line 75), add:

```ts
/** True when the embed is a raster image vision can read without rendering (mobile-safe). */
export function isVisionSupportedOnMobile(path: string): boolean {
  return getMimeType(path) !== null; // png/jpg/jpeg/webp; PDF/Excalidraw need rendering
}
```

- [ ] **Step 2: Add `imageOnly` to `analyzeSingleAttachment`**

Change the signature (`src/phases/attachment-analyzer.ts:174-183`) to add a trailing
`imageOnly` parameter:

```ts
export async function analyzeSingleAttachment(
  path: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  sourcePath: string = "",
  language: OutputLanguage = "auto",
  visionTempStore?: VisionTempStore,
  imageOnly: boolean = false,
): Promise<string | null> {
  const resolved = vaultTools.resolveLink(path, sourcePath);
  if (resolved === null) return null;
  if (imageOnly && !isVisionSupportedOnMobile(resolved)) return null; // PDF/Excalidraw skipped on mobile
  const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
```

(Insert the single `imageOnly &&` guard line right after the existing
`if (resolved === null) return null;`; leave the rest of the body unchanged.)

- [ ] **Step 3: Assert the helper in the eval**

In `eval/mobile-fixes/run.ts`, add the import:

```ts
import { isVisionSupportedOnMobile } from "../../src/phases/attachment-analyzer";
```

And append before the summary block:

```ts
section("isVisionSupportedOnMobile");
check("png supported", isVisionSupportedOnMobile("img/a.png") === true);
check("jpg supported", isVisionSupportedOnMobile("img/a.JPG") === true);
check("webp supported", isVisionSupportedOnMobile("img/a.webp") === true);
check("pdf not supported", isVisionSupportedOnMobile("doc/a.pdf") === false);
check("excalidraw not supported", isVisionSupportedOnMobile("d/a.excalidraw") === false);
```

- [ ] **Step 4: Rebuild eval + run**

Run:
```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
```
Expected: `ALL PASS: 19 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/phases/attachment-analyzer.ts eval/mobile-fixes/run.ts
git commit -m "feat(vision): isVisionSupportedOnMobile + imageOnly skip in analyzeSingleAttachment"
```

---

## Task 9: Plumb `imageOnly` from controller → runFormat

**Files:**
- Modify: `src/phases/format.ts` — `visionSettings` shape (`imageOnly`), pass to `analyzeSingleAttachment`, mobile skip note.
- Modify: `src/agent-runner.ts` — constructor `isMobile`; set `visionSettings.imageOnly`.
- Modify: `src/controller.ts:548` — pass `Platform.isMobile`.

- [ ] **Step 1: Extend the `visionSettings` param in `runFormat`**

In `src/phases/format.ts`, change the `visionSettings` parameter type (line 91):

```ts
  visionSettings: { enabled: boolean; model: string; language?: "auto" | "ru" | "en" | "es"; imageOnly?: boolean } = { enabled: false, model: "" },
```

- [ ] **Step 2: Pass `imageOnly` into the analyzer and note skips**

In `src/phases/format.ts`, inside the vision loop, change the analyze call (line 138):

```ts
          const description = await analyzeSingleAttachment(path, vaultTools, llm, visionSettings.model, signal, filePath, lang, visionTempStore, visionSettings.imageOnly ?? false);
```

And change the "unknown extension" skip branch (lines 143-146) to name the mobile case:

```ts
          } else {
            const why = (visionSettings.imageOnly ?? false) ? "unsupported on mobile" : "unknown extension";
            yield { kind: "tool_result", ok: false, preview: why };
            yield { kind: "info_text", icon: "⚠️", summary: "Vision skipped", details: [`${path} — ${why}`] };
          }
```

- [ ] **Step 3: Add `isMobile` to the AgentRunner constructor**

In `src/agent-runner.ts`, extend the constructor (lines 20-29):

```ts
  constructor(
    llm: LlmClient,
    private settings: LlmWikiPluginSettings,
    private vaultTools: VaultTools,
    private vaultName: string,
    private domains: DomainEntry[],
    private visionTempBaseDir?: string,
    private isMobile: boolean = false,
  ) {
    this.llm = wrapWithJsonFallback(llm);
  }
```

- [ ] **Step 4: Set `imageOnly` when building format vision settings**

In `src/agent-runner.ts`, the format case (lines 144-149), change `baseVisionSettings`:

```ts
        const baseVisionSettings = {
          enabled: this.settings.vision?.enabled ?? false,
          model: this.settings.vision?.model ?? "",
          language: this.settings.outputLanguage ?? "auto",
          imageOnly: this.isMobile,
        };
```

- [ ] **Step 5: Pass `Platform.isMobile` from the controller**

In `src/controller.ts:548`, change:

```ts
    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? undefined);
```
to:
```ts
    return new AgentRunner(llm, s, vaultTools, vaultName, domains, this.plugin.manifest.dir ?? undefined, Platform.isMobile);
```

(`Platform` is already imported in `src/controller.ts:1`.)

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/phases/format.ts src/agent-runner.ts src/controller.ts
git commit -m "feat(format): thread imageOnly so mobile vision skips PDF/Excalidraw cleanly"
```

---

## Task 10: Mobile Format button

**Files:**
- Modify: `src/view.ts` — add a Format button in the mobile branch (`~170-173`); declare it once (the field `formatBtn` already exists, line 91).

- [ ] **Step 1: Add the button in the mobile branch**

In `src/view.ts`, the mobile `else` branch currently (`~170-173`):

```ts
    } else {
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomainMobile });
      this.buildDomainRow(root as HTMLElement, { withActions: false });
    }
```

Replace with:

```ts
    } else {
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomainMobile });
      this.buildDomainRow(root as HTMLElement, { withActions: false });
      const mobileActions = root.createDiv("ai-wiki-domain-actions");
      this.formatBtn = mobileActions.createEl("button", { text: T.view.format });
      this.formatBtn.addEventListener("click", () => void this.plugin.controller.format());
    }
```

> The existing `updateButtonAvailability()` (`src/view.ts:379`) already toggles
> `this.formatBtn.disabled` from `canFormat`, and the `file-open` subscription
> (`src/view.ts:373`) already runs on mobile — no extra wiring needed.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification**

On mobile (or emulated): the AI-wiki panel shows a Format button under the domain
row; it is disabled when no file is open or the active file is under `!Wiki/`, and
enabled for an ordinary note. Tapping it runs format (with the FormatVision modal when
vision is enabled). Format a note embedding a PNG → a `Vision` step + the description
appears under the embed. Embed a PDF → one "Vision skipped … unsupported on mobile"
note, no crash.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): mobile Format button (vision-capable)"
```

---

# Part 4 — Exclude `!Wiki` from source-path suggestions

## Task 11: Source-folder filter

**Files:**
- Modify: `src/source-paths.ts` — add `isSelectableSourceFolder`.
- Modify: `src/modals.ts` — filter in `FolderInputSuggest.getSuggestions`; import `WIKI_ROOT`.
- Modify: `eval/mobile-fixes/run.ts` — assert the filter.

- [ ] **Step 1: Add the pure filter helper**

In `src/source-paths.ts`, add at the top (after the existing import):

```ts
import { WIKI_ROOT } from "./wiki-path";

/** A vault folder is a valid domain source iff it is not the wiki output tree. */
export function isSelectableSourceFolder(path: string): boolean {
  return path !== WIKI_ROOT && !path.startsWith(`${WIKI_ROOT}/`);
}
```

- [ ] **Step 2: Apply the filter in the suggester**

In `src/modals.ts`, add the import near the top (alongside the other `./` imports):

```ts
import { isSelectableSourceFolder } from "./source-paths";
```

Then in `FolderInputSuggest.getSuggestions` (`src/modals.ts:180-185`), change:

```ts
  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter(f => f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }
```
to:
```ts
  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter(f => isSelectableSourceFolder(f.path) && f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }
```

- [ ] **Step 3: Assert the filter in the eval**

In `eval/mobile-fixes/run.ts`, add the import:

```ts
import { isSelectableSourceFolder } from "../../src/source-paths";
```

And append before the summary block:

```ts
section("isSelectableSourceFolder — exclude !Wiki output");
check("ordinary folder selectable", isSelectableSourceFolder("Проекты/Bagato") === true);
check("!Wiki root excluded", isSelectableSourceFolder("!Wiki") === false);
check("!Wiki subtree excluded", isSelectableSourceFolder("!Wiki/sar/dags") === false);
check("lookalike not excluded", isSelectableSourceFolder("!WikiNotes/x") === true);
```

- [ ] **Step 4: Rebuild eval + plugin, run**

Run:
```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
npm run build
```
Expected: eval `ALL PASS: 23 passed, 0 failed`; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/source-paths.ts src/modals.ts eval/mobile-fixes/run.ts
git commit -m "fix(modals): exclude !Wiki output from domain source-path suggestions"
```

---

# Finalize

## Task 12: Docs, lint, dist, PR

**Files:**
- Modify: `docs/wiki/*` via iwiki.
- Modify: `dist/` bundle.

- [ ] **Step 1: Update the wiki docs**

Run iwiki ingest for the changed sources, then lint:
```
Skill iwiki:iwiki-ingest on src/phases/query.ts, src/page-similarity.ts, src/view.ts, src/settings.ts, src/phases/format.ts, src/modals.ts
Skill iwiki:iwiki-lint
```
Manually confirm these pages reflect the changes:
- `docs/wiki/retrieval.md#Fusion` and `docs/wiki/operations.md#Tier 2 Features` — the gate now compares `seedSimilarityThreshold` to dense cosine (`denseMax`) in both embedding and hybrid modes.
- `docs/wiki/operations.md#Format` — mobile Format trigger + image-only vision.
- `docs/wiki/index.md#Source layout` — `!Wiki` excluded from source suggestions.
- mobile-hidden settings noted where backends/config are documented.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors in touched files. (Baseline tsc is not clean — gate on NEW errors in touched files only.)

- [ ] **Step 3: Rebuild the dist bundle**

Run: `npm run build`
Expected: `dist/main.js` (and styles) rebuilt.

- [ ] **Step 4: Commit docs + dist**

```bash
git add docs/wiki dist
git commit -m "docs(wiki): retrieval gate, mobile settings/vision, source-suggest; rebuild dist"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin dev/mobile-retrieval-vision
gh pr create --base master --title "Mobile fixes: retrieval gate, settings hiding, vision format, source-suggest" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-06-20-mobile-retrieval-vision-settings-design.md.

- Part 1: seed gate compares seedSimilarityThreshold to dense cosine (not the RRF-fused
  score), so vector/hybrid seeds are actually used; retrieval tag in compact + trace progress.
- Part 2: hide chunking + Graph health settings on mobile (ingest/lint-only).
- Part 3: mobile Format button; image-only vision with graceful PDF/Excalidraw skip.
- Part 4: exclude !Wiki output from domain source-path suggestions.

Deterministic eval: eval/mobile-fixes (ALL PASS). Live replay: query reports
retrievalMode hybrid + denseMax ≥ 0.3 + vector tag (was jaccard fallback).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- R1 (gate on dense cosine) → Tasks 1, 3, 4. ✓
- R2 (observability: graph_stats fields + compact tag + failed/weak distinction) → Tasks 2, 4, 5. ✓
- R3 (hide mobile settings) → Task 7. ✓
- R4 (mobile format trigger) → Task 10. ✓
- R5 (mobile vision images + graceful skip) → Tasks 8, 9. ✓
- R6 (exclude !Wiki from source suggest) → Task 11. ✓
- Verification (eval + replay) → Tasks 1/3/6/8/11 evals; Task 6 replay. ✓
- Docs/dist/lint → Task 12. ✓

**Placeholder scan:** No TODO/TBD/"add error handling"/"similar to" — every code step shows the full code. ✓

**Type consistency:** `SeedDiag`/`RetrievalMode`/`SeedFallbackReason` defined in Task 1, imported by Tasks 2/3/4. `selectRelevantScoredDiag` (Task 3) is the name used in Task 4. `seedPassesGate`/`retrievalTag` (Task 1) used in Tasks 4/5. `isVisionSupportedOnMobile` (Task 8) used in Task 8 guard. `imageOnly` flows: controller → `AgentRunner.isMobile` (Task 9.3/9.5) → `baseVisionSettings.imageOnly` (Task 9.4) → `runFormat` param (Task 9.1) → `analyzeSingleAttachment` arg (Task 9.2/8.2). `isSelectableSourceFolder` (Task 11) consistent across helper + caller + eval. ✓
