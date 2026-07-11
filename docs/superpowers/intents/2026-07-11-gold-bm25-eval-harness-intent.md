---
review:
  intent_hash: 62e1c56833bda231
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Gold set BM25 eval harness

**Date:** 2026-07-11
**Status:** approved

## Objective

Prepare the next retrieval-quality step after weighted lexical retrieval.
The current HLD eval reaches average improved `Overlap@5 = 0.68`, but it still
uses legacy-overlap as the primary quality target. That baseline is useful as a
no-regression guard, yet it is noisy: some semantically relevant HLD results are
penalized because they do not overlap the old lexical top list.

The goal is to add a curated gold set for the five fixed HLD queries and an
offline BM25/RRF A/B harness. The harness should let us evaluate real semantic
relevance while keeping legacy-overlap floors as safety rails.

## Desired Outcomes

- A checked gold set exists for the five HLD eval queries, with relevant page
  ids/paths and short rationale per query.
- The eval harness can compare at least these variants:
  - current weighted lexical retrieval;
  - BM25 page retrieval;
  - BM25 chunk retrieval;
  - RRF fusions of weighted lexical, BM25 page, BM25 chunk, and legacy broad rank.
- The report shows per-query and aggregate `Recall@5`, `nDCG@5`, `MRR`, legacy
  `Overlap@5`, and variant deltas.
- The accepted variant improves gold metrics over current weighted lexical
  retrieval without dropping any existing legacy-overlap floor.
- The harness remains deterministic, offline, and does not mutate the Rostelecom
  HLD source vault.

## Health Metrics

- No per-query legacy `Overlap@5` regression below current accepted floors:
  `0.40`, `1.00`, `0.40`, `0.60`, `0.20`.
- Current weighted lexical retrieval remains available as a baseline variant.
- Runtime Query behavior does not change unless a later approved step explicitly
  promotes a variant from eval to runtime.
- HLD eval stays offline: no LLM, embeddings, network, OpenAI, Ollama, or source
  vault mutation.
- Focused tests, lint, build, and `wiki_lint(obsidian-ai-wiki)` pass.

## Strategic Context

- Interacts with:
  - `scripts/eval-jsonl-domain-storage.ts` for HLD eval execution and reporting.
  - `src/lexical-retrieval.ts` for current weighted lexical baseline and RRF helpers.
  - potential new pure BM25 helper module.
  - `docs/superpowers/evals/` for generated evidence.
  - `docs/rag-quality-recommendations.md` and the `obsidian-ai-wiki` iwiki domain.
- Priority trade-off: trust > speed > cost.

## Constraints

### Steering (behavioral guidance)

- Treat curated gold relevance as the primary quality signal, and legacy-overlap as
  the no-regression signal.
- Keep the first step focused on eval harness quality, not runtime ranking changes.
- Prefer transparent scoring and report tables that make per-query trade-offs clear.
- Use deterministic BM25 implementation with fixed parameters in the harness.

### Hard (architectural enforcement)

- Do not change `index.jsonl` schema or vector storage.
- Do not change default retrieval mode, settings UI, or dense embedding computation.
- Do not add runtime HLD-specific synonym expansion.
- Do not use LLM/model/network calls to label, score, or retrieve during the harness.
- Do not mutate the source HLD vault.

## Autonomy Zones

- Full autonomy (reversible, low risk): gold-set file format, pure BM25 helper
  shape, report table layout, deterministic test fixtures, BM25 parameters within
  the eval harness.
- Guarded (log + evidence threshold): choosing the best A/B variant when gold
  metrics improve and legacy floors do not regress.
- Proposal-first (needs approval): promoting any BM25/RRF variant into runtime Query,
  expanding the query set beyond the five fixed HLD queries, changing accepted
  thresholds, or modifying source data.
- No autonomy (human only): adding external service/model dependencies, mutating
  HLD source notes, or treating legacy-overlap-only improvement as real quality
  improvement.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions is
> marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the gold set cannot be represented deterministically in repo artifacts.
- Halt if: the best A/B variant improves gold metrics but drops below any current
  legacy-overlap floor.
- Halt if: passing the harness appears to require runtime synonym hacks, schema
  changes, dense retrieval changes, or model/network dependencies.
- Escalate if: the curated gold labels are ambiguous enough that relevance cannot
  be reviewed from page ids/paths and rationale.
- Done when: a checked gold set and BM25/RRF A/B harness produce a report showing
  gold metrics, legacy no-regression metrics, an accepted best variant, and all
  verification gates pass.
