---
review:
  intent_hash: 5d1be493efed4924
  last_run: 2026-06-14
  phases:
    structure:    { status: passed }
    completeness: { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
    alignment:    { status: passed }   # advisory — вне CRITICAL-gate
  findings: []
---
# Intent: RAG query quality (graph health → fusion → rerank)

**Date:** 2026-06-14
**Status:** approved
**Source doc:** [docs/rag-quality-recommendations.md](../../rag-quality-recommendations.md)

## Objective

Raise retrieval and answer quality of the obsidian-ai-wiki query pipeline, working the
full scope from `rag-quality-recommendations.md` in stages rather than one big change:

1. **Metrics first** — build an eval harness (30–50 `question → gold page` pairs, Recall@k + MRR)
   so every later change is measured, not tuned blind.
2. **Tier 1 — graph health** — Dedup on Ingest + Lint near-duplicate; hybrid retrieval
   (dense+sparse or Grep-fallback for exact tokens); strong model on Ingest/Init.
3. **Tier 2 — Query pipeline** — RRF fusion of (vector rank, BFS rank), cross-encoder rerank
   over the union, similarity threshold + fallback.

Why now: the multi-vector retrieval + ranked BFS layer just landed (`feat/index-search-quality`).
The pieces are in place to fuse the two signals and keep the graph healthy — but there is no
way to measure whether a change helps. Metrics unblock the rest.

## Desired Outcomes

- **Recall@k / MRR are real numbers** — the eval harness reports Recall@k and MRR on a fixed
  set; two configs (e.g. dense-only vs hybrid, ±rerank) can be compared and the delta is visible.
- **No duplicates after Ingest** — re-ingesting a similar note updates the existing page instead
  of spawning a second; lint surfaces near-duplicate pairs as merge candidates.
- **Fallback instead of noise** — when max cosine is below threshold, Query does not push garbage
  seeds into BFS; it falls back to keyword/Grep or an honest "not found".
- **Better top-k after rerank** — after RRF + cross-encoder rerank, more relevant pages reach the
  LLM context; visible in the trace UI and on eval.

## Health Metrics (must not degrade)

- **Offline Jaccard path** — works with no API key (keyless Ollama / pure Jaccard) and stays
  working. New features (rerank, hybrid) are optional enhancements, never make an API key required.
- **Query token budget** — ~6800 input tok/call does not grow. RRF/rerank shrink the context, never
  inflate it.
- **Query latency** — with new features OFF (default), p50 Query latency is unchanged vs the current
  baseline. With rerank/hybrid ON, p50 grows ≤ 20% vs the flags-off baseline, measured on the eval
  set. Rerank/hybrid add no heavy synchronous call to the hot path while their flags are off.
- **Existing test suite** — the whole current suite stays green; no new `tsc` errors in touched
  files; `lint` clean.

## Strategic Context

- Interacts with: `src/phases/query.ts` (hot Query path), `src/page-similarity.ts` (multi-vector,
  max-pool cosine), `src/wiki-graph.ts` (`bfsExpandRanked`, BFS), `src/wiki-seeds.ts`,
  `src/wiki-index.ts` (`_index.md` annotations), Ingest/Init phases, Lint; embeddings via Ollama
  (key optional), LLM via claude-cli / proxy. Cross-encoder rerank (`bge-reranker-v2-m3`) and
  hybrid `bge-m3` need an additional model endpoint.
- Priority trade-off: **trust** — retrieval precision outranks speed and cost. Cross-encoder and
  extra endpoints are acceptable when they raise precision, as long as the Health Metrics hold.

### Existing machinery to build on (verified against code, not duplicate)
- **Answer-quality eval already exists** — `devMode.evaluatorModel` + `src/phases/evaluator.ts`
  (`runEvaluator`) score the *answer* (0–10 + reasoning) via an LLM judge. The new metrics phase
  adds **retrieval** Recall@k/MRR over a fixed `question → gold page` set — a distinct signal,
  built alongside the existing evaluator, not replacing it.
- **Ingest already merges via the LLM** — it emits `deletes` (merge cleanup), guarded by
  `mergeDeleteWarnThreshold`. Dedup-on-Ingest adds a **cosine check before creating a page**;
  it complements the existing LLM-driven merge rather than replacing it.
- **Confirmed absent** (grep clean): RRF, cross-encoder rerank, cosine seed threshold/fallback,
  hybrid dense+sparse / Grep-fallback, retrieval Recall@k/MRR harness.

## Constraints

### Steering (behavioral guidance)
- **Feature-flag everything new** — RRF / rerank / threshold / dedup live behind settings with safe
  defaults; default behavior does not change without explicit opt-in.
- **Surgical changes** — minimum code, no rewrite of retrieval from scratch; reuse the existing
  `bfsExpandRanked` and `page-similarity` machinery.

### Hard (architectural enforcement)
- **Obsidian desktop + mobile** — node builtins lazy-loaded and desktop-guarded; mobile path does
  not crash; `lint` must pass (mirrors the Obsidian reviewer).
- **Keyless offline is mandatory** — the no-API-key path must not break. New features must degrade
  gracefully when no embedding/rerank endpoint is configured.

## Autonomy Zones

- **Full autonomy (reversible, low risk):** implementation *within* an approved feature — writing
  code, tests, refactors local to that feature; running tests/lint/tsc.
- **Guarded (log + confidence threshold):** parameter defaults (top-k, RRF k, threshold,
  temperature) — pick from the doc's reference table, log the choice.
- **Proposal-first (needs approval):** **each notable feature** — eval-harness design, Dedup-on-Ingest,
  hybrid retrieval, RRF, cross-encoder rerank, similarity threshold+fallback. Present approach +
  diff sketch, get sign-off, then implement.
- **No autonomy (human only):** adding a hard dependency on a new external model endpoint as a
  *default*; any change that would make an API key required.

> These zones OVERRIDE subagent-driven-development's "continuous execution, don't pause" default.
> Every feature listed under proposal-first is a HUMAN CHECKPOINT in the plan.

## Stop Rules

- **Halt if:** a change breaks the offline Jaccard path, grows the Query token budget past ~6800,
  or turns an existing test red.
- **Escalate if:** a Tier 1/2 feature can only meet its outcome by making an external endpoint or
  API key mandatory (No-autonomy zone).
- **Done when (BOTH hold):**
  1. *Ship gate* — each feature works and is covered: feature behind its flag, tests pass,
     `lint`+`tsc` clean on touched files, all four Health Metrics intact; AND
  2. *Observable outcome* — the eval harness shows Recall@k/MRR measured before/after on the fixed
     set, and the hybrid+rerank config demonstrates a measurable improvement over the dense-only
     baseline. Clause 2 is the real "done" signal; clause 1 is the release gate that guards it.
