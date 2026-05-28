# Intent: Query Article Selection Pipeline

**Date:** 2026-05-28
**Status:** draft

## Objective

Query phase sends ALL similarity-matched articles to LLM (e.g. 22 of 33) without applying `relevantPagesTopK` limit. Sidebar displays intermediate count but LLM receives unfiltered set — high token cost, low convergence quality. Fix now because it degrades every query operation and inflates cost on large wikis.

## Desired Outcomes

- Sidebar displays the final article set — exactly what is sent to LLM (after topK + BFS expansion)
- Sidebar may show filtering steps (raw similarity count → topK seeds → BFS-expanded final count)
- LLM receives ≤ topK + BFS-expanded pages, respecting `relevantPagesTopK` and `graphDepth` from plugin settings
- Processing speed improves; token cost drops proportionally to filtered-out pages
- Response quality does not degrade vs current (trimmed context is more relevant)

## Health Metrics

- Lint per-article loop: correct context selection unchanged
- Query via chat: results quality does not degrade
- Embedding cache (`_embeddings.json`): not invalidated except on annotation content change
- Jaccard mode (no API): works through new pipeline identically to embedding mode

## Strategic Context

- Interacts with: `PageSimilarityService`, `AgentRunner`, `src/phases/query.ts`, sidebar view (`WikiController`), `_index.md` annotations, `_embeddings.json` cache
- Priority trade-off: quality > speed > cost

## Constraints

### Steering (behavioral guidance)

- `relevantPagesTopK` and `graphDepth` are the only config knobs — no new settings fields
- Sidebar must reflect final LLM context (post-topK + post-BFS), not raw similarity results
- Filtering steps may be surfaced in sidebar for transparency (raw → seeds → final)

### Hard (architectural enforcement)

- `PageSimilarityService` interface may be changed if it improves correctness
- Must not bypass embedding cache — `loadCache()` called before `selectRelevant()`
- Jaccard fallback path must follow the same topK → BFS pipeline as embedding mode
- Lint and ingest phases must not be affected by query-pipeline changes

## Autonomy Zones

- **Full autonomy** (reversible, low risk): fix topK enforcement in query phase, update sidebar display to show final filtered list
- **Proposal-first** (needs approval): changes to `PageSimilarityService` public interface, new fields in `LocalConfig` types
- **No autonomy** (human only): changes to lint per-article loop logic, embedding cache invalidation strategy

## Stop Rules

- Halt if: lint or query tests fail after changes
- Halt if: `relevantPagesTopK` = 0 or undefined causes panic/empty context
- Escalate if: sidebar and LLM context count still diverge after fix
- Done when: sidebar article count = LLM context article count ≤ topK + BFS-expanded pages; lint and query operate correctly; `lat check` passes
