---
chain:
  intent: null
---

# Graph Relevance Floor: Robust Bar for Compressed Cosine Ranges — Design

Date: 2026-06-30
Status: approved (design), pending spec review

## Problem

The graph relevance floor (`bfsMinScoreRatio`, shipped in PR #41) drops graph-expanded
pages whose raw dense cosine falls below a bar. The bar is currently anchored to the
absolute cosine of the best seed:

```
bar = ratio * denseMax          // src/retrieval-prune.ts:14
```

This assumes cosine scores spread across a wide, model-independent range. They do not.
The deepseek embedding model produces a **compressed** cosine range: the best seed sits
around `denseMax ≈ 0.59`, and *every* candidate lives in `~0.40–0.59`. With the default
`ratio = 0.6` the bar is `0.6 · 0.59 ≈ 0.35` — below the entire candidate cluster, so the
floor prunes **nothing**. A cut only appears at `ratio ≈ 0.95`, where the knob is
unusable (one notch lower keeps everything, one notch higher prunes everything).

Root cause: the bar measures an **absolute** cosine position, but relevance separation
lives in the model's **dynamic range** (the span between its "irrelevant" floor and its
best match), which is model-specific and, for deepseek, narrow and high.

## Decision Summary

Resolved during brainstorming:

- **In-place formula change.** Keep the single `bfsMinScoreRatio` knob; replace the bar
  formula and recalibrate the default. No legacy mode, no second knob.
- **Approach A — spread-relative, domain-anchored.** Normalize the bar against the
  domain's actual cosine dynamic range, keeping the seed (`denseMax`) as the top anchor.
- **Measurement substrate: retrieval-only replay + offline analysis** over a gold-labeled
  query set. No human 👍/👎 labels.
- **Quality proxy: gold-page recall.** The floor must never prune a query's expected
  source pages (`recall@floor = 100%`).
- Jaccard mode stays out of scope (different score scale).

## Design

### Part 1 — Robust bar formula (core)

`src/retrieval-prune.ts`, `pruneByRelevance`:

```
loRef = robustLow(domainCosines)              // lower anchor: model's "irrelevant" level
bar   = loRef + ratio * (denseMax - loRef)    // ratio = position within [loRef … denseMax]
keep page  ⇔  cosine ≥ bar                    // missing cosine → keep (unchanged)
```

- `denseMax` — best seed cosine (top anchor; already computed, `page-similarity.ts:717`).
- `domainCosines` = `Object.values(denseByPid)` — the raw cosine of **every domain page
  that has a vector**, from the seed dense pass. `denseByPid` is already threaded to the
  floor call site (`query.ts:192`), so `loRef` is computed inline — **no new stat is
  threaded through `page-similarity.ts`**.
- `robustLow` — a fixed **low percentile** of `domainCosines` (a percentile, not the true
  minimum, so a single near-zero outlier page cannot drag the anchor down and weaken the
  bar). The exact percentile (candidates: true-min / p5 / p10) is chosen by the
  calibration spike (Part 3), then hard-coded.

`ratio` now means "fraction of the way up the domain's real dynamic range", which is
stable across models: deepseek's narrow high range and a wide bge-style range both map
onto `[loRef … denseMax]`.

Worked example (deepseek): `loRef = 0.40`, `denseMax = 0.59`.

| ratio | bar | effect |
|-------|-----|--------|
| 0.5 | 0.495 | prunes the 0.40–0.49 tail |
| 0.6 | 0.514 | prunes more of the lower band |
| 0.0 | 0.40 | bar at the floor → keep-all (off switch preserved) |

### Part 2 — Edge guards

The floor skips (degrades to keep-all) and records a `floorSkippedReason` when the bar
cannot be computed meaningfully. New guard plus the existing matrix:

| Condition | Floor | Reason |
|-----------|-------|--------|
| `denseMax - loRef < ε` (range collapsed; e.g. tiny domain, all-equal cosines) | skipped | `range-collapsed` |
| `bfsMinScoreRatio = 0` | skipped (off switch) | — |
| jaccard mode | skipped | `jaccard-mode` |
| `embedFailed` | skipped | `embed-failed` |
| `denseMax ≤ 0` | skipped | `low-dense` |
| `seedFallback ≠ "none"` | skipped | `seed-fallback:<kind>` |
| `bfsTopK = 0` | skipped | `bfs-uncapped` |

`ε` is a small constant (e.g. `1e-6`); its role is only to avoid dividing a degenerate
range, not to tune aggressiveness.

### Part 3 — Measurement substrate and calibration

No captured distribution data exists yet: `logs/agent.jsonl` holds 0 `graph_stats` /
0 `expandedDense` entries, and `eval/retrieval-prune/run.ts` is a pure unit test, not a
live replay. The data must be generated fresh.

**Key simplification:** gold-recall and token deltas need only the **retrieval phase**,
not the LLM answer. The replay runs seed selection + graph expansion + cosine scoring and
stops at `graph_stats`. Embeddings are deterministic for a fixed model, so the replay is
reproducible and spends no generation tokens.

New harness `eval/graph-floor/`:

- `queries.json` — the gold set: `[{ question, domain, goldPages: [pageId, …] }]`.
  Small (~10–15 queries), covering the deepseek compressed-range case.
- `run.ts` — for each query, run retrieval against the live deepseek embedding endpoint
  and dump per-query: `expandedDense`, a summary of `denseByPid` (or the raw values),
  `denseMax`, the selected page set, and a context-token estimate of the selected pages.
- `analyze.ts` — read the dumps and report:
  - `expandedDense` distribution (min / p5 / p10 / median / max) → informs the `loRef`
    percentile choice;
  - a sweep over `ratio` → prune fraction, **recall@floor** (no gold page pruned), and
    token delta;
  - a `ratio → tokens↓ / recall` table → informs the default.

**Calibration order:**

1. Run the replay on the current (baseline) formula and dump.
2. Run `analyze.ts` on the raw `expandedDense` distributions. Choose the `loRef`
   percentile and the new default `ratio` that maximize the token reduction subject to
   **`recall@floor = 100%`** (no gold page pruned).
3. Hard-code the chosen percentile and default `ratio`.
4. Re-run the replay with the new formula → confirm tokens ↓ and recall stable.

### Part 4 — Observability

Extend `graph_stats` (`src/types.ts` type + `src/phases/query.ts:200` emit):

- `floorLoRef: number` — the lower anchor actually used.
- `floorBar: number` — the final computed threshold (previously only the implicit
  `floorRef = denseMax` was surfaced; the real bar was invisible).
- `floorRef` stays `= denseMax` (the top anchor).

The compact progress trace prints the explicit `bar` so tuning runs are legible.

### Part 5 — Setting copy

- `src/types.ts`: update the `bfsMinScoreRatio` comment to the new semantics (position in
  the domain dynamic range) and the recalibrated default value.
- `src/settings.ts`: update the slider description text to match. The control itself (a
  single `0..1` slider) is unchanged; `0` still disables the floor everywhere.

## Out of Scope

- Jaccard-mode floor (different score scale; needs its own calibration).
- A second LLM relevance-judging pass over graph pages (adds tokens; contradicts the
  goal).
- Per-user configurability of the `loRef` percentile (it is a fixed, calibrated constant).
- Any change to seed selection, `bfsTopK`, or fusion ordering.

## Verification

- **Regression guard:** `ratio = 0` reproduces the pre-change baseline exactly (bar at
  `loRef`, keep-all) — proven by the replay and a unit test.
- **Replay before/after:** summed context tokens ↓, `recall@floor = 100%` (no gold page
  pruned) on the gold set.
- **Unit (`eval/retrieval-prune/run.ts`, extended):**
  - boundary exactly at `loRef + ratio·(denseMax − loRef)` → kept (`≥`);
  - `range-collapsed` (`denseMax − loRef < ε`) → skip, keep-all;
  - `loRef` percentile computed correctly on a known cosine vector;
  - missing cosine → kept; `ratio = 0` and `denseMax = 0` → keep-all.

## Touched Files

| File | Change |
|------|--------|
| `src/retrieval-prune.ts` | new bar formula + `loRef`/`robustLow`; range-collapse guard |
| `src/phases/query.ts` | compute `loRef` from `denseByPid`; thread into floor; emit `floorLoRef` / `floorBar` in `graph_stats` |
| `src/types.ts` | `graph_stats` fields `floorLoRef` / `floorBar`; `bfsMinScoreRatio` comment + recalibrated default |
| `src/settings.ts` | slider description copy for new semantics |
| `eval/graph-floor/run.ts` (new) | retrieval-only replay, dumps `expandedDense` + tokens |
| `eval/graph-floor/queries.json` (new) | gold-labeled query set |
| `eval/graph-floor/analyze.ts` (new) | distribution + ratio-sweep + recall/token report |
| `eval/retrieval-prune/run.ts` | additional formula / range-collapse / percentile tests |

## Related

- PR #41 — original `ratio·denseMax` floor (`2026-06-30-hybrid-retrieval-prune-design.md`).
- PR #43 — `graph_stats.expandedDense` raw-cosine field (the distribution-analysis input).
