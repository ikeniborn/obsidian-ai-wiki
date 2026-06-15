---
review:
  spec_hash: 3147eff51cb9f531
  last_run: 2026-06-15
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Components / 4. Retrieval orchestration"
      section_hash: c2e2cdefea083839
      text: '"dense" (CLI config name) and "embedding" (service mode / cache type) name two levels of the same retrieval path; bridged explicitly at the dense->embedding step, so not a defect — noted for term-consistency.'
      verdict: fixed
      verdict_at: 2026-06-15
      resolution: 'Pinned the dense<->embedding mapping at the --config flag definition (Component 1); "dense" = config name, "embedding" = mechanism, stated once and used consistently.'
chain:
  intent: docs/superpowers/intents/2026-06-14-rag-query-quality-intent.md
---
# Design: Retrieval eval harness (RAG quality — Phase 1)

**Date:** 2026-06-15
**Status:** draft
**Intent:** [docs/superpowers/intents/2026-06-14-rag-query-quality-intent.md](../intents/2026-06-14-rag-query-quality-intent.md)
**Scope:** Phase 1 of the staged RAG-quality plan — the retrieval eval harness only.
Tier 1 (graph health) and Tier 2 (Query pipeline) are out of scope here; this harness
is the instrument that will measure them.

## Acceptance (from intent)

Carried verbatim from the approved intent doc. These are FIXED inputs.

### Desired Outcomes (this phase)
- **Recall@k / MRR are real numbers** — the eval harness reports Recall@k and MRR on a fixed
  set; two configs (e.g. dense-only vs hybrid, ±rerank) can be compared and the delta is visible.

(The other three Desired Outcomes — no duplicates after Ingest, fallback instead of noise,
better top-k after rerank — belong to Tier 1 / Tier 2 phases. This harness is what makes their
deltas measurable.)

### Done when (BOTH hold)
1. *Ship gate* — each feature works and is covered: feature behind its flag, tests pass,
   `lint`+`tsc` clean on touched files, all four Health Metrics intact; AND
2. *Observable outcome* — the eval harness shows Recall@k/MRR measured before/after on the fixed
   set, and the hybrid+rerank config demonstrates a measurable improvement over the dense-only
   baseline. Clause 2 is the real "done" signal; clause 1 is the release gate that guards it.

### Health Metrics (must not degrade)
- Offline Jaccard path works keyless. — harness honours this: `--config jaccard` runs with no API key.
- Query token budget (~6800 tok/call) does not grow. — harness does not touch the Query hot path.
- Query latency unchanged with flags off. — harness is a separate script, not on the hot path.
- Existing test suite stays green; no new `tsc` errors in touched files; `lint` clean. — harness
  adds new files + pure-function unit tests only.

## Overview

A standalone CLI (`scripts/eval.ts`, run via `tsx`) that measures **retrieval quality** of the
wiki query pipeline against a fixed `question → gold page` set, reporting **Recall@k** and **MRR**.
It runs against a **real Obsidian vault** on disk (real `_index.md` annotations + real embedding
cache), so the numbers reflect production retrieval, not a synthetic fixture.

This is distinct from the existing **answer-quality** evaluator (`devMode.evaluatorModel`,
[src/phases/evaluator.ts](../../../src/phases/evaluator.ts) `runEvaluator`), which scores the
LLM *answer* (0–10 + reasoning) via an LLM judge. The eval harness scores the *retrieved page set*
— a different, upstream signal. The two are complementary and do not share code.

## Components

Each component has one purpose, a defined interface, and is independently understandable.

### 1. `scripts/eval.ts` — CLI entry + orchestration
Parses arguments, loads the gold set, runs each requested config through the retrieval
orchestration, computes metrics, prints the table, and (optionally) writes/diffs a JSON snapshot.

CLI surface:
```
tsx scripts/eval.ts --vault <path> --gold <gold.json> [--config dense|jaccard]
                    [--bfs-depth 0|1|2] [--top-k N] [--out run.json] [--baseline run.json]
```
- `--vault` — path to the vault root (contains the wiki folder).
- `--gold` — path to the gold-set JSON.
- `--config` — which config(s) to run. Repeatable or comma-list. Default: `dense,jaccard`.
  Config names map to a `PageSimilarityService` mode: **`dense`** = embedding-vector retrieval
  (`mode: "embedding"`, the embedding cache + `selectRelevantScored`); **`jaccard`** = offline
  token-overlap (`mode: "jaccard"`, keyless). Throughout this doc "dense" is the config name and
  "embedding" is its underlying mechanism — they refer to the same path.
- `--bfs-depth` — BFS hops for the union layer. `0` = seed-only. Default: `1`.
- `--top-k` — seed top-k passed to retrieval. Default: `8`.
- `--out` — write a JSON snapshot of this run.
- `--baseline` — read a prior snapshot and print per-metric deltas (▲/▼) next to the table.

Recall is reported at fixed **k = 3, 5, 8**. MRR is unbounded rank.

### 2. node-fs `VaultTools` shim
A minimal `{ read, write }` adapter over `node:fs/promises`, inline in `scripts/`. The plugin's
[PageSimilarityService](../../../src/page-similarity.ts) `loadCache`/`refreshCache` and the
`_index.md` read only need `read`/`write`, so the shim is a few lines. No Obsidian runtime needed.

It reads: the wiki `_index.md` (annotations), the embedding cache file (`domainEmbeddingsPath`),
and the wiki `.md` pages (for graph construction). All paths are vault-relative, resolved against
`--vault`.

### 3. Gold-set fixture — `eval/<name>.gold.json`
A JSON array of `{ q, gold }` pairs, ~30–50 entries, passed via `--gold`. `gold` is a list of
relevant page IDs (1+), reflecting that a real wiki may spread one topic across pages.

```json
[
  { "q": "как работает инкрементальный ingest", "gold": ["Ingest", "Embedding-Cache"] },
  { "q": "что делает BFS depth 1",              "gold": ["Query-Graph-Traversal"] }
]
```
Page IDs use the same `pageId` stem the retrieval layer returns. The gold set is vault-specific
(IDs reference one vault), so it is committed alongside the harness but named per vault. It
contains only questions + page IDs — no vault content.

### 4. Retrieval orchestration (approach A — thin orchestration)
`eval.ts` mirrors the seed-selection + BFS block of
[src/phases/query.ts](../../../src/phases/query.ts) (the `~70–135` region) by calling the **same
public functions in the same order** — it does NOT run `runQuery` (which drags in LLM answer-gen,
link validation, streaming) and does NOT modify `query.ts`.

Steps per config:
1. Read + `parseIndexAnnotations(_index.md)` → `indexAnnotations`.
2. Build `allAnnotatedPaths` from annotation keys.
3. **Seed layer:**
   - `dense` (embedding): `similarity.loadCache(...)` then `selectRelevantScored(q, annotations, paths)`.
   - `jaccard`: `selectSeeds(q, syntheticPages, topK, minScore, annotations)` with `minScore = 0`
     so the harness sees the full ranked list and Recall@k is not pre-truncated by a threshold.
   - → ranked list `seeds` (page IDs by score).
4. **Union layer:** read all wiki `.md` pages via the fs shim, run
   [bfsExpandRanked](../../../src/wiki-graph.ts) at `--bfs-depth` from the seed set → ranked
   `union` (seeds first, then BFS-expanded ordered by `expandedScores`). `bfs-depth 0` → union = seeds.

**Drift mitigation (approach A):** because this duplicates ~10 lines of glue that also live in
`query.ts`, `eval.ts` carries a comment cross-referencing the `query.ts` seed+BFS block, and calls
the identical public functions so the two stay in lockstep. If Tier 2 changes the production
ordering, the harness orchestration is updated in the same change.

### 5. Metrics — pure functions (unit-tested)
Pure, Obsidian-free, vitest-tested functions over a ranked ID list + gold ID set:
- `recallAt(ranked, gold, k) = |gold ∩ ranked[0..k)| / |gold|`
- `mrr(ranked, gold) = 1 / (1-based rank of first gold hit)`, `0` if none.
- Averaged over all gold pairs, computed **per layer** (seed, union) and **per k** (3, 5, 8).

### 6. Config registry
A small array `{ name, mode, bfsDepth, topK }` resolved from CLI flags. Tier 2 adds entries
(`dense+rrf`, `dense+rerank`) as one record each — the orchestration dispatches on a config's
declared retrieval steps, so new configs do not require rewriting the harness.

### 7. Output
- **Console table:** rows = configs, columns = `sR@3 sR@5 sR@8 sMRR uR@3 uR@5 uR@8 uMRR`
  (s = seed layer, u = union layer).
- **`--out run.json`:** structured snapshot `{ vault, configs: [{ name, seed:{...}, union:{...} }], k:[3,5,8] }`.
- **`--baseline run.json`:** loads a prior snapshot and prints a delta (▲/▼ + signed value) per
  metric next to the current table — this is how "before/after" in the Done-when clause is satisfied.

### 8. Testing
- **Unit (vitest, CI, keyless):** `recallAt`, `mrr`, and the table/delta formatter — pure functions,
  no live API, using the existing mock infra where any I/O is involved.
- **Manual / live:** the CLI run itself against a real vault (dense mode needs a live embedding
  endpoint to embed the query; page vectors come from the cached file).
- **lat.md:** add a test-spec section for the metric functions under `lat.md/tests.md` and tie the
  vitest cases with `// @lat:` refs; document the harness under operations or a new section.

## Data flow

```
--gold gold.json ─┐
--vault <path> ───┼─> fs shim ─> indexAnnotations + allAnnotatedPaths + wiki pages
--config ─────────┘                     │
                       seed layer ───────┤
                         dense: loadCache + selectRelevantScored
                         jaccard: selectSeeds
                                          │
                       union layer ───────┴─> bfsExpandRanked(depth) ─> seeds∪BFS ranked
                                          │
   per question: recallAt(ranked, gold, k∈{3,5,8}), mrr(ranked, gold)
                                          │
                       average over gold ─┴─> table (+ baseline delta) + --out JSON
```

## Error handling

- Missing `--vault` / `_index.md` / `--gold` → explicit error naming the path; non-zero exit.
- `dense` mode with no embedding endpoint configured → `selectEmbedding` already falls back to
  Jaccard internally; the harness logs a warning so the run is not silently mislabeled "dense".
- A gold page ID not present in the vault → warn (likely a stale gold entry) and count it as a
  miss for that question (it can never be retrieved).
- Empty gold set → error before running anything.

## Out of scope (later phases)

- RRF fusion, cross-encoder rerank, similarity threshold + fallback, hybrid dense+sparse — these
  are Tier 2 configs that drop into the registry once built (each its own proposal-first feature).
- Dedup on Ingest, Lint near-duplicate, strong-model-on-Ingest — Tier 1.
- Wiring the harness into CI as a gate — the gold set is vault-specific; CI gating is a separate
  decision after the harness exists.

## Autonomy note (from intent)

Each Tier 1 / Tier 2 feature is **proposal-first** (HUMAN CHECKPOINT). This harness is itself the
first proposal-first feature and has been approved through brainstorming. Implementation of the
harness proceeds; the *next* feature (Tier 1) returns to a fresh proposal.
