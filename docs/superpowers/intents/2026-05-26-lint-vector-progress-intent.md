# Intent: Lint vector read/write progress events

**Date:** 2026-05-26
**Status:** draft

## Objective

Lint uses the same `PageSimilarityService` as ingest (reads cache, calls `refreshCache`) but emits no progress events for vector operations. User cannot tell whether vectors were read or written during lint.

## Desired Outcomes

- When embedding mode is active, lint progress shows a "reading vectors" event before similarity scoring
- When embedding mode is active, lint progress shows a "writing vectors (N pages)" event after `refreshCache`
- Events are suppressed when embedding mode is disabled (jaccard mode or similarity disabled)

## Health Metrics

- Lint correctness unchanged: page analysis, fix application, `actualizeDomainConfig` all work as before
- Vector cache is consistent after lint (same guarantee as ingest)
- No new events emitted when embedding mode is not active

## Strategic Context

- Interacts with: `PageSimilarityService` (shared with ingest), sidebar progress component, `RunEvent` stream
- Priority trade-off: trust (verifiability of vector ops) over speed

## Constraints

### Steering (behavioral guidance)

- Do not change lint logic — only add progress event emissions around existing vector calls
- Events must be conditional on embedding mode being active
- Use same event kinds/format already used in ingest for consistency

### Hard (architectural enforcement)

- No new summary line in lint result — only progress events
- Do not duplicate vector logic — reuse `PageSimilarityService` as-is

## Autonomy Zones

- Full autonomy (reversible, low risk): reading code, identifying event emission points
- Proposal-first (needs approval): show diff/preview before committing

## Stop Rules

- Halt if: `PageSimilarityService` does not emit any observable hook point for read/write
- Escalate if: lint does not call `refreshCache` at all (need to confirm and possibly add the call)
- Done when: preview shown and approved, then committed
