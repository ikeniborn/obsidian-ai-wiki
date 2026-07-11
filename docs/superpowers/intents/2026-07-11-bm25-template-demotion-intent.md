---
review:
  intent_hash: 280fb65cf933ca3c
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: BM25 and controlled template demotion

**Date:** 2026-07-11
**Status:** approved

## Objective

Check BM25 more deeply and add controlled demotion for boilerplate/template pages so retrieval can improve semantic gold quality without hiding legacy-overlap regressions.

The previous gold BM25 eval harness showed that `weighted-lexical` still beats raw BM25/RRF variants on aggregate gold metrics. It also exposed the main quality gap: legacy overlap sometimes rewards `template-*` and `template-readme` pages that the conservative gold set intentionally does not treat as relevant.

This step should evaluate whether BM25 can help after controlled boilerplate demotion and whether any demotion value is stable enough to promote beyond eval.

## Desired Outcomes

- Live HLD eval shows gold quality improvement over current `weighted-lexical`: `nDCG@5 > 0.91` or `Recall@5 > 0.76`.
- Average improved `Overlap@5` remains at least `0.65`.
- No query drops below its current legacy-overlap floor.
- `MRR` remains at least `0.90`.
- Top-1 result is never `template-*` or `template-readme`.
- The report explains where BM25 helps, where BM25 hurts, and where controlled demotion changes ranking.
- Runtime Query behavior does not change until eval confirms a safe effective value.

## Health Metrics

- Per-query legacy floors from the current harness do not regress.
- Average improved `Overlap@5 >= 0.65`.
- Aggregate `MRR >= 0.90`.
- No top-1 boilerplate/template result.
- Runtime Query behavior remains unchanged.
- Eval remains deterministic and offline.

## Strategic Context

- Interacts with:
  - `scripts/eval-jsonl-domain-storage.ts` for HLD eval orchestration and reports.
  - `src/bm25.ts` for BM25 scoring.
  - `src/lexical-retrieval.ts` for the weighted lexical baseline.
  - `docs/superpowers/evals/hld-gold-set.json` and generated HLD eval reports.
  - Plugin settings only if the eval proves a stable effective demotion value.
- Priority trade-off: trust > speed > cost.

## Constraints

### Steering (behavioral guidance)

- Treat semantic gold metrics as the optimization target and legacy overlap as a no-regression guard.
- Evaluate BM25 with and without controlled demotion, not BM25 alone.
- Prefer simple, explainable demotion rules that can be reported per query.
- Consider adding a plugin setting only after the harness identifies a stable effective value.
- If a setting is added, place it in advanced/experimental settings, use the verified default, and describe its purpose and risk.

### Hard (architectural enforcement)

- Do not change runtime Query behavior until eval confirms the benefit.
- Do not lower average `Overlap@5` below `0.65`.
- Do not lower any per-query legacy floor.
- Do not accept a variant with aggregate `MRR < 0.90`.
- Do not accept a variant whose top-1 result is `template-*` or `template-readme`.
- Do not add a plugin setting if the harness does not show a stable effective value.
- Do not change gold labels to make the scorer pass.
- Do not weaken legacy floors without a separate explicit decision.
- Do not promote BM25 or demotion to runtime Query while eval verdict is `needs_tuning`.

## Autonomy Zones

- Full autonomy (reversible, low risk): eval-only scorer variants, deterministic tests, report fields, docs/wiki updates.
- Guarded (log + confidence threshold): controlled demotion formula and thresholds, BM25 weighting experiments, if all guard metrics stay within limits.
- Proposal-first (needs approval): adding plugin settings UI/runtime behavior after eval confirms a stable effective value.
- No autonomy (human only): changing gold labels for metric improvement, weakening legacy floors, or promoting a `needs_tuning` variant to runtime Query.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions is
> marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: demotion improves one metric but violates a per-query legacy floor.
- Halt if: aggregate `MRR < 0.90`.
- Halt if: top-1 result becomes `template-*` or `template-readme`.
- Escalate if: the best variant requires lowering floors or changing gold labels.
- Escalate if: adding a plugin setting becomes necessary but the effective value is not stable across queries.
- Done when: live HLD eval shows gold improvement over current `weighted-lexical` (`nDCG@5 > 0.91` or `Recall@5 > 0.76`), average `Overlap@5 >= 0.65`, aggregate `MRR >= 0.90`, no top-1 boilerplate/template result, no per-query floor regression, and the report explains BM25 plus demotion deltas.
