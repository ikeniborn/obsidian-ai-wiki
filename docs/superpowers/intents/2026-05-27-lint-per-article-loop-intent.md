# Intent: Lint per-article loop with similarity context

**Date:** 2026-05-27
**Status:** draft

## Objective

Lint currently sends all wiki pages of a domain in a single LLM call, causing context overflow on large domains. Rework lint to iterate per article: for each article, select a limited context set (the article itself + top-K similar pages via PageSimilarityService + BFS graph expansion) and send only that set to the LLM for checking.

## Desired Outcomes

- Lint on a domain with 200+ pages completes without context overflow errors
- Each article is checked in context of its related articles (not in isolation)
- UI shows per-article progress during the lint run
- Lint quality does not degrade compared to the current full-batch approach

## Health Metrics

- Backlink sync (`wiki_articles` via `wiki_sources`) works as before
- `actualizeDomainConfig` runs after all articles are processed
- `LintOutputSchema` format is preserved (results merged from N calls)
- Embedding cache (`refreshCache`) logic is unchanged

## Strategic Context

- Interacts with: `src/phases/lint.ts`, `PageSimilarityService`, `AgentRunner`, `wiki-graph` (BFS), `LlmClient`, `actualizeDomainConfig`, backlink sync
- Priority trade-off: trust (quality of checking per article takes precedence over speed or cost)
- N LLM calls (one per article) is acceptable

## Constraints

### Steering (behavioral guidance)

- Article iteration source: `_index.md` as semantic seed list + `listFiles` for completeness check
- Context per article: `relevantPagesTopK` (existing config param, no new param needed)
- Results: stream fixes per article as they are ready, merge into single `LintOutputSchema` at the end
- Do not change `PageSimilarityService` API or `AgentRunner` external contract

### Hard (architectural enforcement)

- `LintOutputSchema` format must not change (consumers depend on it)
- `relevantPagesTopK` reused as-is — no new config parameters introduced

## Autonomy Zones

- Full autonomy (all decisions): refactoring `src/phases/lint.ts`, loop logic, progress events, result merging, backlink sync ordering, BFS integration, any internal implementation detail

## Stop Rules

- Halt if: LLM call for a single article still overflows context (article itself exceeds token limit — escalate as separate issue)
- Escalate if: `LintOutputSchema` merge produces duplicate or conflicting fixes for the same page
- Done when: lint completes without error on a 200+ page domain, per-article progress is visible in UI, backlink sync and `actualizeDomainConfig` still run correctly, existing tests pass
