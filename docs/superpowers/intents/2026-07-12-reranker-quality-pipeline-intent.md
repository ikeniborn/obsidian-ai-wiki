---
review:
  intent_hash: 9f5fdbb1d5da283f
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Reranker Quality Pipeline

**Date:** 2026-07-12
**Status:** approved

## Objective

Improve wiki answer quality with a staged runtime quality pipeline: reranker first, then query expansion, answer-grounding/citation gate, and dedup/merge hygiene. The immediate need is to add a separate settings block for reranker enablement and model selection, then connect a runtime reranker pipeline behind that setting.

The reranker model is user-configurable. The UI must not present one specific model as the recommended model. The feature must improve retrieval precision without strong regressions in answer latency or established retrieval quality gates.

## Desired Outcomes

- Settings show a separate `Reranker` block, consistent with existing model settings.
- Users can enable or disable runtime reranking.
- Users can choose or enter a reranker model without the UI recommending one specific model.
- When enabled, Query first gathers candidates through the current retrieval pipeline: weighted lexical page seeds, semantic vector search over page descriptions, semantic vector search over chunks, graph BFS expansion from seed pages, graph-local page scoring, chunk scoring, and chunk/page candidate union. It then reranks top candidate chunks/pages before context selection.
- The final answer context uses top chunks/pages after rerank, not the pre-rerank order.
- Query falls back to the current retrieval order if reranker loading, scoring, or timeout fails.
- Settings expose explicit top-K controls for retrieval stages: seed selection, graph expansion, reranker candidate pool, and final context size.
- Settings briefly explain the top-K flow: `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- Settings validate `rerankerTopN >= contextTopN` and prevent saving or normalize invalid values before runtime.
- The design covers follow-up quality stages: query expansion, answer-grounding/citation gate, and dedup/merge hygiene.
- Eval gates show no strong regression in quality or speed before any new quality stage is enabled by default.

## Health Metrics

- `Recall@5` must not fall below baseline.
- `nDCG@5` should improve over baseline, or at least not regress when the change is justified by latency or reliability.
- Aggregate `MRR` must remain at least `0.90`.
- No per-query legacy-overlap floor may regress.
- Target p95 Query latency regression is at most `+500 ms`.
- p95 Query latency regression above `+1 sec` is a hard stop unless explicitly approved.
- Query must not fail when reranker, expansion, grounding, or hygiene checks error; it must fall back to the current pipeline.
- Citations must not point outside selected context when answer-grounding is enabled.

## Strategic Context

- Interacts with:
  - `src/settings.ts`, `src/i18n.ts`, and `src/types.ts` for plugin settings UI and persistence.
  - `src/phases/query.ts` and `src/phases/query-cross-domain.ts` for runtime Query flow.
  - `src/page-similarity.ts`, `src/wiki-seeds.ts`, and JSONL retrieval records for candidate/chunk ranking.
  - `scripts/eval-jsonl-domain-storage.ts` and HLD eval reports for no-regression gates.
  - iwiki pages `jsonl-domain-storage` and `hierarchical-retrieval-eval` for retrieval documentation.
- Priority trade-off: trust > speed > cost.

## Constraints

### Steering (behavioral guidance)

- Implement the quality program in stages: reranker first, then query expansion, answer-grounding/citation gate, and dedup/merge hygiene.
- Each quality stage should have its own eval gate before runtime default-on promotion.
- Settings UI should group quality controls into clear blocks, matching existing model settings patterns.
- Rerank only a bounded candidate pool, such as top 20-50 chunks/pages, instead of the full corpus.
- Replace hidden top-K multipliers with explicit settings and descriptions. The pipeline should not rely on implicit formulas like `seedTopK * 3` for chunk or context limits.
- Keep top-K ordering clear: `seedTopK` controls lexical and description-vector entry pages, `graphDepth` and `bfsTopK` control graph expansion, graph-local scoring reranks graph pages with lexical, description-vector, and graph-distance signals, chunk scoring reranks graph chunks with lexical, chunk-vector, and inherited page scores, `rerankerTopN` controls the final chunk/page candidate pool, and `contextTopN` controls final chunks sent to the answer LLM.
- Do not introduce `graphChunkTopN` in the initial design. If eval shows graph chunks are too noisy or too narrow, add `graphChunkTopN` later as a separate explicit setting.
- Minimize prompt, token, and latency overhead.
- Prefer deterministic fallbacks and observable diagnostics over silent behavior changes.

### Hard (architectural enforcement)

- Reranker, query expansion, and grounding must be individually disableable settings.
- Reranker model must be user-configurable and not hard-locked or recommended as a single specific model in the UI.
- New quality stages must not become default-on until eval/no-regression evidence supports that decision.
- Every stage must fallback to the current Query pipeline on model error, timeout, or unsupported runtime.
- `rerankerTopN` must be greater than or equal to `contextTopN`; invalid settings must be checked in settings UI and normalized or rejected before runtime use.
- Do not change gold labels or legacy floors to pass the gate.
- Do not promote BM25/RRF into runtime as part of this task.
- Do not change `index.jsonl` schema for this task.
- Runtime p95 latency regression above `+1 sec` requires stop or explicit approval.
- Any external API or model provider must be visible in settings before it is used.

## Autonomy Zones

- Full autonomy (reversible, low risk): intent/spec/plan docs, eval-only harness variants, settings UI draft, focused tests, and repository/wiki documentation.
- Guarded (log + confidence threshold): runtime implementation behind disabled-by-default toggles, timeout/fallback behavior, local reranker adapter shape, and latency measurement.
- Proposal-first (needs approval): enabling any new quality stage by default, selecting a cloud provider/API, or raising latency budget above `+1 sec`.
- No autonomy (human only): changing gold labels or floors, removing fallback behavior, or using paid external API calls without explicit settings and approval.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: reranker, query expansion, answer-grounding, or hygiene stage causes p95 Query latency regression above `+1 sec`.
- Halt if: `Recall@5`, aggregate `MRR`, per-query legacy floors, or citation validity regress.
- Halt if: fallback does not work on model error, timeout, missing model, or unsupported runtime.
- Escalate if: a stage needs a cloud provider, paid API, or default-on runtime behavior to pass.
- Done when: a checked design and implementation plan exist for the staged quality pipeline, the first runtime reranker slice has settings and pipeline behavior behind a toggle, no-regression eval evidence is recorded, and repository docs plus iwiki describe the resulting behavior.
