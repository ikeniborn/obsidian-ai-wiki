---
review:
  intent_hash: 535272eb64423cd3
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Lexical retrieval quality

**Date:** 2026-07-11
**Status:** approved

## Objective

Improve lexical retrieval quality in both the HLD eval harness and runtime Query.
The current Jaccard scorer is too coarse: `ownership-components` only reaches
`Overlap@5 = 0.20`, and several top results are noisy. The change should improve
ranking without requiring LLM, embedding, network, OpenAI, or Ollama dependencies,
while preserving the fast offline fallback behavior.

## Desired Outcomes

- HLD eval average `Overlap@5` is at least `0.65`.
- `ownership-components` improves above the current `Overlap@5 = 0.20`.
- No HLD eval query drops below its current `Overlap@5` value:
  - `data-export-s3-clickhouse`: `0.40`
  - `airflow-ha-balancing`: `1.00`
  - `integrations-consumers-marts`: `0.40`
  - `migration-gitflame`: `0.60`
  - `ownership-components`: `0.20`
- All five HLD eval queries remain `accepted`.
- Runtime Query in `jaccard` mode uses the improved lexical scorer for seed/page
  ranking and chunk ranking.
- Lexical fallback remains fully offline and does not require embeddings, LLMs, or
  network access.

## Health Metrics

- HLD eval query latency does not grow by more than 25% from the current range of
  roughly 42-55 ms/query.
- All five HLD eval queries remain `accepted`.
- No per-query `Overlap@5` regression from the current values.
- Offline/Jaccard fallback does not require embeddings, LLMs, network access,
  OpenAI, or Ollama.
- Existing focused tests, lint, and build pass.
- Embedding/hybrid retrieval paths do not regress: the lexical scorer may affect
  fallback and sparse-side ranking, but not dense vector computation.

## Strategic Context

- Interacts with:
  - `src/wiki-seeds.ts` for seed/page lexical scoring.
  - `src/page-similarity.ts` for Jaccard chunk ranking, seed fallback, and sparse-side
    hybrid retrieval.
  - `scripts/eval-jsonl-domain-storage.ts` for the HLD eval harness.
  - Retrieval and eval tests.
  - Repository docs and the `obsidian-ai-wiki` iwiki domain.
- Scope: eval harness plus runtime Query lexical/Jaccard paths. Ingest dedup and
  near-duplicate scoring stay out of scope for this change.
- Priority trade-off: trust, then speed, then cost.

## Constraints

### Steering (behavioral guidance)

- The scorer must be deterministic, explainable, and testable.
- Prefer conservative, evidence-backed signals: title/path boost, heading boost,
  exact-token boost, page+chunk fusion, and transparent weighting.
- Eval evidence must show current baseline versus improved metrics, or otherwise
  make the before/after comparison explicit.

### Hard (architectural enforcement)

- Do not add network, LLM, or embedding requirements to the lexical path.
- `## Related` and `## External links` remain excluded from chunk scoring and
  embedding input.
- Do not change vector format or the `index.jsonl` schema without separate approval.
- Do not reduce any current HLD query `Overlap@5` value.
- Do not reduce the HLD eval verdict below `accepted`.

## Autonomy Zones

- Full autonomy (reversible, low risk): scorer weights within a reasonable range,
  pure helper module shape, test fixtures, and report formatting.
- Guarded (log + evidence threshold): changing runtime ranking order for
  Jaccard/fallback paths when HLD eval proves improvement and tests pass.
- Proposal-first (needs approval): changing default retrieval mode or settings UI,
  changing embedding/hybrid dense behavior, or changing the `index.jsonl` schema.
- No autonomy (human only): adding external service/model dependencies, mutating the
  HLD source vault, or improving the report metric without real ranking improvement.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions is
> marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: HLD eval average `Overlap@5` is below `0.65`.
- Halt if: any query drops below the current `Overlap@5` values:
  `0.40`, `1.00`, `0.40`, `0.60`, `0.20`.
- Halt if: runtime Jaccard tests fail or embedding/hybrid tests regress.
- Escalate if: achieving the quality target appears to require schema changes,
  default-mode changes, dense retrieval changes, or model/network dependencies.
- Done when: HLD eval shows average `Overlap@5 >= 0.65`, all five queries remain
  `accepted`, no per-query regression is present, runtime Query uses the improved
  lexical scorer in Jaccard/fallback paths, and tests, lint, build, and `wiki_lint`
  pass.
