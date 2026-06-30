# Graph Relevance Floor — Robust Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph relevance floor's absolute `ratio·denseMax` bar with a spread-relative bar normalized against the domain's cosine dynamic range, so the floor still prunes graph noise when the embedding model's cosine range is compressed (e.g. deepseek ~0.40–0.59).

**Architecture:** The bar becomes `loRef + ratio·(denseMax − loRef)`, where `loRef` is a robust low percentile of all domain page cosines and `denseMax` is the best seed's cosine. The pure helper `pruneByRelevance` gains a `loRef` parameter and a range-collapse guard; `query.ts` computes `loRef` inline from the already-available `denseByPid` map and surfaces the bar in `graph_stats`. A deterministic eval harness sweeps `ratio` over recorded real cosine fixtures, reporting token reduction and gold-page recall to calibrate the constants.

**Tech Stack:** TypeScript, esbuild bundle, standalone `tsx` run-scripts for tests (no vitest/jest), Obsidian plugin runtime.

## Global Constraints

- Single user knob: `bfsMinScoreRatio` (`0..1`, `0` = floor off). No legacy mode, no second knob.
- The floor adds **zero** embedding calls — it reuses cosines already computed in the seed dense pass (`denseByPid`).
- A graph page with no cosine is KEPT (cannot evaluate → no quality loss).
- Floor runs only in dense modes (`embedding`/`hybrid`) with a strong seed signal; jaccard mode is out of scope.
- Quality proxy is gold-page recall: the floor must never prune a query's expected source pages (`recall@floor = 100%`).
- Code comments / commit messages: English.
- Tests are `tsx` run-scripts printing `OK — N passed, 0 failed`; a non-zero failure count calls `process.exit(1)`.

---

### Task 1: Robust bar formula in the pure helper

**Files:**
- Modify: `src/retrieval-prune.ts` (whole file — new exports + changed signature)
- Test: `eval/retrieval-prune/run.ts` (extend existing self-checks)

**Interfaces:**
- Produces:
  - `FLOOR_LO_PCT: number` — the low percentile constant (initial `0.05`, finalized in Task 5).
  - `FLOOR_EPS: number` — range-collapse epsilon (`1e-6`).
  - `robustLow(values: number[], pct: number): number` — linear-interpolated percentile; empty → `0`.
  - `pruneByRelevance(expandedIds: string[], denseByPid: Record<string, number>, denseRef: number, loRef: number, ratio: number): { keep: Set<string>; pruned: string[]; bar: number; collapsed: boolean }`.

- [ ] **Step 1: Rewrite `src/retrieval-prune.ts`**

```ts
// src/retrieval-prune.ts
// Membership floor for graph-expanded pages. The bar is spread-relative: it sits a
// fraction `ratio` of the way up the domain's actual cosine dynamic range
// [loRef … denseRef], where denseRef is the best seed's cosine and loRef is a robust
// low percentile of all domain cosines. This is stable across embedding models whose
// absolute cosine range is compressed (e.g. deepseek ~0.40–0.59), unlike an absolute
// `ratio·denseRef` bar. Pure — the caller supplies pre-computed cosines, so this adds
// no embedding calls. A page with no score is KEPT (cannot evaluate → no quality loss);
// seeds are never passed in (always kept by the caller).

/** Low percentile of domain cosines used as the bar's lower anchor. Calibrated in
 *  eval/graph-floor (Task 5); p5 by default. */
export const FLOOR_LO_PCT = 0.05;

/** Dynamic range below which the bar cannot be normalized → floor skips (keep-all). */
export const FLOOR_EPS = 1e-6;

/** Linear-interpolated percentile of `values` at fraction `pct` (0..1). Empty → 0. */
export function robustLow(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = pct * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

export interface PruneResult {
  keep: Set<string>;
  pruned: string[];
  bar: number;
  collapsed: boolean;
}

export function pruneByRelevance(
  expandedIds: string[],
  denseByPid: Record<string, number>,
  denseRef: number,
  loRef: number,
  ratio: number,
): PruneResult {
  const keep = new Set<string>();
  const pruned: string[] = [];
  // ratio = 0 is the off switch; degenerate range cannot be normalized → keep-all.
  const collapsed = denseRef - loRef < FLOOR_EPS;
  if (ratio <= 0 || collapsed) {
    for (const id of expandedIds) keep.add(id);
    return { keep, pruned, bar: loRef, collapsed };
  }
  const bar = loRef + ratio * (denseRef - loRef);
  for (const id of expandedIds) {
    const score = denseByPid[id];
    if (score === undefined || score >= bar) keep.add(id);
    else pruned.push(id);
  }
  return { keep, pruned, bar, collapsed: false };
}
```

- [ ] **Step 2: Replace the test body in `eval/retrieval-prune/run.ts`**

Keep the `check`/`section` harness (lines 1–13) and the final summary (lines 56–58). Replace the test sections (lines 15–55) with:

```ts
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../../src/retrieval-prune";

// deepseek-like compressed domain: cosines clustered high, one outlier low.
const domainCosines = [0.40, 0.44, 0.47, 0.50, 0.52, 0.55, 0.59];
const loRef = robustLow(domainCosines, FLOOR_LO_PCT); // p5 ≈ 0.412

section("robustLow percentile");
{
  check("empty → 0", robustLow([], 0.05) === 0);
  check("single → itself", robustLow([0.5], 0.05) === 0.5);
  check("p0 → min", robustLow(domainCosines, 0) === 0.40);
  check("p100 → max", robustLow(domainCosines, 1) === 0.59);
  check("p5 between min and 2nd", loRef > 0.40 && loRef < 0.44, `loRef=${loRef}`);
}

section("spread-relative bar (denseRef=0.59)");
{
  // bar = loRef + 0.6·(0.59 − loRef) ≈ 0.412 + 0.6·0.178 ≈ 0.519
  const denseByPid = { hi: 0.57, mid: 0.50, lo: 0.44, out: 0.40 };
  const r = pruneByRelevance(["hi", "mid", "lo", "out"], denseByPid, 0.59, loRef, 0.6);
  const bar = r.bar;
  check("bar within (loRef, denseRef)", bar > loRef && bar < 0.59, `bar=${bar}`);
  check("keeps >= bar (hi)", r.keep.has("hi"));
  check("drops < bar (mid,lo,out)", !r.keep.has("mid") && !r.keep.has("lo") && !r.keep.has("out"),
    `kept=${[...r.keep].join(",")}`);
  check("prunes the compressed tail (was a no-op under ratio·denseMax)", r.pruned.length === 3,
    `pruned=${r.pruned.join(",")}`);
  check("not collapsed", r.collapsed === false);
}

section("boundary kept (>=)");
{
  const bar = loRef + 0.6 * (0.59 - loRef);
  const r = pruneByRelevance(["e"], { e: bar }, 0.59, loRef, 0.6);
  check("score exactly at bar kept", r.keep.has("e") && r.pruned.length === 0);
}

section("missing score kept");
{
  const r = pruneByRelevance(["x"], {}, 0.59, loRef, 0.6);
  check("missing score kept", r.keep.has("x") && r.pruned.length === 0);
}

section("range collapsed → skip (keep-all)");
{
  // denseRef ≈ loRef → cannot normalize → keep everything, collapsed flag set.
  const denseByPid = { a: 0.50, b: 0.41 };
  const r = pruneByRelevance(["a", "b"], denseByPid, 0.50, 0.50, 0.6);
  check("collapsed flagged", r.collapsed === true);
  check("collapsed keeps all", r.keep.size === 2 && r.pruned.length === 0);
}

section("zero ratio → keep-all (off switch)");
{
  const denseByPid = { a: 0.57, b: 0.40 };
  const r = pruneByRelevance(["a", "b"], denseByPid, 0.59, loRef, 0);
  check("ratio 0 keeps all", r.keep.size === 2 && r.pruned.length === 0);
}
```

- [ ] **Step 3: Run the tests — expect FAIL first if implementing test-first, else PASS**

Run: `npx tsx eval/retrieval-prune/run.ts`
Expected: `OK — N passed, 0 failed` (all sections PASS).

- [ ] **Step 4: Commit**

```bash
git add src/retrieval-prune.ts eval/retrieval-prune/run.ts
git commit -m "feat(retrieval): spread-relative graph floor bar (robustLow + range guard)"
```

---

### Task 2: Wire the new bar into the query path + graph_stats

**Files:**
- Modify: `src/phases/query.ts:22` (import), `src/phases/query.ts:171-200` (floor block + emit)
- Modify: `src/types.ts:104-114` (graph_stats fields)

**Interfaces:**
- Consumes: `robustLow`, `FLOOR_LO_PCT`, `pruneByRelevance` from Task 1; `denseByPid` (already in scope at `query.ts:105`), `denseMax`, `retrievalMode`, `embedFailed`, `seedFallback`.
- Produces: `graph_stats` events carry `floorLoRef?: number` and `floorBar?: number`.

- [ ] **Step 1: Extend the `graph_stats` event type in `src/types.ts`**

Replace lines 110–113 (the floor fields) with:

```ts
      floorApplied?: boolean;
      floorRef?: number;
      floorLoRef?: number;
      floorBar?: number;
      prunedCount?: number;
      floorSkippedReason?: string;
```

- [ ] **Step 2: Update the import in `src/phases/query.ts:22`**

```ts
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../retrieval-prune";
```

- [ ] **Step 3: Replace the floor block `src/phases/query.ts:171-198`**

```ts
  // Relevance floor — drop graph-expanded pages whose raw dense cosine falls below a
  // spread-relative bar `loRef + ratio·(denseMax − loRef)`, where loRef is a robust low
  // percentile of all domain cosines. Only when scales are comparable: dense mode, strong
  // seed signal, no seed fallback, finite bfsTopK. Mutates selectedIds/expandedScores.
  const ratio = cfg.bfsMinScoreRatio ?? 0;
  let floorApplied = false;
  let prunedCount = 0;
  let floorSkippedReason: string | undefined;
  let floorLoRef: number | undefined;
  let floorBar: number | undefined;
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
      const loRef = robustLow(Object.values(denseByPid), FLOOR_LO_PCT);
      const { keep, pruned, bar, collapsed } =
        pruneByRelevance(expandedPages, denseByPid, denseMax, loRef, ratio);
      if (collapsed) {
        floorSkippedReason = "range-collapsed";
      } else {
        for (const id of pruned) { selectedIds.delete(id); delete expandedScores[id]; }
        expandedPages = expandedPages.filter((id) => keep.has(id));
        prunedCount = pruned.length;
        floorApplied = true;
        floorLoRef = loRef;
        floorBar = bar;
      }
    }
  }
```

- [ ] **Step 4: Add the new fields to the `graph_stats` emit `src/phases/query.ts:200`**

Insert `floorLoRef, floorBar,` right after `floorRef: floorApplied ? denseMax : undefined,`:

```ts
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, expandedDense, seedFallback, retrievalMode, denseMax, seedFallbackReason, floorApplied, floorRef: floorApplied ? denseMax : undefined, floorLoRef, floorBar, prunedCount, floorSkippedReason };
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: bundle written, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts src/types.ts
git commit -m "feat(retrieval): thread loRef into floor; surface floorLoRef/floorBar in graph_stats"
```

---

### Task 3: Setting copy for the new semantics

**Files:**
- Modify: `src/types.ts:300` (default comment)
- Modify: `src/i18n.ts:122` (en), `src/i18n.ts:482` (ru), `src/i18n.ts:820` (es)
- Modify: `src/settings.ts:792` (slider default fallback)

**Interfaces:**
- Consumes: nothing new. Pure copy/comment.

- [ ] **Step 1: Update the default comment `src/types.ts:300`**

```ts
    bfsMinScoreRatio: 0.6, // position of the floor bar within the domain's cosine range [loRef..denseMax]; 0 = floor off
```

- [ ] **Step 2: Update the English desc `src/i18n.ts:122`**

```ts
    bfsMinScoreRatio_desc: "Drop graph-expanded pages whose dense cosine sits below this position in the domain's cosine range (low percentile → best seed). 0 = off. Dense (embedding/hybrid) retrieval only.",
```

- [ ] **Step 3: Update the Russian desc `src/i18n.ts:482`**

```ts
    bfsMinScoreRatio_desc: "Отбрасывать страницы из графового расширения, у которых dense-косинус ниже этой позиции в диапазоне косинусов домена (низкий перцентиль → лучший seed). 0 = выкл. Только для dense-поиска (embedding/гибрид).",
```

- [ ] **Step 4: Update the Spanish desc `src/i18n.ts:820`**

```ts
    bfsMinScoreRatio_desc: "Descartar páginas expandidas por el grafo cuyo coseno denso esté por debajo de esta posición en el rango de cosenos del dominio (percentil bajo → mejor seed). 0 = off. Solo para recuperación densa (embedding/híbrida).",
```

- [ ] **Step 5: Keep the slider default explicit `src/settings.ts:792`**

No value change yet (calibration may revise it in Task 5). Confirm the line reads:

```ts
              .setValue(s.nativeAgent.bfsMinScoreRatio ?? 0.6)
```

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/i18n.ts src/settings.ts
git commit -m "docs(settings): bfsMinScoreRatio copy for spread-relative bar semantics"
```

---

### Task 4: Deterministic eval harness (sweep + recall over recorded cosines)

**Files:**
- Create: `eval/graph-floor/queries.json` (gold set + recorded cosine fixtures)
- Create: `eval/graph-floor/analyze.ts` (pure sweep/summary functions)
- Create: `eval/graph-floor/run.ts` (entry: prints calibration table + self-checks)

**Interfaces:**
- Consumes: `robustLow`, `FLOOR_LO_PCT`, `pruneByRelevance` from Task 1.
- Produces (from `analyze.ts`):
  - `interface GoldQuery { id: string; question: string; domain: string; goldPages: string[]; denseMax: number; domainCosines: number[]; candidates: { pid: string; cosine: number; tokens: number }[] }`
  - `sweepQuery(q: GoldQuery, ratio: number): { kept: string[]; prunedTokens: number; totalTokens: number; recall: number }`
  - `summarize(queries: GoldQuery[], ratios: number[]): { ratio: number; tokenCutPct: number; minRecall: number; failing: number }[]`

- [ ] **Step 1: Create the gold fixture `eval/graph-floor/queries.json`**

Two representative deepseek-range entries. **Replace these with real recorded captures during Task 5** (see Task 5 Step 1); the schema and harness work on whatever entries are present.

```json
[
  {
    "id": "q1",
    "question": "График закаливания?",
    "domain": "homelab",
    "goldPages": ["wiki_homelab_hardening"],
    "denseMax": 0.59,
    "domainCosines": [0.40, 0.42, 0.44, 0.46, 0.48, 0.50, 0.52, 0.55, 0.59],
    "candidates": [
      { "pid": "wiki_homelab_hardening", "cosine": 0.57, "tokens": 280 },
      { "pid": "wiki_homelab_backup",    "cosine": 0.49, "tokens": 320 },
      { "pid": "wiki_homelab_network",   "cosine": 0.44, "tokens": 410 },
      { "pid": "wiki_homelab_unrelated", "cosine": 0.41, "tokens": 350 }
    ]
  },
  {
    "id": "q2",
    "question": "Настройка обратного прокси?",
    "domain": "homelab",
    "goldPages": ["wiki_homelab_proxy"],
    "denseMax": 0.56,
    "domainCosines": [0.39, 0.41, 0.43, 0.45, 0.47, 0.50, 0.53, 0.56],
    "candidates": [
      { "pid": "wiki_homelab_proxy",   "cosine": 0.54, "tokens": 300 },
      { "pid": "wiki_homelab_dns",     "cosine": 0.50, "tokens": 260 },
      { "pid": "wiki_homelab_certs",   "cosine": 0.45, "tokens": 220 },
      { "pid": "wiki_homelab_offtopic","cosine": 0.40, "tokens": 380 }
    ]
  }
]
```

- [ ] **Step 2: Create the pure analyzer `eval/graph-floor/analyze.ts`**

```ts
// Pure sweep/summary over recorded graph-candidate cosines. No I/O, no network — the
// floor's real behavior (robustLow + pruneByRelevance) exercised over recorded fixtures.
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../../src/retrieval-prune";

export interface GoldQuery {
  id: string;
  question: string;
  domain: string;
  goldPages: string[];
  denseMax: number;
  domainCosines: number[];
  candidates: { pid: string; cosine: number; tokens: number }[];
}

export interface QuerySweep {
  kept: string[];
  prunedTokens: number;
  totalTokens: number;
  recall: number; // fraction of goldPages retained (1 = all kept)
}

export function sweepQuery(q: GoldQuery, ratio: number): QuerySweep {
  const loRef = robustLow(q.domainCosines, FLOOR_LO_PCT);
  const denseByPid: Record<string, number> = {};
  for (const c of q.candidates) denseByPid[c.pid] = c.cosine;
  const ids = q.candidates.map((c) => c.pid);
  const { keep } = pruneByRelevance(ids, denseByPid, q.denseMax, loRef, ratio);
  let prunedTokens = 0;
  let totalTokens = 0;
  for (const c of q.candidates) {
    totalTokens += c.tokens;
    if (!keep.has(c.pid)) prunedTokens += c.tokens;
  }
  const goldKept = q.goldPages.filter((g) => keep.has(g)).length;
  const recall = q.goldPages.length === 0 ? 1 : goldKept / q.goldPages.length;
  return { kept: [...keep], prunedTokens, totalTokens, recall };
}

export interface RatioRow {
  ratio: number;
  tokenCutPct: number; // % of candidate tokens pruned across all queries
  minRecall: number;   // worst per-query recall at this ratio
  failing: number;     // # queries with recall < 1
}

export function summarize(queries: GoldQuery[], ratios: number[]): RatioRow[] {
  return ratios.map((ratio) => {
    let pruned = 0;
    let total = 0;
    let minRecall = 1;
    let failing = 0;
    for (const q of queries) {
      const s = sweepQuery(q, ratio);
      pruned += s.prunedTokens;
      total += s.totalTokens;
      if (s.recall < minRecall) minRecall = s.recall;
      if (s.recall < 1) failing += 1;
    }
    return {
      ratio,
      tokenCutPct: total === 0 ? 0 : (pruned / total) * 100,
      minRecall,
      failing,
    };
  });
}

/** Best ratio = the largest with no recall loss (failing === 0). null if none. */
export function recommend(rows: RatioRow[]): RatioRow | null {
  const safe = rows.filter((r) => r.failing === 0 && r.ratio > 0);
  if (safe.length === 0) return null;
  return safe.reduce((a, b) => (b.tokenCutPct > a.tokenCutPct ? b : a));
}
```

- [ ] **Step 3: Create the entry/self-check `eval/graph-floor/run.ts`**

```ts
/**
 * Calibration harness for the graph relevance floor. Deterministic: sweeps `ratio`
 * over recorded real cosine fixtures (eval/graph-floor/queries.json) using the REAL
 * robustLow + pruneByRelevance, printing token-cut % and gold-page recall per ratio.
 * Run: npx tsx eval/graph-floor/run.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, recommend, sweepQuery, type GoldQuery } from "./analyze";

const here = dirname(fileURLToPath(import.meta.url));
const queries = JSON.parse(readFileSync(join(here, "queries.json"), "utf8")) as GoldQuery[];
const RATIOS = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

console.log(`\n=== Calibration sweep (${queries.length} gold queries) ===`);
console.log("ratio  tokenCut%  minRecall  failing");
for (const r of summarize(queries, RATIOS)) {
  console.log(
    `${r.ratio.toFixed(2)}   ${r.tokenCutPct.toFixed(1).padStart(7)}   ${r.minRecall.toFixed(2).padStart(7)}   ${String(r.failing).padStart(5)}`,
  );
}
const best = recommend(summarize(queries, RATIOS));
console.log(best
  ? `\nRecommended default ratio: ${best.ratio} (tokenCut ${best.tokenCutPct.toFixed(1)}%, recall 100%)`
  : "\nNo non-zero ratio keeps recall=100% — widen FLOOR_LO_PCT or revisit fixtures.");

// --- self-checks (deterministic, do not need the JSON fixtures) ---
let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
console.log("\n=== self-checks ===");
{
  const q: GoldQuery = {
    id: "t", question: "q", domain: "d", goldPages: ["g"], denseMax: 0.59,
    domainCosines: [0.40, 0.45, 0.50, 0.55, 0.59],
    candidates: [
      { pid: "g", cosine: 0.57, tokens: 100 },
      { pid: "noise", cosine: 0.42, tokens: 100 },
    ],
  };
  const off = sweepQuery(q, 0);
  check("ratio 0 prunes nothing", off.prunedTokens === 0 && off.recall === 1);
  const on = sweepQuery(q, 0.6);
  check("ratio 0.6 prunes noise", on.prunedTokens === 100 && on.kept.includes("g"), `kept=${on.kept.join(",")}`);
  check("ratio 0.6 keeps gold (recall 1)", on.recall === 1);
  const rows = summarize([q], [0, 0.6, 0.95]);
  check("summarize tokenCut rises with ratio", rows[1].tokenCutPct > rows[0].tokenCutPct);
}
console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
```

- [ ] **Step 4: Run the harness — expect the table + PASS**

Run: `npx tsx eval/graph-floor/run.ts`
Expected: a sweep table, a recommended ratio line, then `OK — 4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add eval/graph-floor/queries.json eval/graph-floor/analyze.ts eval/graph-floor/run.ts
git commit -m "test(eval): deterministic graph-floor calibration sweep over recorded cosines"
```

---

### Task 5: Calibrate constants on real captures

**Files:**
- Modify: `eval/graph-floor/queries.json` (replace samples with real captures)
- Modify: `src/retrieval-prune.ts` (`FLOOR_LO_PCT` if the sweep says so)
- Modify: `src/types.ts:300` + `src/settings.ts:792` (default `ratio` if the sweep says so)

**Interfaces:**
- Consumes: the Task 4 harness; a running plugin against the deepseek endpoint.

- [ ] **Step 1: Record real cosine fixtures (one-time, live prerequisite)**

Run each intended gold query in the plugin (dev build, dense mode, deepseek endpoint) with `bfsMinScoreRatio = 0` so the floor does not prune — this exposes the full candidate set. From the progress trace `graph_stats` (now carrying `expandedDense`, `denseMax`, and the printed bar), transcribe into `queries.json` for each query: `denseMax`, the graph-candidate cosines + a per-candidate token estimate (`candidates[]`), a sample of domain cosines (`domainCosines` — the `expandedDense` values plus the seed cosines are a sufficient sample), and the human-known correct source page id(s) as `goldPages`. Aim for ~10–15 queries spanning the deepseek-compressed case.

- [ ] **Step 2: Run the sweep and read the recommendation**

Run: `npx tsx eval/graph-floor/run.ts`
Read the table: pick the `ratio` with the highest `tokenCut%` at `failing = 0` (the `Recommended default ratio` line). If `failing > 0` at every non-zero ratio, raise `FLOOR_LO_PCT` (e.g. p10 → `0.10`) in `src/retrieval-prune.ts` and re-run — a higher lower-anchor lifts the whole range and reduces over-pruning of mid candidates.

- [ ] **Step 3: Set the calibrated constants**

If the recommended default differs from `0.6`, update `src/types.ts:300` (`bfsMinScoreRatio: <value>`) and `src/settings.ts:792` (`?? <value>`). If `FLOOR_LO_PCT` changed, it is already edited in Step 2.

- [ ] **Step 4: Re-run the sweep + the unit suite to confirm**

Run: `npx tsx eval/graph-floor/run.ts && npx tsx eval/retrieval-prune/run.ts`
Expected: both print `OK — … 0 failed`; the sweep shows `tokenCut% > 0` at the chosen default with `minRecall = 1.00`.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors; bundle rebuilt.

- [ ] **Step 6: Commit**

```bash
git add eval/graph-floor/queries.json src/retrieval-prune.ts src/types.ts src/settings.ts main.js
git commit -m "chore(retrieval): calibrate graph-floor constants on recorded deepseek cosines"
```

> `main.js` (the built bundle) is committed because this repo ships `dist`/bundle with each change (see prior `chore(build)` commits). Confirm the bundle output path from `esbuild.config.mjs` and stage that file.

---

## Self-Review

**Spec coverage:**
- Part 1 (robust bar) → Task 1 (formula) + Task 2 (wiring). ✓
- Part 2 (edge guards: range-collapsed + matrix) → Task 1 (`collapsed`) + Task 2 (`floorSkippedReason`). ✓
- Part 3 (measurement substrate + calibration) → Task 4 (deterministic sweep/recall) + Task 5 (real captures, calibration order). ✓ Deviation: the live capture is a documented manual recording (graph_stats is not persisted to a log, and a headless deepseek bootstrap is out of scope), and `run.ts`/`analyze.ts` operate deterministically over the recorded fixtures. Faithful to the spec's intent (token delta + gold recall), tighter on determinism.
- Part 4 (observability: floorLoRef/floorBar) → Task 2 Steps 1, 4. ✓
- Part 5 (setting copy) → Task 3. ✓
- Verification (ratio=0 baseline, recall@floor=100%, unit cases) → Task 1 tests (boundary/collapse/zero-ratio/missing), Task 4 sweep (recall), Task 5 re-run. ✓

**Placeholder scan:** No "TBD/TODO" left as work items. The `FLOOR_LO_PCT`/default-`ratio` values are concrete (`0.05`/`0.6`) and Task 5 adjusts them from data — not placeholders.

**Type consistency:** `pruneByRelevance` returns `{ keep, pruned, bar, collapsed }` everywhere (Task 1 def, Task 2 destructure, Task 4 usage via `keep`). `robustLow(values, pct)` and `FLOOR_LO_PCT` names match across Tasks 1, 2, 4. `GoldQuery` fields (`denseMax`, `domainCosines`, `candidates[].cosine/tokens`, `goldPages`) match between `queries.json`, `analyze.ts`, and `run.ts`.
