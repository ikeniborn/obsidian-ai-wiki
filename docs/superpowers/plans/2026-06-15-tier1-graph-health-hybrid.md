# Tier 1 — Graph Health + Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the wiki graph healthy (dedup on Ingest + near-duplicate report in Lint) and make seed retrieval hybrid (dense embedding fused with sparse jaccard via RRF), all behind safe-off flags and measured by the existing eval harness.

**Architecture:** A reusable pure `rrf()` util fuses two ranked lists by reciprocal rank. `PageSimilarityService` gains a `hybrid` mode (fuse `embedding` ⊕ `jaccard`), a `maxSimilarityToExisting()` method (dedup scoring), and a `pairwiseNearDuplicates()` method (lint scoring). Ingest's write loop gains a post-LLM cosine gate that, on a near-duplicate create, runs one LLM merge call and writes the merged page into the existing one instead of spawning a duplicate. Lint reports near-duplicate page pairs. The eval harness gets a `hybrid` config so the tier is measurable.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest, OpenAI-compatible `/embeddings` (Ollama), `tsx` eval harness.

**Spec:** [docs/superpowers/specs/2026-06-15-tier1-graph-health-hybrid-design.md](../specs/2026-06-15-tier1-graph-health-hybrid-design.md)

**Conventions in this repo (verified):**
- Tests: `tests/*.test.ts`, run with `npx vitest run <file>`.
- Embedding cache: `EmbeddingCacheFile { version:2, model, dimensions, entries: { pid: { chunks: [{vector(b64), hash, kind}] } } }` (`src/page-similarity.ts:41`).
- Page object from Ingest LLM: `{ path, content, annotation? }` (`WikiPageSchema`, `src/phases/zod-schemas.ts:41`).
- `pageId(path)` → file stem (`src/wiki-graph.ts`). `tokenize`, `scoreSeed` from `src/wiki-seeds.ts`.
- New settings flow through `effective-settings.ts` automatically (it spreads `...s.nativeAgent`); only `DEFAULT_SETTINGS` + the `nativeAgent` interface need the new optional fields.
- Settings UI mixes `T.settings.*` and inline strings (e.g. `src/settings.ts:530` `"Per-operation models"`); inline Russian strings are acceptable for new controls — no i18n churn required.

---

## File Structure

**Create:**
- `src/rrf.ts` — pure reciprocal-rank-fusion util. One responsibility: fuse ranked ID lists.
- `tests/rrf.test.ts` — unit tests for `rrf()`.
- `prompts/ingest-merge.md` — merge prompt for the dedup gate.

**Modify:**
- `src/page-similarity.ts` — `hybrid` mode + `rrfK`; `RRF_CANDIDATE_POOL`; `maxSimilarityToExisting()`; `pairwiseNearDuplicates()`; widened-pool `limit` on the two scored methods.
- `src/phases/query.ts:72` — accept `hybrid` in the embedding seed branch.
- `src/phases/zod-schemas.ts` — `MergedPageOutputSchema`.
- `src/phases/parse-with-retry.ts` — add `"ingest.merge"` to `CallSite`.
- `src/phases/ingest.ts` — dedup gate in the write loop.
- `src/phases/lint.ts` — near-duplicate report.
- `src/agent-runner.ts` — `buildSimilarity()` hybrid mode + `rrfK`; `buildOptsFor()` thread new flags into `LlmCallOptions`.
- `src/types.ts` — `LlmCallOptions` new fields; `nativeAgent` interface new fields; `DEFAULT_SETTINGS.nativeAgent` new defaults.
- `src/settings.ts` — toggles/number inputs for the new flags.
- `scripts/eval-config.ts`, `scripts/eval-retrieval.ts` — `hybrid` eval config.
- `tests/page-similarity.test.ts`, `tests/eval-config.test.ts`, `tests/ingest.test.ts` — coverage.
- `lat.md/tests.md`, `lat.md/operations.md`, `lat.md/architecture.md` — docs.

**Locked API (used across tasks — keep names/signatures identical):**
- `rrf(rankedLists: string[][], k = 60): { id: string; score: number }[]`
- `RRF_CANDIDATE_POOL = 50` (const in `src/page-similarity.ts`)
- `SimilarityConfig.mode: "jaccard" | "embedding" | "hybrid"`, new `rrfK?: number`
- `PageSimilarityService.maxSimilarityToExisting(candidateText: string, excludePids: Set<string>): Promise<{ pid: string; score: number }>`
- `PageSimilarityService.pairwiseNearDuplicates(threshold: number, maxPages: number): { pairs: { a: string; b: string; score: number }[]; skippedPageCount: number }`

---

## Task 1: `rrf()` fusion util

**Files:**
- Create: `src/rrf.ts`
- Test: `tests/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/rrf.test.ts
import { describe, it, expect } from "vitest";
import { rrf } from "../src/rrf";

describe("rrf", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#RRF fuses ranked lists by reciprocal rank]]
  it("fuses two lists; an item ranked high in both wins", () => {
    const dense = ["A", "B", "C"];
    const sparse = ["B", "A", "D"];
    const fused = rrf([dense, sparse], 60);
    expect(fused.map((x) => x.id)).toEqual(["A", "B", "C", "D"]);
    // A: 1/61 + 1/62 ; B: 1/62 + 1/61 -> A == B mathematically; tie broken by first-seen (A before B)
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it("returns a single list unchanged in order", () => {
    expect(rrf([["X", "Y", "Z"]], 60).map((x) => x.id)).toEqual(["X", "Y", "Z"]);
  });

  it("ignores empty lists and never throws", () => {
    expect(rrf([[], ["P"]], 60).map((x) => x.id)).toEqual(["P"]);
    expect(rrf([], 60)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rrf.test.ts`
Expected: FAIL — `Cannot find module '../src/rrf'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rrf.ts
// Reciprocal Rank Fusion. Scale-free fusion of several ranked ID lists:
// score(id) = Σ over lists 1/(k + rank), rank 1-based. Higher = better.
// Reused by Tier 1 hybrid retrieval (dense ⊕ jaccard) and later Tier 2 (vector ⊕ BFS).
export function rrf(rankedLists: string[][], k = 60): { id: string; score: number }[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    }
  }
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score || firstSeen.get(a.id)! - firstSeen.get(b.id)!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rrf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rrf.ts tests/rrf.test.ts
git commit -m "feat(rrf): reciprocal rank fusion util (Tier 1 hybrid)"
```

---

## Task 2: `hybrid` mode in `PageSimilarityService`

Add the `hybrid` mode that fuses `embedding` and `jaccard` rankings via `rrf`, plus the widened candidate pool.

**Files:**
- Modify: `src/page-similarity.ts` (interface `SimilarityConfig:21`; `selectRelevant:251`; `selectRelevantScored:265`; scored methods `selectJaccardScored:500`, `selectEmbeddingScored:517`)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/page-similarity.test.ts — append
import { rrf } from "../src/rrf";

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
```

(Assumes `tests/page-similarity.test.ts` already imports `PageSimilarityService` and `describe/it/expect` — it does. Add only the new `describe` block and the `rrf` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/page-similarity.test.ts -t "hybrid mode"`
Expected: FAIL — `selectRelevantScored` throws/returns `[]` because `mode` typing rejects `"hybrid"` or the branch is missing.

- [ ] **Step 3: Implement — widen the mode type + pool constant**

In `src/page-similarity.ts`, change the interface (`:21`):

```typescript
export interface SimilarityConfig {
  mode: "jaccard" | "embedding" | "hybrid";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
  chunking?: ChunkingConfig;
  rrfK?: number;
}
```

Add a constant near `EMBEDDING_BATCH_SIZE` (`:201`):

```typescript
// Per-side candidate pool before RRF fusion in hybrid mode. Fixed (not the full
// vault) so cost stays flat; RRF then returns the caller's topK.
const RRF_CANDIDATE_POOL = 50;
```

- [ ] **Step 4: Implement — add `limit` to the two scored methods**

Change `selectJaccardScored` (`:500`) signature + final slice:

```typescript
  private selectJaccardScored(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    limit: number = this.config.topK,
  ): { path: string; score: number }[] {
    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
```

Change `selectEmbeddingScored` (`:517`) signature to accept `limit` and replace BOTH internal fallbacks + the final `slice(0, topK)` with `slice(0, limit)`:

```typescript
  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<{ path: string; score: number }[]> {
    const { baseUrl, apiKey, model } = this.config;
    if (!baseUrl || !model) {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit);
    }
    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated]);
    } catch {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit);
    }
    // ... unchanged batching/scoring body ...
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
```

(Keep the existing batching/scoring body between the try/catch and the final sort exactly as-is; only the signature, the two fallback calls, and the final `slice` change. Remove the now-unused `topK` destructure since `limit` replaces it.)

- [ ] **Step 5: Implement — hybrid branches + `selectHybridScored`**

In `selectRelevantScored` (`:265`) add the hybrid branch before the embedding return:

```typescript
    if (this.config.mode === "jaccard") {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }
    if (this.config.mode === "hybrid") {
      return this.selectHybridScored(sourceContent, indexAnnotations, allPaths, queryTokens);
    }
    return this.selectEmbeddingScored(sourceContent, indexAnnotations, allPaths, queryTokens);
```

In `selectRelevant` (`:251`) mirror it (return paths only):

```typescript
    if (this.config.mode === "jaccard") {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }
    if (this.config.mode === "hybrid") {
      return (await this.selectHybridScored(sourceContent, indexAnnotations, allPaths, queryTokens))
        .map((x) => x.path);
    }
    return this.selectEmbedding(sourceContent, indexAnnotations, allPaths, queryTokens);
```

Add the new private method (place after `selectEmbeddingScored`):

```typescript
  private async selectHybridScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<{ path: string; score: number }[]> {
    const pool = Math.max(this.config.topK, RRF_CANDIDATE_POOL);
    const [dense, sparse] = await Promise.all([
      this.selectEmbeddingScored(sourceContent, indexAnnotations, allPaths, queryTokens, pool),
      Promise.resolve(this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, pool)),
    ]);
    const byPath = new Map<string, number>();
    for (const r of dense) byPath.set(r.path, r.score);
    for (const r of sparse) if (!byPath.has(r.path)) byPath.set(r.path, r.score);
    const fused = rrf([dense.map((x) => x.path), sparse.map((x) => x.path)], this.config.rrfK ?? 60);
    return fused
      .slice(0, this.config.topK)
      .map((f) => ({ path: f.id, score: f.score }));
  }
```

Add the import at the top of `src/page-similarity.ts`:

```typescript
import { rrf } from "./rrf";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/page-similarity.test.ts -t "hybrid mode"`
Expected: PASS.

- [ ] **Step 7: Run the full similarity suite (no regressions)**

Run: `npx vitest run tests/page-similarity.test.ts`
Expected: PASS (all prior tests still green).

- [ ] **Step 8: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(similarity): hybrid mode — dense ⊕ jaccard via RRF"
```

---

## Task 3: Query picks up `hybrid` mode

`query.ts` only takes the embedding seed path when `mode === "embedding"`. Hybrid must take the same path.

**Files:**
- Modify: `src/phases/query.ts:72`

- [ ] **Step 1: Implement the guard change**

Change (`:72`):

```typescript
  if (similarity && (similarity.config.mode === "embedding" || similarity.config.mode === "hybrid")) {
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const selected = await similarity.selectRelevantScored(question, indexAnnotations, allAnnotatedPaths);
```

(`loadCache` no-ops unless mode is `embedding`; in `hybrid` the cache is still needed for the dense half — change `loadCache` guard in Task 2 file is NOT required because `selectEmbeddingScored` reads `this.cache`. Update `loadCache`'s mode guard at `src/page-similarity.ts:581` to also load for hybrid:)

```typescript
  async loadCache(domainRoot: string, vaultTools: VaultTools): Promise<void> {
    if (this.config.mode === "jaccard") return;
    if (this.cache) return;
    // ... rest unchanged ...
```

- [ ] **Step 2: Run the query + similarity suites**

Run: `npx vitest run tests/page-similarity.test.ts tests/wiki-seeds.test.ts`
Expected: PASS. (No dedicated query unit test exercises this branch; integration is covered by the eval harness in Task 5.)

- [ ] **Step 3: Typecheck touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "query.ts|page-similarity.ts" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 4: Commit**

```bash
git add src/phases/query.ts src/page-similarity.ts
git commit -m "feat(query): take hybrid seeds path; load cache for hybrid"
```

---

## Task 4: Wire `hybrid` into settings + `buildSimilarity`

Opt into hybrid via `nativeAgent.hybridRetrieval`; pass `rrfK`.

**Files:**
- Modify: `src/types.ts` (`nativeAgent` interface; `DEFAULT_SETTINGS.nativeAgent`)
- Modify: `src/agent-runner.ts:51` (`buildSimilarity`)
- Modify: `src/settings.ts` (native section UI)

- [ ] **Step 1: Add settings fields (types)**

In `src/types.ts`, add to the `nativeAgent` interface (after `chunkMaxCount?`):

```typescript
    hybridRetrieval?: boolean;
    rrfK?: number;
    dedupOnIngest?: boolean;
    dedupThreshold?: number;
    lintNearDuplicate?: boolean;
    nearDupThreshold?: number;
```

In `DEFAULT_SETTINGS.nativeAgent`, add:

```typescript
    hybridRetrieval: false,
    rrfK: 60,
    dedupOnIngest: false,
    dedupThreshold: 0.85,
    lintNearDuplicate: false,
    nearDupThreshold: 0.80,
```

- [ ] **Step 2: `buildSimilarity` hybrid mode**

In `src/agent-runner.ts:54`, replace the `new PageSimilarityService({ ... })` `mode`/add `rrfK`:

```typescript
    return new PageSimilarityService({
      mode:
        na.embeddingModel === undefined ? "jaccard"
        : na.hybridRetrieval ? "hybrid"
        : "embedding",
      model: na.embeddingModel,
      dimensions: na.embeddingDimensions,
      topK: na.relevantPagesTopK ?? 15,
      baseUrl: na.baseUrl,
      apiKey: na.apiKey,
      rrfK: na.rrfK ?? 60,
      chunking: { /* unchanged */ },
    });
```

- [ ] **Step 3: Settings UI toggle (inline strings)**

In `src/settings.ts`, in the native-agent section (near the chunking controls), add:

```typescript
new Setting(containerEl).setName("Retrieval").setHeading();
new Setting(containerEl)
  .setName("Hybrid retrieval (dense ⊕ sparse)")
  .setDesc("Фьюзить embedding и jaccard через RRF. Требует embedding-модель; без неё — обычный jaccard.")
  .addToggle((t) =>
    t.setValue(s.nativeAgent.hybridRetrieval ?? false)
      .onChange(async (v) => { s.nativeAgent.hybridRetrieval = v; await this.plugin.saveSettings(); }),
  );
new Setting(containerEl)
  .setName("RRF k")
  .setDesc("Константа RRF. По умолчанию 60.")
  .addText((t) =>
    t.setValue(String(s.nativeAgent.rrfK ?? 60))
      .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) { s.nativeAgent.rrfK = Math.floor(n); await this.plugin.saveSettings(); } }),
  );
```

- [ ] **Step 4: Typecheck + settings tests**

Run: `npx vitest run tests/settings.test.ts tests/effective-settings.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "types.ts|agent-runner.ts|settings.ts" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agent-runner.ts src/settings.ts
git commit -m "feat(settings): hybrid retrieval toggle + rrfK; graph-health flag fields"
```

---

## Task 5: `hybrid` eval config (measurement)

Make hybrid measurable with the existing harness.

**Files:**
- Modify: `scripts/eval-config.ts`, `scripts/eval-retrieval.ts`
- Test: `tests/eval-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/eval-config.test.ts — append
// @lat: [[tests#Tier 1 — Graph Health + Hybrid#Eval harness resolves the hybrid config]]
it("resolves hybrid config to hybrid mode", () => {
  const cfgs = resolveConfigs("hybrid", 1, 8);
  expect(cfgs[0]).toMatchObject({ name: "hybrid", mode: "hybrid", bfsDepth: 1, topK: 8 });
});
```

(Reuse the existing `resolveConfigs` import in that test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval-config.test.ts -t "hybrid"`
Expected: FAIL — `unknown --config "hybrid"`.

- [ ] **Step 3: Implement — config registry**

In `scripts/eval-config.ts`:

```typescript
export interface ConfigRecord {
  name: string;
  mode: "embedding" | "jaccard" | "hybrid";
  bfsDepth: number;
  topK: number;
}

const NAME_TO_MODE: Record<string, ConfigRecord["mode"]> = {
  dense: "embedding",
  jaccard: "jaccard",
  hybrid: "hybrid",
};
```

And update the error string:

```typescript
      throw new Error(`unknown --config "${name}" (expected: dense, jaccard, hybrid)`);
```

- [ ] **Step 4: Implement — retrieval orchestration**

In `scripts/eval-retrieval.ts`, the `embedding` branch already builds a service and runs `selectRelevantScored` + `bfsExpandRanked`. Generalise it so it also handles `hybrid` (both go through `selectRelevantScored`, which dispatches on mode). Change the branch guard:

```typescript
  if (cfg.mode === "embedding" || cfg.mode === "hybrid") {
    const service = new PageSimilarityService({
      mode: cfg.mode,
      model: embed.model,
      dimensions: embed.dimensions,
      baseUrl: embed.baseUrl,
      apiKey: embed.apiKey,
      topK: cfg.topK,
      rrfK: 60,
    });
    await service.loadCache(wikiVaultPath, fs as unknown as VaultTools);
    if (!embed.baseUrl || !embed.model) {
      console.warn(
        `[eval] config "${cfg.name}" requested ${cfg.mode}, but no embedding endpoint/model ` +
          `configured. Dense half falls back to jaccard internally.`,
      );
    }
    return async (question) => {
      const scored = await service.selectRelevantScored(question, annotations, allAnnotatedPaths);
      const seeds = scored.slice(0, cfg.topK).map((x) => pageId(x.path));
      const { selectedIds } = await bfsExpandRanked(
        seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
      );
      return { seed: seeds, union: [...selectedIds] };
    };
  }
```

- [ ] **Step 5: Run tests + typecheck the harness**

Run: `npx vitest run tests/eval-config.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p scripts/tsconfig.eval.json 2>&1 | grep -E "eval-config.ts|eval-retrieval.ts" || echo "no new errors"`
Expected: `no new errors`.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval-config.ts scripts/eval-retrieval.ts tests/eval-config.test.ts
git commit -m "feat(eval): hybrid config — measure dense vs jaccard vs hybrid"
```

---

## Task 6: `maxSimilarityToExisting()` — dedup scoring

The score the Ingest gate uses to detect a near-duplicate create.

**Files:**
- Modify: `src/page-similarity.ts`
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/page-similarity.test.ts — append
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/page-similarity.test.ts -t "maxSimilarityToExisting"`
Expected: FAIL — method/`setJaccardCorpus` undefined.

- [ ] **Step 3: Implement**

Add a Jaccard-coefficient helper near `cosine` (`:177`):

```typescript
function jaccardCoeff(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

Add a private field + a test seam + the method to `PageSimilarityService`:

```typescript
  // Corpus for jaccard-mode dedup scoring (pid -> annotation). Set by the caller
  // (Ingest) which already holds the index annotations; also settable in tests.
  private jaccardCorpus: Map<string, string> = new Map();
  setJaccardCorpus(corpus: Map<string, string>): void { this.jaccardCorpus = corpus; }

  /**
   * Max similarity of `candidateText` to any existing page, excluding `excludePids`.
   * embedding/hybrid: max-pool cosine over the loaded cache. jaccard: Jaccard coefficient
   * over the supplied corpus. Returns { pid:"", score:0 } when nothing scores or on embed failure.
   */
  async maxSimilarityToExisting(
    candidateText: string,
    excludePids: Set<string>,
  ): Promise<{ pid: string; score: number }> {
    if (this.config.mode === "jaccard") {
      const cand = tokenize(candidateText);
      let best = { pid: "", score: 0 };
      for (const [pid, annotation] of this.jaccardCorpus) {
        if (excludePids.has(pid)) continue;
        const score = jaccardCoeff(cand, tokenize(annotation));
        if (score > best.score) best = { pid, score };
      }
      return best;
    }
    // embedding / hybrid
    const { baseUrl, apiKey, model } = this.config;
    if (!this.cache || !baseUrl || !model) return { pid: "", score: 0 };
    let candVec: Float32Array;
    try {
      [candVec] = await fetchEmbeddings(baseUrl, apiKey ?? "", model, [candidateText.slice(0, 2000)]);
    } catch {
      return { pid: "", score: 0 }; // never fire the gate on a failed signal
    }
    let best = { pid: "", score: 0 };
    for (const [pid, entry] of Object.entries(this.cache.entries)) {
      if (excludePids.has(pid)) continue;
      const vecs = entry.chunks.map((c) => decodeVector(c.vector));
      const score = maxCosine(candVec, vecs);
      if (score > best.score) best = { pid, score };
    }
    return best;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/page-similarity.test.ts -t "maxSimilarityToExisting"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(similarity): maxSimilarityToExisting for dedup gate"
```

---

## Task 7: Merge schema + prompt for the dedup gate

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Modify: `src/phases/parse-with-retry.ts` (CallSite)
- Create: `prompts/ingest-merge.md`

- [ ] **Step 1: Add the merge schema**

In `src/phases/zod-schemas.ts`, after `WikiPageSchema`:

```typescript
export const MergedPageOutputSchema = z.object({
  reasoning: z.string().optional(),
  content: z.string(),
  annotation: z.string().optional(),
});
export type MergedPageOutput = z.infer<typeof MergedPageOutputSchema>;
```

- [ ] **Step 2: Add the CallSite**

In `src/phases/parse-with-retry.ts`, extend the `CallSite` union:

```typescript
  | "ingest.pages"
  | "ingest.merge"
  | "format.output";
```

- [ ] **Step 3: Write the merge prompt**

```markdown
<!-- prompts/ingest-merge.md -->
Ты объединяешь две вики-страницы об одной сущности в одну.

СУЩЕСТВУЮЩАЯ СТРАНИЦА (сохрани её frontmatter, путь и wiki_sources):
{{existing}}

НОВЫЙ ЧЕРНОВИК (та же тема, добавь уникальные факты из него):
{{incoming}}

Правила:
- Верни ОДНУ объединённую страницу. Не теряй факты ни из одной из них.
- Сохрани frontmatter существующей страницы; добавь недостающие wiki_sources из черновика.
- Не дублируй разделы; сливай близкие.
- Формат ответа — строго JSON: { "content": "<полный markdown страницы>", "annotation": "<одна строка для индекса>" }.
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "zod-schemas.ts|parse-with-retry.ts" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add src/phases/zod-schemas.ts src/phases/parse-with-retry.ts prompts/ingest-merge.md
git commit -m "feat(ingest): merge schema + prompt for dedup gate"
```

---

## Task 8: Dedup gate in the Ingest write loop

Wire the gate: thread flags through `LlmCallOptions`, detect near-duplicate creates, run the LLM merge, write into the existing page.

**Files:**
- Modify: `src/types.ts` (`LlmCallOptions`)
- Modify: `src/agent-runner.ts` (`buildOptsFor`)
- Modify: `src/phases/ingest.ts` (write loop)
- Test: `tests/ingest.test.ts`

- [ ] **Step 1: Extend `LlmCallOptions`**

In `src/types.ts`, add to `LlmCallOptions`:

```typescript
  dedupOnIngest?: boolean;
  dedupThreshold?: number;
  lintNearDuplicate?: boolean;
  nearDupThreshold?: number;
```

- [ ] **Step 2: Thread flags in `buildOptsFor`**

In `src/agent-runner.ts:buildOptsFor`, both the per-op (`:47`) and default (`:48`) return objects already pass `mergeDeleteWarnThreshold`. Add the four flags from `na` to the shared `opts` object in both returns:

```typescript
      dedupOnIngest: na.dedupOnIngest, dedupThreshold: na.dedupThreshold,
      lintNearDuplicate: na.lintNearDuplicate, nearDupThreshold: na.nearDupThreshold,
```

- [ ] **Step 3: Write the failing integration test**

```typescript
// tests/ingest.test.ts — append a focused test
// @lat: [[tests#Tier 1 — Graph Health + Hybrid#Dedup gate merges a near-duplicate create]]
it("dedup gate: a near-duplicate create is merged into the existing page, not spawned", async () => {
  // Build a vault where an existing page "wiki_d_alpha" exists, the LLM proposes a NEW page
  // near-identical to it, similarity.maxSimilarityToExisting returns score >= threshold,
  // and the merge LLM returns merged content.
  // Assert: no second file created; existing page written once (Update); a dedup event emitted.
  // (Use the existing ingest test harness/mocks in this file as the template — mock `llm`
  //  to return entities, then pages with one create-candidate, then the merge JSON.)
  // ...
  expect(createdPaths).not.toContain("!Wiki/d/e/wiki_d_alpha2.md");
  expect(dedupEvents.length).toBe(1);
});
```

(Fill the body using the mocks already present in `tests/ingest.test.ts`. The dedup path needs `opts.dedupOnIngest = true`, `opts.dedupThreshold = 0.85`, and a `similarity` stub whose `maxSimilarityToExisting` resolves `{ pid: "wiki_d_alpha", score: 0.92 }` and `loadCache` is a no-op.)

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/ingest.test.ts -t "dedup gate"`
Expected: FAIL — duplicate page is created (gate not implemented).

- [ ] **Step 5: Implement the gate in the write loop**

In `src/phases/ingest.ts`, before the write loop (`:316`), build a pid→path map and the merge import. At top of file add:

```typescript
import { MergedPageOutputSchema } from "./zod-schemas";
import ingestMerge from "../../prompts/ingest-merge.md";
import { render } from "./template";
```

Just before `for (const page of pages) {`:

```typescript
  const dedupOn = (opts.dedupOnIngest ?? false) && (opts.dedupThreshold ?? 0) > 0 && !!similarity;
  const dedupThreshold = opts.dedupThreshold ?? 0.85;
  const pidToPath = new Map(nonMetaPaths.map((p) => [pageId(p), p]));
  const createdThisRun = new Set<string>();
  if (dedupOn && similarity!.config.mode === "jaccard") similarity!.setJaccardCorpus(annotations);
```

Inside the loop, right after `existingContent` is read (`:324`) and before the frontmatter repair, add the gate (only for creates):

```typescript
    if (dedupOn && existingContent === null) {
      const candidateText = `${page.annotation ?? ""}\n\n${page.content}`;
      const exclude = new Set<string>([pageId(page.path), ...createdThisRun]);
      const hit = await similarity!.maxSimilarityToExisting(candidateText, exclude);
      if (hit.pid && hit.score >= dedupThreshold) {
        const targetPath = pidToPath.get(hit.pid);
        let existingTarget: string | null = null;
        if (targetPath) { try { existingTarget = await vaultTools.read(targetPath); } catch { /* gone */ } }
        if (targetPath && existingTarget !== null) {
          yield { kind: "info_text", icon: "🔁",
            summary: `Дубль: ${pageId(page.path)} ≈ ${hit.pid} (cosine ${hit.score.toFixed(2)}) → merge`,
            details: [targetPath] };
          const mergeMsgs = [{ role: "user" as const, content:
            render(ingestMerge, { existing: existingTarget, incoming: page.content }) }];
          try {
            const merged = await parseWithRetry({
              llm, model, baseMessages: mergeMsgs, opts,
              schema: MergedPageOutputSchema,
              maxRetries: opts.structuredRetries ?? 1,
              callSite: "ingest.merge", signal, onEvent: () => {},
            });
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            await vaultTools.write(targetPath, merged.value.content);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
            const relTarget = targetPath.slice(wikiVaultPath.length + 1);
            logEntries.push({ path: relTarget, action: "ОБЪЕДИНЕНА" });
            if (merged.value.annotation) {
              try { await upsertIndexAnnotation(vaultTools, wikiVaultPath, hit.pid, merged.value.annotation, targetPath); } catch { /* non-critical */ }
            }
            continue; // skip the normal create
          } catch (e) {
            // merge failed — fall through to a normal create rather than lose the new content
            yield { kind: "info_text", icon: "⚠️", summary: `merge не удался, создаю отдельно: ${(e as Error).message}` };
          }
        }
      }
    }
    if (existingContent === null) createdThisRun.add(pageId(page.path));
```

(Note: `IngestLogEntry` must accept `action: "ОБЪЕДИНЕНА"`. Check its type near the top of `ingest.ts`; if `action` is a string-literal union, add `"ОБЪЕДИНЕНА"`. The summary counter at `:409` counts `"УДАЛЕНА"` — leave it; merges are surfaced via the event + log.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/ingest.test.ts -t "dedup gate"`
Expected: PASS.

- [ ] **Step 7: Full ingest suite + typecheck**

Run: `npx vitest run tests/ingest.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ingest.ts|types.ts|agent-runner.ts" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent-runner.ts src/phases/ingest.ts tests/ingest.test.ts
git commit -m "feat(ingest): post-LLM cosine dedup gate with LLM-merge"
```

---

## Task 9: Lint near-duplicate report

**Files:**
- Modify: `src/page-similarity.ts` (`pairwiseNearDuplicates`)
- Modify: `src/phases/lint.ts` (emit the report)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/page-similarity.test.ts — append
describe("pairwiseNearDuplicates", () => {
  // @lat: [[tests#Tier 1 — Graph Health + Hybrid#Lint surfaces near-duplicate page pairs]]
  it("returns pairs at/above threshold and skips when over the page cap", () => {
    const svc = new PageSimilarityService({ mode: "embedding", model: "m", dimensions: 2 });
    // seed the in-memory cache directly via the test seam
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
    // over the cap -> skip
    const over = svc.pairwiseNearDuplicates(0.9, 2);
    expect(over.skippedPageCount).toBe(3);
    expect(over.pairs).toEqual([]);
  });
});
```

(`encodeVector` is already exported from `src/page-similarity.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/page-similarity.test.ts -t "pairwiseNearDuplicates"`
Expected: FAIL — method/`setCacheForTest` undefined.

- [ ] **Step 3: Implement**

In `src/page-similarity.ts`, add a test seam and the method:

```typescript
  setCacheForTest(cache: EmbeddingCacheFile): void { this.cache = cache; }

  /**
   * All unordered page pairs whose max-pool cosine ≥ threshold. Embedding-only (uses the
   * loaded cache). Skips entirely when the page count exceeds maxPages (cost guard);
   * the caller logs skippedPageCount.
   */
  pairwiseNearDuplicates(
    threshold: number,
    maxPages: number,
  ): { pairs: { a: string; b: string; score: number }[]; skippedPageCount: number } {
    if (!this.cache) return { pairs: [], skippedPageCount: 0 };
    const pids = Object.keys(this.cache.entries);
    if (pids.length > maxPages) return { pairs: [], skippedPageCount: pids.length };
    const vecs = new Map<string, Float32Array[]>(
      pids.map((pid) => [pid, this.cache!.entries[pid].chunks.map((c) => decodeVector(c.vector))]),
    );
    const pairs: { a: string; b: string; score: number }[] = [];
    for (let i = 0; i < pids.length; i++) {
      for (let j = i + 1; j < pids.length; j++) {
        const va = vecs.get(pids[i])!, vb = vecs.get(pids[j])!;
        let best = 0;
        for (const x of va) for (const y of vb) { const c = cosine(x, y); if (c > best) best = c; }
        if (best >= threshold) pairs.push({ a: pids[i], b: pids[j], score: best });
      }
    }
    pairs.sort((p, q) => q.score - p.score);
    return { pairs, skippedPageCount: 0 };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/page-similarity.test.ts -t "pairwiseNearDuplicates"`
Expected: PASS.

- [ ] **Step 5: Emit the report in Lint**

In `src/phases/lint.ts`, after the cache is loaded (`:253-255`), add:

```typescript
    if (similarity?.config.mode !== "jaccard" && (opts.lintNearDuplicate ?? false)) {
      const LINT_NEARDUP_MAX_PAGES = 500;
      const { pairs, skippedPageCount } = similarity!.pairwiseNearDuplicates(
        opts.nearDupThreshold ?? 0.80, LINT_NEARDUP_MAX_PAGES,
      );
      if (skippedPageCount > 0) {
        yield { kind: "info_text", icon: "⚠️",
          summary: `near-duplicate проверка пропущена: ${skippedPageCount} страниц > ${LINT_NEARDUP_MAX_PAGES}` };
      } else if (pairs.length > 0) {
        yield { kind: "info_text", icon: "🔁",
          summary: `near-duplicate кандидаты: ${pairs.length} пар`,
          details: pairs.map((p) => `${p.a} ≈ ${p.b} (${p.score.toFixed(2)})`) };
      }
    }
```

(`opts` is already a `runLint` parameter; `LlmCallOptions` gained the fields in Task 8.)

- [ ] **Step 6: Run similarity suite + typecheck lint**

Run: `npx vitest run tests/page-similarity.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lint.ts|page-similarity.ts" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 7: Settings toggles for graph-health flags**

In `src/settings.ts`, under a "Graph health" heading in the native section, add toggles for `dedupOnIngest` + `dedupThreshold` and `lintNearDuplicate` + `nearDupThreshold`, mirroring the Task 4 pattern (toggle + number `addText`, inline Russian descriptions). Persist via `this.plugin.saveSettings()`.

- [ ] **Step 8: Commit**

```bash
git add src/page-similarity.ts src/phases/lint.ts src/settings.ts tests/page-similarity.test.ts
git commit -m "feat(lint): near-duplicate page report + settings toggles"
```

---

## Task 10: Lint + full suite + docs

**Files:**
- Modify: `lat.md/tests.md`, `lat.md/operations.md`, `lat.md/architecture.md`

- [ ] **Step 1: Run lint + full test suite**

Run: `npm run lint`
Expected: clean (node builtins lazy + desktop-guarded — no new violations).
Run: `npx vitest run`
Expected: full suite PASS.

- [ ] **Step 2: Document in lat.md**

Add a `## Tier 1 — Graph Health + Hybrid` section to `lat.md/tests.md` with the four leaf specs referenced by the `// @lat:` comments added in Tasks 1/2/5/8/9 (each leaf: one-sentence description). Add a short feature section to `lat.md/operations.md` (dedup gate, lint near-dup, hybrid retrieval) and note the `rrf` util + hybrid mode in `lat.md/architecture.md` under `PageSimilarityService`. Use `[[src/...]]` source links where the rule applies.

- [ ] **Step 3: `lat check`**

Run: `lat check`
Expected: all wiki links + code refs pass (every new `@lat:` spec section is covered; every `[[src/...]]` resolves).

- [ ] **Step 4: Measure the outcome (Done-when clause 2)**

Run (against a real vault with an embedding cache + gold set):
```bash
tsx scripts/eval.ts --vault <path> --gold scripts/eval/<vault>.gold.json --config dense,jaccard,hybrid
```
Expected: a table with `hybrid` Recall@k/MRR alongside `dense`/`jaccard`; record whether `hybrid` ≥ `dense` on Recall@k. This is the intent's observable-outcome gate. (If no live embedding endpoint, the harness warns and `hybrid`/`dense` fall back to jaccard — re-run with the endpoint configured.)

- [ ] **Step 5: Commit**

```bash
git add lat.md/
git commit -m "docs(lat): Tier 1 graph-health + hybrid specs and refs"
```

---

## Self-Review

**Spec coverage (each spec section → task):**
- A1 dedup gate (post-LLM, redirect+LLM-merge) → Tasks 6 (scoring), 7 (schema/prompt), 8 (gate). ✓
- A2 lint near-duplicate report → Task 9. ✓
- B1 `rrf` util → Task 1. ✓
- B2 `hybrid` similarity mode (pool=50, RRF) → Tasks 2, 3, 4. ✓
- B3 `hybrid` eval config → Task 5. ✓
- Flags / safe-off defaults → Tasks 4, 8. ✓
- Keyless degradation → Task 2 (hybrid→jaccard), Task 6 (jaccard coeff / score 0 on fail), Task 9 (embedding-only, no-op). ✓
- Verification via harness (Done-when) → Task 10 Step 4. ✓
- lat.md docs + `lat check` (project post-task checklist) → Task 10. ✓

**Placeholder scan:** Task 8 Step 3 and Task 9 Step 7 leave test-body / settings-UI detail to fill from existing in-file patterns (the surrounding mocks/controls), not invented APIs — every referenced symbol is defined in an earlier task or already exists. No `TODO`/`TBD` in code steps.

**Type consistency:** `rrf` signature, `mode: "...|hybrid"`, `rrfK`, `RRF_CANDIDATE_POOL`, `maxSimilarityToExisting`, `pairwiseNearDuplicates`, `MergedPageOutputSchema`, `"ingest.merge"` CallSite, and the `LlmCallOptions` flag names are identical everywhere they appear across Tasks 1–9.

**Health Metrics guarded:** all flags default OFF (Task 4 defaults) → latency-flags-off intact; hybrid returns `topK` (no context growth); keyless paths preserved.
