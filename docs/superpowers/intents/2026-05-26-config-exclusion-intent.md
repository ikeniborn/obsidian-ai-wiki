# Intent: Exclude _config from lint/query/similarity operations

**Date:** 2026-05-26
**Status:** draft

## Objective

`_config/` directories contain technical files, not user content. Two levels:
- `!Wiki/_config/` — global: logs, schemas (written by system)
- `!Wiki/<domain>/_config/` — per-domain: `_index.md`, `_log.md`, embeddings (written by ingest/lint)

Currently lint and query pick up these files and incorrectly modify them. They must be excluded from all user-content operations.

## Desired Outcomes

- Lint skips all files inside any `_config/` directory
- Query does not include `_config/` files in LLM context
- PageSimilarityService does not index `_config/` files
- format never uses PageSimilarityService (it operates on source, not wiki pages)

## Health Metrics

- ingest and lint still write to domain `_config/` (`_index.md`, `_log.md`, embeddings) — write path unchanged
- system still writes to global `_config/` (logs, schemas) — write path unchanged
- format does not touch `_config/` — unchanged
- All existing lint/query tests pass

## Strategic Context

- Interacts with: `wiki-path.ts`, `PageSimilarityService`, lint phase, query phase, ingest phase
- Filter lives in one place: `wiki-path.ts` (single source of truth for path logic)
- format is never wired to `AgentRunner.buildSimilarity()` — it operates on source files only
- Priority trade-off: trust — correctness over speed, no accidental mutations of technical files

## Constraints

### Steering (behavioral guidance)

- Filter implemented as a utility in `wiki-path.ts` (e.g. `isConfigPath(path)`)
- All callers (lint, query, similarity builder) use this utility — no inline path checks scattered across modules

### Hard (architectural enforcement)

- format phase must not use `PageSimilarityService` — remove if currently wired
- `_config/` write paths (ingest annotations, log writes) must remain untouched

## Autonomy Zones

- Full autonomy (reversible, low risk): where exactly in `wiki-path.ts` to add the filter function
- Full autonomy: updating callers in lint, query, similarity to use the filter
- Full autonomy: removing similarity from format phase if currently wired

## Stop Rules

- Halt if: removing similarity from format breaks ingest or lint behavior
- Halt if: `_config/` write paths (index, log, embeddings) stop working
- Done when: all tests pass and `lat check` reports no errors
