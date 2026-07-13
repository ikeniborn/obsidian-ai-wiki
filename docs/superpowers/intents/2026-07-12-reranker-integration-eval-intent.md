---
review:
  intent_hash: 44c471078fa5ab88
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Reranker Integration Eval

**Date:** 2026-07-12
**Status:** approved

## Objective

Add a separate integration eval that calls the configured `/rerank` endpoint with a user-selected model and compares pre-rerank versus post-rerank retrieval on the HLD gold set.

The eval must verify that the fixed runtime scheme `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN` works without quality or latency regressions when a real reranker endpoint is available. The result must be explicit enough to decide whether the selected reranker model is acceptable for runtime use.

## Desired Outcomes

- The integration eval can be run with one command against `baseUrl + /rerank`.
- The report shows baseline order, reranked order, `Recall@5`, `nDCG@5`, `MRR`, per-query floors, and p95 latency.
- If `/rerank` is unavailable or the model is missing, the eval is explicitly blocked or failed instead of silently passing.
- Gold labels and no-regression floors remain unchanged.
- The report gives a clear decision on whether the selected reranker model can be used for runtime reranking.

## Health Metrics

- `Recall@5` must not fall below baseline.
- `nDCG@5` must not fall below baseline and should improve when the reranker is useful.
- Aggregate `MRR` must remain at least `0.90`.
- No per-query legacy-overlap floor may regress.
- Target p95 Query latency regression is at most `+500 ms`.
- p95 Query latency regression at or above `+1 sec` is a hard stop.
- Query and reranker fallback semantics must not regress.
- The eval must not change gold labels, floors, or runtime defaults.

## Strategic Context

- Interacts with:
  - `scripts/eval-jsonl-domain-storage.ts` or a new sibling eval script.
  - `src/reranker.ts` and its `/rerank` adapter contract.
  - HLD gold labels and reports under `docs/superpowers/evals/`.
  - Runtime Query documentation and iwiki page `jsonl-domain-storage`.
  - A local or remote native-agent-compatible endpoint that exposes `/rerank`.
- Priority trade-off: trust > speed > cost. A blocked eval is preferable to a green report that did not actually call the reranker.

## Constraints

### Steering (behavioral guidance)

- Use the fixed candidate-selection scheme: `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- Keep lexical and vector retrieval parallel at the recall layer.
- Do not add `graphChunkTopN` in this integration eval slice.
- Do not recommend a concrete reranker model in settings or docs.
- Keep the eval reproducible without changing runtime defaults.
- The report must clearly separate retrieval baseline results from real reranker results.
- Prefer a mock `/rerank` smoke test for deterministic CI coverage and a real endpoint command for model evidence.

### Hard (architectural enforcement)

- Do not change HLD gold labels or no-regression floors.
- Do not enable reranker by default.
- Do not use a paid or cloud endpoint unless it is passed explicitly through CLI flags or environment variables.
- The `/rerank` endpoint and model must be provided explicitly through CLI flags or environment variables.
- If the endpoint or model is unavailable, the integration eval must not produce an accepted verdict.
- p95 latency regression at or above `+1 sec` blocks an accepted verdict.

## Autonomy Zones

- Full autonomy (reversible, low risk): intent/spec/plan docs, new eval script/report, focused tests, and repository/wiki documentation.
- Guarded (log + confidence threshold): CLI flags or environment variable shape, latency/quality report format, and local mock `/rerank` smoke test.
- Proposal-first (needs approval): changing acceptance thresholds, enabling reranker by default, or adding a separate runtime endpoint setting in the plugin UI.
- No autonomy (human only): changing gold labels or floors, or using an external paid endpoint without explicit user-provided endpoint settings.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the eval cannot prove that `/rerank` was actually called.
- Halt if: p95 latency regression is at or above `+1 sec`.
- Halt if: the quality gate fails for `Recall@5`, `nDCG@5`, `MRR`, or per-query floors.
- Escalate if: the eval requires a paid/cloud endpoint, default-on runtime behavior, or changed acceptance thresholds.
- Done when: checked intent, spec, and plan exist; the integration eval command exists; a mock `/rerank` smoke test exists; a report records quality and latency evidence; docs and iwiki describe the integration eval; and implementation is rechecked against the fixed runtime scheme.
