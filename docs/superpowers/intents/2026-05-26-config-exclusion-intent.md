# Intent: Exclude _config from lint/query/similarity operations

**Date:** 2026-05-26
**Status:** draft

## Objective

`_config/` directories contain technical files, not user content. Two levels:
- `!Wiki/_config/` — global: logs, schemas (written by system)
- `!Wiki/<domain>/_config/` — per-domain: `_index.md`, `_log.md`, embeddings (written by ingest/lint)

Currently lint and query pick up these files and incorrectly modify them. They must be excluded from all user-content operations.

## Desired Outcomes

- **Core invariant:** no file inside `_config/` is ever treated as a wiki article (by any operation at any level)
- Lint does not process `_config/` files as wiki pages — it may still read/write technical files there (vectors, log, index)
- Query does not include `_config/` files in LLM context and does not pass them to similarity search
- PageSimilarityService never indexes `_config/` files as candidate wiki pages
- format never uses PageSimilarityService (it operates on source, not wiki pages)

## Health Metrics

- lint still reads/writes domain `_config/` for technical purposes (vectors, `_log.md`, `_index.md`) — unchanged
- query reads similarity index from `_config/` but never writes — unchanged
- system still writes to global `_config/` (logs, schemas) — unchanged
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
