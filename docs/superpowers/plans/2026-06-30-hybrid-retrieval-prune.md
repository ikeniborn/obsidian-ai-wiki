---
review:
  plan_hash: 2e3f643fa20a5620
  spec_hash: fcedf46fb62afcb1
  last_run: 2026-06-30
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: consistency
      severity: MAJOR
      section: "Task 2: Surface denseByPid raw-cosine map from the seed dense pass"
      section_hash: 0ddf6ad91ae3c912
      fragment: "Modify: src/page-similarity.ts (5 SeedDiag construction sites: ~664, ~672, ~721, ~746, ~767)"
      text: >-
        SeedDiag is constructed at SIX sites in src/page-similarity.ts, not five.
        The early-empty guard in selectRelevantScoredDiag — line 765,
        `if (queryTokens.size === 0) return { results: [], denseMax: 0, embedFailed: false };`
        — is not enumerated by Task 2 and no step adds `denseByPid` to it. Once Step 1
        makes `denseByPid` a required (non-optional) field of SeedDiag, this return no
        longer satisfies the interface, so Task 2 Step 6 (`npm run build`) will fail with
        TS2741 'Property denseByPid is missing'.
      fix: >-
        Add a Task 2 sub-step covering src/page-similarity.ts:765 — append `, denseByPid: {}`
        to the `queryTokens.size === 0` early return. Alternatively, declare `denseByPid?`
        optional in SeedDiag (Step 1) so all empty returns stay valid; but then the
        consumer in Task 3 Step 4 must read `diag.denseByPid ?? {}`.
      verdict: fixed
      verdict_at: 2026-06-30
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-30-hybrid-retrieval-prune-design.md
---

# Hybrid Retrieval: Graph-Noise Pruning + Stats Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a raw-cosine relevance floor that drops low-relevance graph-expanded pages from query context, make the "Selected for LLM" stat show its vector/graph breakdown, and detach the stats block from the "Results" heading.

**Architecture:** A new pure helper `pruneByRelevance` decides graph-page membership from pre-computed dense cosines (reused from the seed dense pass — zero extra embedding calls). It is wired into `retrieveDomainCandidates`, so both single-domain (Ask Domain) and cross-domain (Ask Wiki) paths prune per-domain against their own `denseMax`. A single setting `bfsMinScoreRatio` controls it, decoupled from `bfsFusion` (which still only reorders). UI changes are additive event fields plus one CSS rule.

**Tech Stack:** TypeScript, esbuild, Obsidian plugin API, OpenAI-compatible embeddings. No unit-test framework in repo — pure logic is tested with a standalone `tsx` script under `eval/`; integration is guarded by the existing `eval/cross-domain/run.ts` harness plus `npm run lint` / `npm run build`.

---

## Background: why the floor uses raw dense cosine

In hybrid mode `seedScores` and `expandedScores` are RRF-fused (rank-based, ≈ `1/(k+1)`) and come from two separate `rrf()` calls over different candidate lists, so they are NOT relevance-comparable. The floor must therefore compare **raw dense cosine** of each graph page against `denseMax` (raw cosine of the best seed). The seed selection pass (`selectEmbeddingScoredDiag`) already computes a cosine for **every** annotated page; Task 2 surfaces that as a `denseByPid` map so the floor needs no new embedding calls.

## File map

| File | Responsibility | Change |
|------|----------------|--------|
| `src/retrieval-prune.ts` | Pure membership floor for graph pages | **Create** |
| `eval/retrieval-prune/run.ts` | Standalone unit test for the floor | **Create** |
| `src/retrieval-diag.ts` | `SeedDiag` shape | Add `denseByPid` field |
| `src/page-similarity.ts` | Dense/hybrid/jaccard scoring | Populate/pass `denseByPid` |
| `src/phases/query.ts` | `retrieveDomainCandidates`, `runQuery`, `RetrieveCfg` | Wire floor; thread setting; stats breakdown |
| `src/types.ts` | `RunEvent` events, settings shape + defaults | Add event fields + `bfsMinScoreRatio` |
| `src/eval-log.ts` | `retrievalConfig` eval record | Add `bfsMinScoreRatio` |
| `src/agent-runner.ts` | Settings → query params | Thread `bfsMinScoreRatio` |
| `src/view.ts` | Stats + progress rendering | Breakdown row + floor trace line |
| `src/settings.ts` | Settings UI | Floor slider |
| `src/styles.css` | Stats block style | `margin-top` |

---

## Task 1: `pruneByRelevance` pure helper (TDD)

**Files:**
- Create: `src/retrieval-prune.ts`
- Create (test): `eval/retrieval-prune/run.ts`

- [ ] **Step 1: Write the failing test**

Create `eval/retrieval-prune/run.ts`:

```typescript
/**
 * Out-of-vault unit test for pruneByRelevance. No Obsidian, no API key.
 * Run: npx tsx eval/retrieval-prune/run.ts
 */
import { pruneByRelevance } from "../../src/retrieval-prune";

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

// denseRef = 0.6, ratio = 0.6 → bar = 0.36
const denseByPid = { a: 0.55, b: 0.30, c: 0.36, d: 0.10 };
const r1 = pruneByRelevance(["a", "b", "c", "d"], denseByPid, 0.6, 0.6);
check("keeps >= bar (a,c)", r1.keep.has("a") && r1.keep.has("c"));
check("drops < bar (b,d)", !r1.keep.has("b") && !r1.keep.has("d"));
check("pruned lists b,d", r1.pruned.length === 2 && r1.pruned.includes("b") && r1.pruned.includes("d"));

// missing score → kept (cannot evaluate → no quality loss)
const r2 = pruneByRelevance(["x"], {}, 0.6, 0.6);
check("missing score kept", r2.keep.has("x") && r2.pruned.length === 0);

// boundary exactly at bar → kept (>=)
const r3 = pruneByRelevance(["e"], { e: 0.36 }, 0.6, 0.6);
check("boundary kept", r3.keep.has("e"));

// denseRef 0 → bar 0 → all kept
const r4 = pruneByRelevance(["a", "d"], denseByPid, 0, 0.6);
check("zero ref keeps all", r4.keep.size === 2 && r4.pruned.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/retrieval-prune/run.ts`
Expected: FAIL — `Cannot find module '../../src/retrieval-prune'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/retrieval-prune.ts`:

```typescript
// src/retrieval-prune.ts
// Membership floor for graph-expanded pages: drop those whose raw dense cosine
// falls below ratio·denseRef. Pure — the caller supplies pre-computed cosines, so
// this adds no embedding calls. A page with no score is KEPT (cannot evaluate →
// no quality loss); only confidently-weak pages are dropped. Seeds are never passed
// in (they are always kept by the caller).

export function pruneByRelevance(
  expandedIds: string[],
  denseByPid: Record<string, number>,
  denseRef: number,
  ratio: number,
): { keep: Set<string>; pruned: string[] } {
  const bar = ratio * denseRef;
  const keep = new Set<string>();
  const pruned: string[] = [];
  for (const id of expandedIds) {
    const score = denseByPid[id];
    if (score === undefined || score >= bar) keep.add(id);
    else pruned.push(id);
  }
  return { keep, pruned };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx eval/retrieval-prune/run.ts`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/retrieval-prune.ts eval/retrieval-prune/run.ts
git commit -m "feat(retrieval): pruneByRelevance graph-page membership floor"
```

---

## Task 2: Surface `denseByPid` raw-cosine map from the seed dense pass

**Files:**
- Modify: `src/retrieval-diag.ts:7-14` (`SeedDiag`)
- Modify: `src/page-similarity.ts` (6 `SeedDiag` construction sites: ~664, ~672, ~721, ~746, ~765, ~767)

- [ ] **Step 1: Add `denseByPid` to the `SeedDiag` interface**

In `src/retrieval-diag.ts`, replace the `SeedDiag` interface:

```typescript
export interface SeedDiag {
  /** Final ranked seeds for the mode (hybrid RRF, embedding cosine, or jaccard). */
  results: { path: string; score: number }[];
  /** Max raw cosine of the dense side. 0 in jaccard mode or when embedding failed. */
  denseMax: number;
  /** True when the embedding HTTP call threw and the dense side degraded to jaccard. */
  embedFailed: boolean;
  /** Raw cosine per pageId for EVERY scored page with a dense vector. Empty in jaccard
   *  mode / on embed failure. Used by the relevance floor (src/retrieval-prune.ts). */
  denseByPid: Record<string, number>;
}
```

- [ ] **Step 2: Populate `denseByPid` in `selectEmbeddingScoredDiag`**

In `src/page-similarity.ts`, the dense scoring loop (currently ~lines 705-721). Replace it with the version that records every page's raw cosine:

```typescript
    let denseMax = 0;
    const denseByPid: Record<string, number> = {};
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
        denseByPid[pid] = c;                       // raw cosine for the floor
        if (c > 0) scored.push({ path: allPaths[i], score: c });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { results: scored.slice(0, limit), denseMax, embedFailed: false, denseByPid };
```

Note: pages reached via the per-page Jaccard fallback branch (`vecs.length === 0`) are intentionally NOT added to `denseByPid` — their Jaccard score is not cosine-comparable, so the floor leaves them untouched (kept).

- [ ] **Step 3: Add `denseByPid` to the two early-return branches of `selectEmbeddingScoredDiag`**

In `src/page-similarity.ts`, the two guard returns near the top of `selectEmbeddingScoredDiag` (currently ~664 and ~672) — add `denseByPid: {}`:

```typescript
    if (!baseUrl || !model) {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: false, denseByPid: {} };
    }
```

```typescript
    } catch {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: true, denseByPid: {} };
    }
```

- [ ] **Step 4: Pass `denseByPid` through `selectHybridScoredDiag`**

In `src/page-similarity.ts`, the hybrid return (currently ~746) — forward the dense map:

```typescript
    const results = fused.slice(0, this.config.topK).map((f) => ({ path: f.id, score: f.score }));
    return { results, denseMax: dense.denseMax, embedFailed: dense.embedFailed, denseByPid: dense.denseByPid };
```

- [ ] **Step 5: Add `denseByPid` to both early returns of `selectRelevantScoredDiag`**

In `src/page-similarity.ts`, `selectRelevantScoredDiag` has TWO `SeedDiag` returns before it delegates to the dense/hybrid scorers — the empty-query guard (~765) and the jaccard branch (~767). Add `denseByPid: {}` to **both** (the empty-query guard is easy to miss and would otherwise break `npm run build` with TS2741 once `denseByPid` is required):

```typescript
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return { results: [], denseMax: 0, embedFailed: false, denseByPid: {} };
    if (this.config.mode === "jaccard") {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths), denseMax: 0, embedFailed: false, denseByPid: {} };
    }
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors (every `SeedDiag` construction now has `denseByPid`).

- [ ] **Step 7: Commit**

```bash
git add src/retrieval-diag.ts src/page-similarity.ts
git commit -m "feat(retrieval): expose per-page raw dense cosine via SeedDiag.denseByPid"
```

---

## Task 3: Wire the floor into `retrieveDomainCandidates`

**Files:**
- Modify: `src/phases/query.ts:26-32` (`RetrieveCfg`)
- Modify: `src/phases/query.ts:87-91` (hoist `denseByPid`/`embedFailed`)
- Modify: `src/phases/query.ts:95-121` (capture diag fields)
- Modify: `src/phases/query.ts:151-156` (prune before `graph_stats`)
- Modify: `src/types.ts:93-107` (`graph_stats` event fields)
- Modify: `src/phases/query.ts` import line (add `pruneByRelevance`)

- [ ] **Step 1: Add `bfsMinScoreRatio` to `RetrieveCfg` (optional)**

In `src/phases/query.ts`, extend the interface:

```typescript
export interface RetrieveCfg {
  graphDepth: number;
  seedTopK: number;
  seedMinScore: number;
  bfsTopK: number;
  seedSimilarityThreshold: number;
  bfsMinScoreRatio?: number;   // 0 / undefined = floor off
}
```

Optional so existing `RetrieveCfg` literals (e.g. `eval/cross-domain/run.ts`) keep compiling and default to floor-off.

- [ ] **Step 2: Add the floor fields to the `graph_stats` event**

In `src/types.ts`, extend the `graph_stats` member of `RunEvent` (currently ends at line 107):

```typescript
  | {
      kind: "graph_stats";
      seeds: string[];
      expanded: number;
      total: number;
      fromCache: boolean;
      seedScores: Record<string, number>;
      expandedPages: string[];
      expandedScores: Record<string, number>;
      expandedByHop?: Record<number, string[]>;
      seedFallback?: "none" | "jaccard" | "llm";
      retrievalMode?: import("./retrieval-diag").RetrievalMode;
      denseMax?: number;
      seedFallbackReason?: import("./retrieval-diag").SeedFallbackReason;
      floorApplied?: boolean;
      floorRef?: number;
      prunedCount?: number;
      floorSkippedReason?: string;
    };
```

- [ ] **Step 3: Import the helper and hoist the new locals in `retrieveDomainCandidates`**

In `src/phases/query.ts`, add to the imports at the top of the file:

```typescript
import { pruneByRelevance } from "../retrieval-prune";
```

Then in the local declarations block (currently lines 87-91, the `let seeds…` group), add two more:

```typescript
  let denseMax = 0;
  let seedFallbackReason: SeedFallbackReason | undefined;
  let denseByPid: Record<string, number> = {};
  let embedFailed = false;
```

- [ ] **Step 4: Capture `denseByPid` / `embedFailed` from the seed diag**

In `src/phases/query.ts`, inside the embedding/hybrid branch right after `denseMax = diag.denseMax;` (currently line 100), add:

```typescript
    denseMax = diag.denseMax;
    denseByPid = diag.denseByPid;
    embedFailed = diag.embedFailed;
```

- [ ] **Step 5: Prune graph pages before emitting `graph_stats`**

In `src/phases/query.ts`, replace the current block (lines 154-156):

```typescript
  const seedSet = new Set(seeds);
  const expandedPages = [...selectedIds].filter((id) => !seedSet.has(id));
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback, retrievalMode, denseMax, seedFallbackReason };
```

with:

```typescript
  const seedSet = new Set(seeds);
  let expandedPages = [...selectedIds].filter((id) => !seedSet.has(id));

  // Relevance floor — drop graph-expanded pages whose raw dense cosine falls below
  // ratio·denseMax. Only when scales are comparable: dense mode, strong seed signal,
  // no seed fallback, and a finite bfsTopK cap. Mutates selectedIds/expandedScores.
  const ratio = cfg.bfsMinScoreRatio ?? 0;
  let floorApplied = false;
  let prunedCount = 0;
  let floorSkippedReason: string | undefined;
  if (ratio > 0) {
    const eligible =
      (retrievalMode === "embedding" || retrievalMode === "hybrid") &&
      denseMax > 0 && !embedFailed && seedFallback === "none" && cfg.bfsTopK > 0;
    if (!eligible) {
      floorSkippedReason =
        retrievalMode === "jaccard" ? "jaccard-mode"
        : embedFailed ? "embed-failed"
        : denseMax <= 0 ? "low-dense"
        : seedFallback !== "none" ? `seed-fallback:${seedFallback}`
        : "bfs-uncapped";
    } else if (expandedPages.length > 0) {
      const { keep, pruned } = pruneByRelevance(expandedPages, denseByPid, denseMax, ratio);
      for (const id of pruned) { selectedIds.delete(id); delete expandedScores[id]; }
      expandedPages = expandedPages.filter((id) => keep.has(id));
      prunedCount = pruned.length;
      floorApplied = true;
    }
  }

  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback, retrievalMode, denseMax, seedFallbackReason, floorApplied, floorRef: floorApplied ? denseMax : undefined, prunedCount, floorSkippedReason };
```

(The `candidatePages` / `annotations` blocks that follow already build from `selectedIds`, so pruned pages drop out of the LLM context automatically.)

- [ ] **Step 6: Verify it compiles and the cross-domain eval is unchanged**

Run: `npm run build`
Expected: succeeds.

Run: `npx tsx eval/cross-domain/run.ts`
Expected: all PASS — the eval builds `RetrieveCfg` without `bfsMinScoreRatio` (floor off), so behaviour is identical to before (regression guard).

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts src/types.ts
git commit -m "feat(retrieval): apply dense-cosine relevance floor to graph-expanded pages"
```

---

## Task 4: "Selected for LLM" vector/graph breakdown

**Files:**
- Modify: `src/types.ts:62-70` (`query_stats` event)
- Modify: `src/phases/query.ts:231-261` (compute + emit counts)
- Modify: `src/view.ts:962-966` (render breakdown)

- [ ] **Step 1: Add `seedCount` / `graphCount` to the `query_stats` event**

In `src/types.ts`, extend the `query_stats` member:

```typescript
  | {
      kind: "query_stats";
      crossDomain: boolean;
      pagesScanned: number;        // pages read/analyzed
      pagesSelected: number;       // pages handed to the LLM
      domainName?: string;         // Ask Domain only
      seedCount?: number;          // Ask Domain only -- vector seeds in the selected set
      graphCount?: number;         // Ask Domain only -- graph-expanded pages in the selected set
      domainsStudied?: number;     // Ask Wiki only -- domains that yielded candidates
      domainsTotal?: number;       // Ask Wiki only -- domains configured
      fromDomains?: string[];      // Ask Wiki only -- domain names in the final set
    }
```

- [ ] **Step 2: Compute and emit the counts in `runQuery`**

In `src/phases/query.ts`, just before the `yield { kind: "query_stats", … }` (currently line 255), add the count computation, then include the fields in the yield:

```typescript
  const ctxIds = contextPages.map(([p]) => pageId(p));
  const seedCount = ctxIds.filter((id) => seedSet.has(id)).length;
  const graphCount = contextPages.length - seedCount;

  yield {
    kind: "query_stats",
    crossDomain: false,
    domainName: domain.name,
    pagesScanned: cand.pagesScanned,
    pagesSelected: contextPages.length,
    seedCount,
    graphCount,
  };
```

(`seedSet` and `pageId` are already in scope at this point in `runQuery`.)

- [ ] **Step 3: Render the breakdown in the single-domain stats block**

In `src/view.ts`, the `else` (single-domain) branch of `renderQueryStats` (currently lines 962-966) — replace the `statsSelected` line:

```typescript
    } else {
      line(T.statsDomain, ev.domainName ?? "—");
      line(T.statsAnalyzed, String(ev.pagesScanned));
      const selected = ev.seedCount !== undefined && ev.graphCount !== undefined
        ? `${ev.pagesSelected} (${ev.seedCount} vector + ${ev.graphCount} graph)`
        : String(ev.pagesSelected);
      line(T.statsSelected, selected);
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/phases/query.ts src/view.ts
git commit -m "feat(view): show vector/graph breakdown in Selected-for-LLM stat"
```

---

## Task 5: Setting `bfsMinScoreRatio` + threading + eval record

**Files:**
- Modify: `src/types.ts:220-221` (nativeAgent field) and `src/types.ts:291-292` (default)
- Modify: `src/agent-runner.ts:100-110` (thread into both query paths)
- Modify: `src/phases/query.ts:174-210` (`runQuery` param + cfg)
- Modify: `src/eval-log.ts` (~line 21, `retrievalConfig` record) and `src/phases/query.ts:280-287` + `src/phases/query-cross-domain.ts:160-166` (emit)
- Modify: `src/settings.ts:779-785` (slider next to BFS fusion)

- [ ] **Step 1: Add the nativeAgent field and default**

In `src/types.ts`, add the field beside `bfsFusion` (currently line 220):

```typescript
    bfsFusion?: boolean;
    bfsMinScoreRatio?: number;
    seedSimilarityThreshold?: number;
```

And in `DEFAULT_SETTINGS.nativeAgent` (beside `bfsFusion: false`, currently line 291):

```typescript
    bfsFusion: false,
    bfsMinScoreRatio: 0.6,
    seedSimilarityThreshold: 0,
```

- [ ] **Step 2: Add the `runQuery` parameter and thread it into its cfg**

In `src/phases/query.ts`, add the parameter after `rrfK` (currently line 192-193) — default `0` so any caller that omits it keeps the floor off:

```typescript
  rrfK: number = 60,
  bfsMinScoreRatio: number = 0,
): AsyncGenerator<RunEvent> {
```

Then include it in the `cfg` object `runQuery` builds (currently lines 208-210):

```typescript
  const cfg = {
    graphDepth, seedTopK, seedMinScore, bfsTopK, seedSimilarityThreshold, bfsMinScoreRatio,
  };
```

- [ ] **Step 3: Thread the setting from `agent-runner` into both query paths**

In `src/agent-runner.ts`, add `bfsMinScoreRatio` to the cross-domain `RetrieveCfg` literal (currently lines 102-104):

```typescript
            { graphDepth: this.settings.graphDepth, seedTopK: this.settings.seedTopK,
              seedMinScore: this.settings.seedMinScore, bfsTopK: this.settings.bfsTopK,
              seedSimilarityThreshold: this.settings.nativeAgent.seedSimilarityThreshold ?? 0,
              bfsMinScoreRatio: this.settings.nativeAgent.bfsMinScoreRatio ?? 0.6 },
```

And append the new positional argument to the `runQuery` call (currently line 110), after the `rrfK` argument:

```typescript
          yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, REDACTEDLinkValidationRetries ?? 3, REDACTEDedSimilarityThreshold ?? 0, REDACTEDsFusion ?? false, this.settings.nativeAgent.rrfK ?? 60, this.settings.nativeAgent.bfsMinScoreRatio ?? 0.6);
```

- [ ] **Step 4: Record `bfsMinScoreRatio` in the eval metadata type**

In `src/eval-log.ts`, in the `retrievalConfig` interface (beside `bfsTopK: number;`, ~line 21), add:

```typescript
  bfsTopK: number;
  bfsMinScoreRatio?: number;
```

- [ ] **Step 5: Emit it from both query paths**

In `src/phases/query.ts`, the `eval_meta.retrievalConfig` object (currently lines 280-287) — add the field:

```typescript
      retrievalConfig: {
        mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
        seedTopK,
        bfsTopK,
        bfsFusion,
        seedSimilarityThreshold,
        bfsMinScoreRatio,
        hybridRetrieval: similarity?.config.mode === "hybrid",
      },
```

In `src/phases/query-cross-domain.ts`, the matching `retrievalConfig` block (currently ~lines 163-166) — add `bfsMinScoreRatio: cfg.bfsMinScoreRatio ?? 0` beside `bfsTopK: cfg.bfsTopK,`:

```typescript
        seedTopK: cfg.seedTopK,
        bfsTopK: cfg.bfsTopK,
        bfsMinScoreRatio: cfg.bfsMinScoreRatio ?? 0,
        seedSimilarityThreshold: cfg.seedSimilarityThreshold,
```

- [ ] **Step 6: Add the settings slider**

In `src/settings.ts`, immediately after the "BFS fusion" `Setting` block (currently ends line 785), insert:

```typescript
        new Setting(containerEl)
          .setName("Graph relevance floor (ratio)")
          .setDesc("Drop graph-expanded pages whose dense cosine is below this fraction of the best seed's cosine. 0 = off. Dense (embedding/hybrid) retrieval only.")
          .addSlider((sl) =>
            sl.setLimits(0, 1, 0.05)
              .setDynamicTooltip()
              .setValue(s.nativeAgent.bfsMinScoreRatio ?? 0.6)
              .onChange(async (v) => { s.nativeAgent.bfsMinScoreRatio = v; await this.plugin.saveSettings(); }),
          );
```

- [ ] **Step 7: Verify compile + lint + eval regression**

Run: `npm run build`
Expected: succeeds.

Run: `npm run lint`
Expected: no new errors.

Run: `npx tsx eval/cross-domain/run.ts`
Expected: all PASS (cross-domain eval passes `bfsMinScoreRatio ?? 0` → floor off → unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent-runner.ts src/phases/query.ts src/phases/query-cross-domain.ts src/eval-log.ts src/settings.ts
git commit -m "feat(settings): bfsMinScoreRatio knob threaded into both query paths"
```

---

## Task 6: Stats-block spacing + floor progress trace

**Files:**
- Modify: `src/styles.css` (`.ai-wiki-cross-stats`, ~line 390)
- Modify: `src/view.ts:20-62` (`formatGraphStatsLines` — floor trace line)

- [ ] **Step 1: Detach the stats block from the "Results" heading**

In `src/styles.css`, the `.ai-wiki-cross-stats` rule (~line 390) — add `margin-top`:

```css
.ai-wiki-cross-stats {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 6px 8px;
  margin-top: 10px;
  margin-bottom: 8px;
  font-size: 0.85em;
}
```

- [ ] **Step 2: Add a floor line to the agent-log progress trace**

In `src/view.ts`, in `formatGraphStatsLines`, after the `BFS expanded` block and before `return lines;` (the trace/`agentLogEnabled` branch, ~line 55-60), add:

```typescript
  if (ev.floorApplied) {
    lines.push(`Floor: kept ${ev.expandedPages.length}, pruned ${ev.prunedCount ?? 0} (ref ${(ev.floorRef ?? 0).toFixed(2)})`);
  } else if (ev.floorSkippedReason) {
    lines.push(`Floor skipped: ${ev.floorSkippedReason}`);
  }
```

(No leading spaces → renders as a `ai-wiki-step-detail-header`, matching `Retrieval:` / `BFS expanded`.)

- [ ] **Step 3: Verify compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/view.ts
git commit -m "fix(view): space stats block below Results + floor progress trace"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + integration + lint + build all green**

```bash
npx tsx eval/retrieval-prune/run.ts
npx tsx eval/cross-domain/run.ts
npm run lint
npm run build
```

Expected: prune test `5 passed, 0 failed`; cross-domain eval all PASS; lint clean; build succeeds.

- [ ] **Step 2: Eval baseline guard (floor off ⇒ identical)**

Confirm the cross-domain eval output is unchanged versus `master` (it constructs `RetrieveCfg` without `bfsMinScoreRatio`, so the floor never fires). If any cross-domain assertion changed, the floor leaked into the floor-off path — fix before proceeding.

- [ ] **Step 3: Manual check in Obsidian (the reported run)**

Load the dev build into the test vault, run the screenshot query in **hybrid** mode against the `РТК-САР-ХЛД` domain, agent-log enabled. Confirm:
  1. The stats block has a visible gap below the "Results" heading.
  2. The selected row reads `N (X vector + Y graph)`, with `Y` reduced versus the unfloored count (set `bfsMinScoreRatio = 0` in settings to compare).
  3. The progress trace shows a `Floor: kept …, pruned …` line (or `Floor skipped: <reason>`).
  4. `agent.jsonl` `graph_stats` carries `floorApplied` / `prunedCount` / `floorRef`.
  5. The answer quality is unchanged or better, with fewer tokens sent.

- [ ] **Step 4: Update wiki docs (mandatory per project rules)**

The retrieval behaviour changed — regenerate the affected wiki page and lint:

```bash
# via the iwiki skills (not raw engine calls):
#   iwiki:iwiki-ingest src/retrieval-prune.ts
#   iwiki:iwiki-ingest src/phases/query.ts
#   /iwiki-lint
```

Expected: `docs/wiki/retrieval.md` reflects the floor; `/iwiki-lint` reports no broken refs / orphans.

- [ ] **Step 5: Final commit (docs)**

```bash
git add docs/wiki
git commit -m "docs(wiki): document graph-page relevance floor"
```

---

## Self-review notes

- **Spec coverage:** Problem 1 (spacing) → Task 6; Problem 2 (opaque "10") → Task 4; Problem 3 (graph noise) → Tasks 1-3; Problem 4 (hybrid re-evaluate, tokens↓) → Tasks 1-3 + Task 5 knob. Observability + applicability matrix → Task 3 Step 5. Both-paths → Task 3 (shared `retrieveDomainCandidates`) + Task 5 threading.
- **Type consistency:** `SeedDiag.denseByPid: Record<string, number>` defined in Task 2, consumed in Task 3. `pruneByRelevance(expandedIds, denseByPid, denseRef, ratio)` signature identical across Task 1 def and Task 3 call. `RetrieveCfg.bfsMinScoreRatio?` (Task 3) read as `cfg.bfsMinScoreRatio ?? 0` (Tasks 3, 5). `graph_stats` floor fields defined in Task 3 Step 2, read in Task 6 Step 2. `query_stats.seedCount/graphCount` defined Task 4 Step 1, emitted Step 2, rendered Step 3.
- **No placeholders:** every code step shows complete code; every run step states the exact command and expected output.
