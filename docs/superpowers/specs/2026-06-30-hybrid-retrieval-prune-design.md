---
review:
  spec_hash: fcedf46fb62afcb1
  last_run: 2026-06-30
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: null
---

# Hybrid Retrieval: Graph-Noise Pruning + Stats Transparency — Design

Date: 2026-06-30
Status: approved (design), pending spec review

## Problem

The query results header packs four issues reported from the sidebar (single-domain "Ask Domain" run, hybrid retrieval mode):

1. **Stats block touches the "Results" heading** — no vertical gap, visually glued.
2. **"Selected for LLM: 10" is opaque** — user configured "top-5 vector / top-5 graph" and cannot see that 10 = 5 seeds + 5 graph-expanded.
3. **Graph expansion injects low-relevance pages** — BFS neighbours are ranked and capped at `bfsTopK` but have **no relevance floor**; weak neighbours pad the LLM context, costing tokens and distorting the answer.
4. **Hybrid search should re-evaluate graph additions** — vector-retrieve, add graph neighbours, re-score, and drop those below a relevance bar; raise quality, cut tokens, no quality loss.

## Root-Cause Findings (verified against code)

- **"10" is not a bug.** `pagesSelected = contextPages.length` (`src/phases/query.ts:260`). `selectContextPages` emits seeds first (`seedTopK`, default 5) then BFS-expanded up to the cap. Observed run (`agent.jsonl`): `graph_stats seeds=5, expanded(total)=10, expandedPages=5, retrievalMode=hybrid, denseMax≈0.6`. So `10 = 5 vector seeds + 5 graph-expanded`. The label hides the two pools.
- **No relevance floor on graph pages.** `bfsExpandRanked` (`src/wiki-graph.ts:116`) ranks non-seed BFS pages by similarity and slices to `bfsTopK`. `seedMinScore` gates **seeds only**, never BFS pages. Low-similarity neighbours survive up to the cap.
- **Existing `bfsFusion` only reorders, never prunes.** `fuseVectorGraph` (`src/fusion.ts`) RRF-fuses vector + graph rank over `seeds ∪ expanded`; membership is unchanged.

### Critical scale finding (why a naïve floor silently fails)

Score scales differ by retrieval mode:

| Mode | `seedScores` | `expandedScores` (graph) | `denseMax` |
|------|--------------|--------------------------|------------|
| embedding | raw cosine | raw cosine | raw cosine |
| **hybrid** (the reported mode) | **RRF-fused** (`page-similarity.ts:745`, max ≈ 1/(k+1) ≈ 0.016) | **RRF-fused** | raw cosine (computed separately) |
| jaccard | Jaccard coeff | Jaccard coeff | 0 |

In **hybrid mode**, `seedScores` and `expandedScores` are RRF-fused and are produced by **two separate `rrf()` calls over different candidate lists** — seeds over all annotated paths (`query.ts:99`), expanded over non-seed paths only (`bfsExpandRanked`). The top of each fused list is ≈ `1/(k+1)` regardless of true semantic similarity. Therefore a floor of the form `expandedScore ≥ ratio · max(seedScores)` would keep graph pages **by rank, not by relevance** — a no-op against graph noise, in exactly the mode the user runs.

**Resolution:** the floor must operate on **raw dense cosine**, with `denseMax` (raw cosine of the best seed) as the per-domain reference. Both are on the same scale and are semantically meaningful.

## Design

Four parts. Parts 1–2 are UI; Parts 3–4 are the retrieval change.

### Part 1 — Stats spacing (trivial)

`src/styles.css` (`.ai-wiki-cross-stats`, ~line 390): add `margin-top: 10px` so the stats box detaches from the "Results" header. No other change.

### Part 2 — "Selected for LLM" transparency

- `src/phases/query.ts`: extend the `query_stats` event with `seedCount` and `graphCount` (single-domain path only). `seedCount = seeds.length`; `graphCount = contextPages.length − seedCount`.
- `src/view.ts` (`renderQueryStats`, ~line 960): render the selected row as `7 (5 vector + 2 graph)`.
- Cross-domain (`Ask Wiki`) stats are structurally different (domains studied, contributing domains) and do **not** receive the breakdown.
- After the floor (Part 3) runs, `graphCount` naturally shrinks — the breakdown doubles as visible proof the floor fired.

### Part 3 — Relevance-floor pruning of graph noise (core)

New pure helper `src/retrieval-prune.ts`:

```
pruneByRelevance(expandedDense: Record<pid, number>, denseRef: number, ratio: number): Set<pid>
  → returns the pids to KEEP (expandedDense[pid] ≥ ratio · denseRef). Seeds are not passed in (always kept).
```

Wiring, inside `retrieveDomainCandidates` (`src/phases/query.ts`), immediately after `bfsExpandRanked`, before building `candidateIds`:

- **Reference:** `denseRef = denseMax` (per-domain raw cosine of the best seed, already computed at `query.ts:100`).
- **Per-page dense cosine for graph pages (chosen approach):** reuse the cosines already computed by the seed dense pass — do **not** add a new scoring call in `bfsExpandRanked`. `selectEmbeddingScoredDiag` (`page-similarity.ts:655`) already scores **all annotated paths** but returns only the top-`limit`. Surface the full per-pid raw-cosine map from that pass (extend `SeedDiag` with a `denseByPid` map) and have `retrieveDomainCandidates` look up graph-expanded pids in it. Graph-expanded pages were scored in that same pass, so the floor needs **zero extra embedding calls**. (BFS pages absent from the index have no vector and are already invisible to retrieval; not a new edge case.) `bfsExpandRanked` is left unchanged.
- **Ordering vs membership are separate concerns:** ordering stays driven by `fuseVectorGraph` (when `bfsFusion` is on) / seeds-first; the floor only changes **membership** (which graph pages survive).

**Applicability matrix — the floor runs only when scales are comparable.** Skip (degrade to current behaviour) otherwise:

| Condition | Floor |
|-----------|-------|
| `mode ∈ {embedding, hybrid}` AND `denseMax > 0` AND `embedFailed = false` AND `seedFallback = "none"` AND `bfsMinScoreRatio > 0` | **applied** |
| jaccard mode | skipped (out of scope v1) |
| `denseMax = 0` / `embedFailed` / seed gate fell back to jaccard or LLM | skipped |
| `bfsTopK = 0` (no ranking, `expandedScores = {}`) | skipped |
| `bfsMinScoreRatio = 0` | skipped (off switch) |

**Observability:** extend `graph_stats` with `floorApplied: boolean`, `floorRef: number` (the `denseMax` used), `prunedCount: number`, and a `floorSkippedReason` when skipped. Surfaced in the progress trace and `agent.jsonl` for tuning.

**Both paths:** because the floor lives in `retrieveDomainCandidates` (called per-domain by both single-domain `runQuery` and the cross-domain stage-1 orchestrator), each domain prunes against **its own** `denseMax`. Ask Domain and Ask Wiki both benefit, scale-correctly, with no cross-domain reference bleed.

### Part 4 — Setting

- `src/types.ts`: new field `bfsMinScoreRatio: number` (default `0.6`, range `0..1`, `0` = floor off). Record it in `eval_meta.retrievalConfig` for traceability. Note: this `0.6` is a **fraction of `denseRef`**, unrelated to the observed `denseMax ≈ 0.6` in the example run — the effective bar is `0.6 · denseMax ≈ 0.36`.
- `src/settings.ts`: a slider next to "BFS fusion".
- **The single knob.** `bfsMinScoreRatio` is the sole control for the floor, on **both** query paths. It is **decoupled** from `bfsFusion` — `bfsFusion` continues to control *ordering* only. `ratio = 0` disables the floor everywhere.

## Out of Scope (v1)

- Jaccard-mode floor (different score scale; would need its own ratio calibration).
- A second LLM relevance-judging pass over graph pages (rejected: adds tokens, contradicts the token-reduction goal).
- Elbow/gap-based cutoff (rejected in favour of the relative-to-seed threshold).
- Any change to seed selection, `bfsTopK`, or the fusion ordering itself.

## Verification

- **Eval harness:** `npm run eval` before/after with `bfsMinScoreRatio = 0.6`. Expect summed `Tokens sent` ↓ and quality metrics flat (we drop only low-relevance graph pages). `ratio = 0` must reproduce the pre-change baseline exactly (regression guard).
- **Unit:** `retrieval-prune.test` — keep/drop boundary at `ratio · denseRef`; empty scores → keep-none-pruned (skip); `denseRef = 0` → skip.
- **Manual (the reported run):** re-run the screenshot query in hybrid mode. Confirm (a) the stats block has a gap below "Results"; (b) the selected row shows `N (X vector + Y graph)` with `Y` reduced vs the unfloored count; (c) the answer quality is unchanged or better.

## Touched Files

| File | Change |
|------|--------|
| `src/styles.css` | `margin-top` on `.ai-wiki-cross-stats` |
| `src/view.ts` | render `vector + graph` breakdown in `renderQueryStats` |
| `src/phases/query.ts` | call floor after `bfsExpandRanked`; extend `query_stats` + `graph_stats`; thread `bfsMinScoreRatio` |
| `src/retrieval-prune.ts` (new) | `pruneByRelevance` pure helper |
| `src/page-similarity.ts` | extend `SeedDiag` with a `denseByPid` raw-cosine map from the seed dense pass |
| `src/types.ts` | `bfsMinScoreRatio` field + default; record in `retrievalConfig` |
| `src/settings.ts` | slider for `bfsMinScoreRatio` |
