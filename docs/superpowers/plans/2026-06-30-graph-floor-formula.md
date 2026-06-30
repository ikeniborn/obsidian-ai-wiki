---
review:
  plan_hash: f25400d3402f68df
  spec_hash: c3f886f9c0dc11ee
  last_run: 2026-06-30
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "Task 6: Calibrate constants on the live capture"
      section_hash: 3c1e677b7a495899
      fragment: "git add ... main.js"
      text: "Task 6 Step 6 builds and commits the bundle (main.js), which is not in the spec Touched Files."
      fix: "Accepted: repo convention ships the bundle with each change (prior chore(build) commits)."
      verdict: accepted
      verdict_at: 2026-06-30
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-30-graph-floor-formula-design.md
---
# Graph Relevance Floor — Robust Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph relevance floor's absolute `ratio·denseMax` bar with a spread-relative bar normalized against the domain's cosine dynamic range, so the floor still prunes graph noise when the embedding model's cosine range is compressed (e.g. deepseek ~0.40–0.59).

**Architecture:** The bar becomes `loRef + ratio·(denseMax − loRef)`, where `loRef` is a robust low percentile of all domain page cosines and `denseMax` is the best seed's cosine. The pure helper `pruneByRelevance` gains a `loRef` parameter and a range-collapse guard; `query.ts` computes `loRef` inline from the already-available `denseByPid` map and surfaces the bar in `graph_stats`. A headless live replay drives the real retrieval against the deepseek embedding endpoint over a gold-labeled query set, captures the raw cosine distributions, and an offline analyzer sweeps `ratio` to report token reduction and gold-page recall for calibration.

**Tech Stack:** TypeScript, esbuild bundle, standalone `tsx` run-scripts (no vitest/jest), Obsidian plugin runtime; headless harness uses a Node `fetch`-backed `obsidian` stub + a `node:fs/promises` VaultTools adapter.

## Global Constraints

- Single user knob: `bfsMinScoreRatio` (`0..1`, `0` = floor off). No legacy mode, no second knob.
- The floor adds **zero** embedding calls — it reuses cosines already computed in the seed dense pass (`denseByPid`).
- A graph page with no cosine is KEPT (cannot evaluate → no quality loss).
- Floor runs only in dense modes (`embedding`/`hybrid`) with a strong seed signal; jaccard mode is out of scope.
- Quality proxy is gold-page recall: the floor must never prune a query's expected source pages (`recall@floor = 100%`).
- Code comments / commit messages: English.
- Deterministic tests are `tsx` run-scripts printing `OK — N passed, 0 failed`; a non-zero failure count calls `process.exit(1)`. The live capture (Task 5) is keyed and not part of CI.

---

### Task 1: Robust bar formula in the pure helper

**Files:**
- Modify: `src/retrieval-prune.ts` (whole file — new exports + changed signature)
- Test: `eval/retrieval-prune/run.ts` (replace the test body)

**Interfaces:**
- Produces:
  - `FLOOR_LO_PCT: number` — the low percentile constant (initial `0.05`, finalized in Task 6).
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
 *  eval/graph-floor (Task 6); p5 by default. */
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

- [ ] **Step 3: Run the tests**

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
- Consumes: `robustLow`, `FLOOR_LO_PCT`, `pruneByRelevance` from Task 1; `denseByPid` (in scope at `query.ts:105`), `denseMax`, `retrievalMode`, `embedFailed`, `seedFallback`.
- Produces: `graph_stats` events carry `floorLoRef?: number` and `floorBar?: number`.

- [ ] **Step 1: Extend the `graph_stats` event type in `src/types.ts`**

Replace the floor fields (lines 110–113) with:

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

No value change yet (calibration may revise it in Task 6). Confirm the line reads:

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

### Task 4: Offline analyzer (deterministic ratio sweep + recall)

**Files:**
- Create: `eval/graph-floor/analyze.ts` (pure functions + a printable `main` over a capture file)
- Create: `eval/graph-floor/analyze.test.ts` (keyless deterministic self-check — the CI gate)

**Interfaces:**
- Consumes: `robustLow`, `FLOOR_LO_PCT`, `pruneByRelevance` from Task 1.
- Produces:
  - `interface GoldQuery { id: string; question: string; domain: string; goldPages: string[]; denseMax: number; domainCosines: number[]; candidates: { pid: string; cosine: number; tokens: number }[]; goldSeeds: string[] }`
  - `sweepQuery(q: GoldQuery, ratio: number): { kept: string[]; prunedTokens: number; totalTokens: number; recall: number }`
  - `summarize(queries: GoldQuery[], ratios: number[]): { ratio: number; tokenCutPct: number; minRecall: number; failing: number }[]`
  - `recommend(rows): RatioRow | null` — largest non-zero ratio with `failing === 0`, else `null`.

  `candidates` are the graph-expanded (non-seed) pages — the only ones the floor evaluates. `goldSeeds` are gold pages that were seeds (always kept). Recall is measured vs the `ratio=0` baseline candidate set, so a gold page never retrieved is not counted against the floor.

- [ ] **Step 1: Create `eval/graph-floor/analyze.ts`**

```ts
// Pure sweep/summary over captured graph-candidate cosines (eval/graph-floor/capture.json,
// produced live by run.ts). No network — the floor's real math (robustLow + pruneByRelevance)
// run over recorded distributions. Importable (pure) and runnable (prints the sweep table).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../../src/retrieval-prune";

export interface GoldQuery {
  id: string;
  question: string;
  domain: string;
  goldPages: string[];
  denseMax: number;
  domainCosines: number[];
  candidates: { pid: string; cosine: number; tokens: number }[];
  goldSeeds: string[];
}

export interface QuerySweep { kept: string[]; prunedTokens: number; totalTokens: number; recall: number }

export function sweepQuery(q: GoldQuery, ratio: number): QuerySweep {
  const loRef = robustLow(q.domainCosines, FLOOR_LO_PCT);
  const denseByPid: Record<string, number> = {};
  for (const c of q.candidates) denseByPid[c.pid] = c.cosine;
  const ids = q.candidates.map((c) => c.pid);
  const { keep } = pruneByRelevance(ids, denseByPid, q.denseMax, loRef, ratio);
  let prunedTokens = 0;
  let totalTokens = 0;
  for (const c of q.candidates) { totalTokens += c.tokens; if (!keep.has(c.pid)) prunedTokens += c.tokens; }
  const goldCand = q.goldPages.filter((g) => ids.includes(g));
  const present = q.goldSeeds.length + goldCand.length;
  const kept = q.goldSeeds.length + goldCand.filter((g) => keep.has(g)).length;
  const recall = present === 0 ? 1 : kept / present;
  return { kept: [...keep], prunedTokens, totalTokens, recall };
}

export interface RatioRow { ratio: number; tokenCutPct: number; minRecall: number; failing: number }

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
    return { ratio, tokenCutPct: total === 0 ? 0 : (pruned / total) * 100, minRecall, failing };
  });
}

/** Best = the largest non-zero ratio with no recall loss. null if none. */
export function recommend(rows: RatioRow[]): RatioRow | null {
  const safe = rows.filter((r) => r.failing === 0 && r.ratio > 0);
  if (safe.length === 0) return null;
  return safe.reduce((a, b) => (b.tokenCutPct > a.tokenCutPct ? b : a));
}

export const RATIOS = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

// Printable entry: `npx tsx eval/graph-floor/analyze.ts [capture.json]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = process.argv[2] ?? join(here, "capture.json");
  const queries = JSON.parse(readFileSync(path, "utf8")) as GoldQuery[];
  console.log(`\n=== Calibration sweep (${queries.length} captured queries) ===`);
  console.log("ratio  tokenCut%  minRecall  failing");
  const rows = summarize(queries, RATIOS);
  for (const r of rows) {
    console.log(`${r.ratio.toFixed(2)}   ${r.tokenCutPct.toFixed(1).padStart(7)}   ${r.minRecall.toFixed(2).padStart(7)}   ${String(r.failing).padStart(5)}`);
  }
  const best = recommend(rows);
  console.log(best
    ? `\nRecommended default ratio: ${best.ratio} (tokenCut ${best.tokenCutPct.toFixed(1)}%, recall 100%)`
    : "\nNo non-zero ratio keeps recall=100% — raise FLOOR_LO_PCT or revisit the gold set.");
}
```

- [ ] **Step 2: Create `eval/graph-floor/analyze.test.ts`**

```ts
// Keyless deterministic self-check for the analyzer. Run: npx tsx eval/graph-floor/analyze.test.ts
import { sweepQuery, summarize, recommend, type GoldQuery } from "./analyze";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

const q: GoldQuery = {
  id: "t", question: "q", domain: "d", goldPages: ["g", "s"],
  denseMax: 0.59, domainCosines: [0.40, 0.45, 0.50, 0.55, 0.59],
  candidates: [
    { pid: "g", cosine: 0.57, tokens: 100 },
    { pid: "noise", cosine: 0.42, tokens: 100 },
  ],
  goldSeeds: ["s"], // gold page "s" was a seed → always kept
};

const off = sweepQuery(q, 0);
check("ratio 0 prunes nothing", off.prunedTokens === 0 && off.recall === 1);
const on = sweepQuery(q, 0.6);
check("ratio 0.6 prunes noise", on.prunedTokens === 100 && on.kept.includes("g"), `kept=${on.kept.join(",")}`);
check("ratio 0.6 keeps gold candidate + gold seed (recall 1)", on.recall === 1);
const rows = summarize([q], [0, 0.6, 0.95]);
check("summarize tokenCut rises with ratio", rows[1].tokenCutPct > rows[0].tokenCutPct);
check("recommend picks a safe non-zero ratio", (recommend(rows)?.failing ?? 1) === 0);

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
```

- [ ] **Step 3: Run the self-check**

Run: `npx tsx eval/graph-floor/analyze.test.ts`
Expected: `OK — 5 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add eval/graph-floor/analyze.ts eval/graph-floor/analyze.test.ts
git commit -m "test(eval): offline graph-floor ratio sweep + recall analyzer"
```

---

### Task 5: Headless live capture harness

**Files:**
- Create: `eval/graph-floor/register.ts` (`.md` loader + `obsidian` stub with a real `fetch`-backed `requestUrl`)
- Create: `eval/graph-floor/vault-fs.ts` (`node:fs/promises` VaultTools adapter)
- Create: `eval/graph-floor/queries.json` (gold seed set: id/question/domain/goldPages)
- Create: `eval/graph-floor/run.ts` (drives real retrieval against the live endpoint, writes `capture.json`)
- Create: `eval/graph-floor/.gitignore` (ignore the generated `capture.json`)

**Interfaces:**
- Consumes: `PageSimilarityService`, `retrieveDomainCandidates`, `parseIndexAnnotations`, `domainWikiFolder`/`domainIndexPath`, `VaultTools`/`VaultAdapter`, `DomainEntry`, `RunEvent` from `src/`.
- Produces: `eval/graph-floor/capture.json` — an array of `GoldQuery` records (Task 4 schema) consumed by `analyze.ts`.

- [ ] **Step 1: Create `eval/graph-floor/register.ts`**

```ts
/**
 * Boot shims for the live graph-floor harness. Must be the first import.
 * 1. `.md` → text (esbuild uses loader:text in prod; here manual).
 * 2. Stub "obsidian" with a real fetch-backed requestUrl so PageSimilarityService's
 *    fetchEmbeddings() can hit the live OpenAI-compatible /embeddings endpoint headlessly.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const req = require as NodeRequire & {
  extensions: Record<string, (m: { exports: unknown }, filename: string) => void>;
};
req.extensions[".md"] = (m, filename) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  m.exports = require("fs").readFileSync(filename, "utf-8");
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module") as { _load: (...args: unknown[]) => unknown };
const _origLoad = Module._load;
Module._load = function (...args: unknown[]) {
  if (args[0] === "obsidian") {
    return {
      moment: { locale: () => "en" },
      Platform: { isDesktopApp: true, isMobile: false },
      async requestUrl(opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }) {
        const r = await fetch(opts.url, { method: opts.method ?? "GET", headers: opts.headers, body: opts.body });
        const text = await r.text();
        return { status: r.status, text };
      },
    };
  }
  return _origLoad.apply(this, args);
};
```

- [ ] **Step 2: Create `eval/graph-floor/vault-fs.ts`**

```ts
// node:fs/promises VaultTools adapter. Vault paths (e.g. "!Wiki/<domain>/_config/_index.md")
// are joined onto the vault root and read/listed directly from disk.
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";

export function buildVaultTools(vaultRoot: string): VaultTools {
  const abs = (p: string) => join(vaultRoot, p);
  const adapter: VaultAdapter = {
    async read(p) { return fs.readFile(abs(p), "utf-8"); },
    async write(p, data) { await fs.mkdir(dirname(abs(p)), { recursive: true }); await fs.writeFile(abs(p), data); },
    async append(p, data) { await fs.appendFile(abs(p), data); },
    async exists(p) { try { await fs.stat(abs(p)); return true; } catch { return false; } },
    async mkdir(p) { await fs.mkdir(abs(p), { recursive: true }); },
    async list(p) {
      const entries = await fs.readdir(abs(p), { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const e of entries) {
        const child = join(p, e.name); // keep vault-relative so recursion re-joins onto vaultRoot
        if (e.isDirectory()) folders.push(child);
        else files.push(child);
      }
      return { files, folders };
    },
  };
  return new VaultTools(adapter, vaultRoot);
}
```

- [ ] **Step 3: Create the gold seed set `eval/graph-floor/queries.json`**

Replace the example entries with ~10–15 real gold queries spanning the deepseek case. `domain` is the wiki folder name; `goldPages` are the human-known correct source page ids (without `.md`).

```json
[
  { "id": "q1", "question": "График закаливания?", "domain": "homelab", "goldPages": ["wiki_homelab_hardening"] },
  { "id": "q2", "question": "Настройка обратного прокси?", "domain": "homelab", "goldPages": ["wiki_homelab_proxy"] }
]
```

- [ ] **Step 4: Create `eval/graph-floor/run.ts`**

```ts
/**
 * Live capture: drives the REAL retrieval (seed dense pass + graph expansion) against the
 * deepseek/OpenAI-compatible embedding endpoint over the gold queries, writing capture.json
 * (GoldQuery records) for the offline analyzer. Requires a wiki vault with a prebuilt
 * embedding cache (_config/_embeddings.json) on disk.
 *
 * Env: WIKI_VAULT (vault root), EMBED_BASE_URL (…/v1), EMBED_MODEL, EMBED_DIM, EMBED_API_KEY.
 * Run: WIKI_VAULT=… EMBED_BASE_URL=… EMBED_MODEL=… EMBED_DIM=… EMBED_API_KEY=… npx tsx eval/graph-floor/run.ts
 */
import "./register";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PageSimilarityService } from "../../src/page-similarity";
import { retrieveDomainCandidates } from "../../src/phases/query";
import { parseIndexAnnotations } from "../../src/wiki-index";
import { domainWikiFolder, domainIndexPath } from "../../src/wiki-path";
import type { DomainEntry } from "../../src/domain";
import type { RunEvent } from "../../src/types";
import { buildVaultTools } from "./vault-fs";

const here = dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(readFileSync(join(here, "queries.json"), "utf8")) as
  { id: string; question: string; domain: string; goldPages: string[] }[];

const VAULT = process.env.WIKI_VAULT;
const BASE = process.env.EMBED_BASE_URL;
const MODEL = process.env.EMBED_MODEL;
const DIM = Number(process.env.EMBED_DIM ?? "0") || undefined;
const KEY = process.env.EMBED_API_KEY ?? "";
if (!VAULT || !BASE || !MODEL) {
  console.error("Set WIKI_VAULT, EMBED_BASE_URL, EMBED_MODEL (and EMBED_DIM, EMBED_API_KEY).");
  process.exit(2);
}

const vault = buildVaultTools(VAULT);
const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0, bfsMinScoreRatio: 0 };
const signal = new AbortController().signal;
const estTokens = (s: string) => Math.ceil(s.length / 4);

function dom(folder: string): DomainEntry {
  return { id: folder, name: folder, wiki_folder: folder, source_paths: [], entity_types: [], analyzed_sources: {} } as DomainEntry;
}

void (async () => {
  const out: unknown[] = [];
  for (const g of gold) {
    const root = domainWikiFolder(g.domain);
    const similarity = new PageSimilarityService({
      mode: "embedding", model: MODEL, dimensions: DIM, topK: cfg.seedTopK, baseUrl: BASE, apiKey: KEY,
    });
    await similarity.loadCache(root, vault);
    const indexContent = await vault.read(domainIndexPath(root));
    const annotations = parseIndexAnnotations(indexContent);
    const allPaths = [...annotations.keys()].map((id) => `${root}/${id}.md`);
    const diag = await similarity.selectRelevantScoredDiag(g.question, annotations, allPaths);

    const genGen = retrieveDomainCandidates(dom(g.domain), g.question, vault, similarity, signal, cfg);
    let r = await genGen.next();
    let gstats: Extract<RunEvent, { kind: "graph_stats" }> | undefined;
    while (!r.done) {
      if ((r.value as RunEvent).kind === "graph_stats") gstats = r.value as Extract<RunEvent, { kind: "graph_stats" }>;
      r = await genGen.next();
    }
    const cand = r.value;
    if (!cand || !gstats) { console.error(`no candidates for ${g.id}`); continue; }

    const seedSet = new Set(cand.seeds);
    const candidates = gstats.expandedPages
      .filter((pid) => diag.denseByPid[pid] !== undefined)
      .map((pid) => ({
        pid,
        cosine: diag.denseByPid[pid],
        tokens: estTokens(cand.pages.get(`${root}/${pid}.md`) ?? ""),
      }));

    out.push({
      id: g.id, question: g.question, domain: g.domain, goldPages: g.goldPages,
      denseMax: diag.denseMax,
      domainCosines: Object.values(diag.denseByPid),
      candidates,
      goldSeeds: g.goldPages.filter((p) => seedSet.has(p)),
    });
    console.log(`captured ${g.id}: denseMax=${diag.denseMax.toFixed(3)} cands=${candidates.length}`);
  }
  writeFileSync(join(here, "capture.json"), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${out.length} records to eval/graph-floor/capture.json`);
})();
```

- [ ] **Step 5: Create `eval/graph-floor/.gitignore`**

```
capture.json
```

- [ ] **Step 6: Typecheck + lint (no live run in CI)**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors. (`run.ts` is keyed; it is exercised live in Task 6, not here.)

- [ ] **Step 7: Commit**

```bash
git add eval/graph-floor/register.ts eval/graph-floor/vault-fs.ts eval/graph-floor/queries.json eval/graph-floor/run.ts eval/graph-floor/.gitignore
git commit -m "test(eval): headless live capture harness for graph-floor cosines"
```

---

### Task 6: Calibrate constants on the live capture

**Files:**
- Modify: `eval/graph-floor/queries.json` (the real gold set, if not already filled in Task 5 Step 3)
- Modify: `src/retrieval-prune.ts` (`FLOOR_LO_PCT` if the sweep requires it)
- Modify: `src/types.ts:300` + `src/settings.ts:792` (default `ratio` if the sweep requires it)

- [ ] **Step 1: Capture real distributions (live)**

Point at a wiki vault with a built deepseek embedding cache and run:

```bash
WIKI_VAULT=/path/to/vault EMBED_BASE_URL=https://your-deepseek/v1 EMBED_MODEL=<model> EMBED_DIM=<dim> EMBED_API_KEY=<key> npx tsx eval/graph-floor/run.ts
```

Expected: a `captured <id>: …` line per gold query and `Wrote N records to eval/graph-floor/capture.json` with `N == queries.length`. If a query reports `no candidates`, fix its `domain`/`goldPages` in `queries.json` and rerun.

- [ ] **Step 2: Run the sweep and read the recommendation**

Run: `npx tsx eval/graph-floor/analyze.ts`
Read the table: take the `Recommended default ratio` line (largest `ratio` with `failing = 0`). If `failing > 0` at every non-zero ratio, raise `FLOOR_LO_PCT` (e.g. `0.10`) in `src/retrieval-prune.ts` and rerun this step — a higher lower-anchor lifts the range and reduces over-pruning of mid candidates.

- [ ] **Step 3: Set the calibrated constants**

If the recommended default differs from `0.6`, update `src/types.ts:300` (`bfsMinScoreRatio: <value>`) and `src/settings.ts:792` (`?? <value>`). If `FLOOR_LO_PCT` changed in Step 2, it is already edited.

- [ ] **Step 4: Re-verify (deterministic)**

Run: `npx tsx eval/graph-floor/analyze.ts && npx tsx eval/graph-floor/analyze.test.ts && npx tsx eval/retrieval-prune/run.ts`
Expected: the sweep shows `tokenCut% > 0` at the chosen default with `minRecall = 1.00`; both test scripts print `OK — … 0 failed`.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors; bundle rebuilt.

- [ ] **Step 6: Commit**

```bash
git add src/retrieval-prune.ts src/types.ts src/settings.ts main.js
git commit -m "chore(retrieval): calibrate graph-floor constants on live deepseek cosines"
```

> `main.js` (the built bundle) is committed because this repo ships the bundle with each change (see prior `chore(build)` commits). Confirm the bundle output path from `esbuild.config.mjs` and stage that file.

---

## Self-Review

**Spec coverage:**
- Part 1 (robust bar) → Task 1 (formula) + Task 2 (wiring). ✓
- Part 2 (edge guards: range-collapsed + matrix) → Task 1 (`collapsed`) + Task 2 (`floorSkippedReason`). ✓
- Part 3 (measurement substrate + calibration: live retrieval-only replay, expandedDense dump, gold recall, token delta) → Task 5 (`run.ts` live capture against the deepseek endpoint) + Task 4 (`analyze.ts` sweep/recall/token-delta) + Task 6 (calibration order). ✓
- Part 4 (observability: floorLoRef/floorBar) → Task 2 Steps 1, 4. ✓
- Part 5 (setting copy) → Task 3. ✓
- Verification (ratio=0 baseline, recall@floor=100%, unit cases) → Task 1 tests, Task 4 self-check + sweep, Task 6 re-verify. ✓

**Placeholder scan:** No "TBD/TODO" work-item markers. `FLOOR_LO_PCT`/default-`ratio` are concrete (`0.05`/`0.6`); Task 6 adjusts them from live data with an explicit decision rule (largest ratio at `failing = 0`).

**Type consistency:** `pruneByRelevance` returns `{ keep, pruned, bar, collapsed }` across Task 1 (def), Task 2 (destructure), Task 4 (`keep`). `robustLow(values, pct)` + `FLOOR_LO_PCT` names match across Tasks 1, 2, 4. `GoldQuery` fields (`denseMax`, `domainCosines`, `candidates[].cosine/tokens`, `goldSeeds`, `goldPages`) match between `analyze.ts`, `analyze.test.ts`, and `run.ts`'s emitted records. `run.ts` and `query.ts` both derive the domain root via `domainWikiFolder(...)`, so vault-path strings are identical.
