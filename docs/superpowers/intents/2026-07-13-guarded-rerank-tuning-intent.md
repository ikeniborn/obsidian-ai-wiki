---
review:
  intent_hash: c53dd0443eac9baa
  last_run: 2026-07-13
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Guarded Rerank Tuning

**Date:** 2026-07-13
**Status:** approved

## Objective

Tune the runtime reranker pipeline after real LiteLLM `/v1/rerank` evidence showed acceptable latency but quality regressions with full reranking. The goal is to improve precision without letting the reranker override the already accepted retrieval baseline.

## Desired Outcomes

- Runtime reranking, when explicitly enabled, uses the accepted baseline ordering as a backbone instead of fully replacing it.
- Candidate text sent to the reranker contains enough page and chunk context to make reranker scores more reliable.
- The integration eval can compare full rerank with guarded rerank variants and identify the best no-regression variant.
- The plugin keeps existing Query behavior when reranker is disabled, misconfigured, slow, malformed, or unavailable.
- The latest eval report clearly states whether the guarded rerank variant is accepted, needs tuning, blocked, or rejected.

## Health Metrics

- `Recall@5` must not fall below the pre-rerank baseline.
- `nDCG@5` must not fall below the pre-rerank baseline.
- Aggregate `MRR` must remain at least `0.90`.
- No per-query legacy-overlap floor may regress.
- Target p95 rerank latency regression is at most `+500 ms`.
- p95 rerank latency regression at or above `+1 sec` is a hard stop.
- Reranker fallback behavior must preserve pre-rerank ordering and must not fail Query.
- Runtime reranker remains disabled by default.

## Strategic Context

- Interacts with:
  - `src/reranker.ts` runtime ordering and candidate serialization.
  - `scripts/eval-reranker-integration.ts` model-on no-regression gate.
  - `tests/reranker.test.ts` and `tests/eval-reranker-integration.test.ts`.
  - `docs/superpowers/evals/reranker-integration-hld-eval.md`.
  - iWiki page `jsonl-domain-storage`.
- Priority trade-off: trust > speed > cost. Do not accept a rerank variant that wins only by aggressive promotion while regressing gold metrics.

## Constraints

### Steering (behavioral guidance)

- Use guarded rerank over baseline order, not full rerank, as the runtime direction.
- Improve candidate text with title/path/heading and a query-aware excerpt.
- Keep the fixed top-K flow: `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- Keep lexical and vector retrieval parallel at the recall layer.
- Evaluate full rerank as a control variant but do not make it the runtime default.
- Prefer fixed code defaults for guard parameters until eval evidence justifies exposing new settings.

### Hard (architectural enforcement)

- Do not change HLD gold labels or no-regression floors.
- Do not enable reranker by default.
- Do not add `graphChunkTopN` in this tuning slice.
- Do not recommend a concrete reranker model in settings.
- Do not make `/rerank` required for normal Query.
- Do not print API keys or secrets in eval output.

## Autonomy Zones

- Full autonomy (reversible, low risk): focused tests, pure scoring helpers, eval variant reporting, generated eval report, and repository/wiki documentation updates.
- Guarded (log + confidence threshold): selecting the fixed guarded scoring alpha and candidate text cap from eval evidence.
- Proposal-first (needs approval): exposing alpha or candidate cap as new UI settings, changing no-regression thresholds, changing reranker default-on behavior, or changing endpoint settings.
- No autonomy (human only): changing gold labels/floors or using an external endpoint that was not explicitly configured by the user.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: guarded rerank cannot beat or match baseline quality within the no-regression gate.
- Halt if: p95 latency regression is at or above `+1 sec`.
- Halt if: the eval cannot prove successful real `/rerank` calls.
- Escalate if: the only accepted path requires changing gold labels, floors, defaults, or settings scope.
- Done when: guarded rerank runtime behavior is test-covered; query-aware candidate text is test-covered; the integration eval reports full and guarded variants; real LiteLLM evidence is recorded; docs and iWiki describe the chosen behavior; and normal disabled/fallback Query behavior remains verified.
