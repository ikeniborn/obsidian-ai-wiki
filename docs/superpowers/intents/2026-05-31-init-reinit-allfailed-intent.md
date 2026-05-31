# Intent: Fix init/reinit allFailed false-positive on empty wiki

**Date:** 2026-05-31
**Status:** approved

## Objective

`init` and `reinit --force` fail with `ingest: per-entity retrieval failed for all entities` when the wiki is empty. `allFailed` fires because `indexAnnotations.size === 0` on an empty wiki, not because retrieval actually broke. Ingest is the core page-creation engine — it must proceed even when there are no existing pages to retrieve against.

## Desired Outcomes

- `init` on a fresh domain completes without `allFailed` error; wiki pages are created from scratch
- `reinit --force` after wipe completes without error; pages are recreated
- `ingest` on empty wiki proceeds to LLM write phase; creates all entities as new pages
- `allFailed` halt still fires when wiki is non-empty and retrieval fails for all pages (real API failure)
- `entity_types_delta` merge in controller continues to work as before

## Health Metrics

- `allFailed` as a real error (embedding API down on non-empty wiki) must not be silenced
- `entity_types_delta` domain update path must remain intact
- Existing `allFailed` halt test must be updated (not deleted) to reflect new guard condition

## Strategic Context

- Interacts with: `src/phases/ingest.ts`, `src/page-similarity.ts`, `src/phases/init.ts`, `AgentRunner`, test suite
- Priority trade-off: correctness (trust) > speed > cost

## Constraints

### Steering (behavioral guidance)

- Minimal change — touch only the two guard sites, no refactor of surrounding logic
- Test update must reflect new semantics, not just make the test pass

### Hard (architectural enforcement)

- Fix both sites: `ingest.ts:151` AND `page-similarity.ts` `allFailed` semantics
- Do not change `entity_types_delta` flow

## Autonomy Zones

- Full autonomy: code edits to both files, test updates
- Proposal-first: any change to `allFailed` semantics beyond the two guard sites

## Stop Rules

- Halt if: `allFailed` guard change silences real embedding-API failures on non-empty wikis
- Done when: init/reinit pass without error on empty wiki; `lat check` passes; updated `allFailed` test passes
