# Intent: Source wiki_articles stale link cleanup

**Date:** 2026-06-01
**Status:** approved

## Objective

After init or reinit, `wiki_articles` in source frontmatter accumulates dead links — references to wiki pages that no longer exist. The validation currently checks only wikilink format (`[[...]]`), not page existence. Dead links pile up silently with each ingest cycle.

## Desired Outcomes

- After ingest completes, `wiki_articles` in source frontmatter contains no links pointing to non-existent wiki pages.

## Health Metrics

- Existing `Frontmatter Validation` tests remain green.
- Existing `Backlinks drop deleted stems` test remains green.
- No regression in ingest init/reinit flow.

## Strategic Context

- Interacts with: `validateAndRepairSourceFrontmatter`, ingest init/reinit phase, `format` and `lint` operations.
- Cleanup runs in the **ingest-phase after wiki pages are written** — at that point the final set of existing pages is known.
- Function must be **reusable**: accept the list of existing wiki page stems as a parameter so `format` and `lint` can call it without coupling to ingest internals.
- Priority trade-off: **correctness** — never leave dead links, even at the cost of an extra vault read.

## Constraints

### Steering (behavioral guidance)

- Keep `raw-frontmatter.ts` a pure utility — do not add vault I/O there.
- Stale-link removal belongs to the ingest layer (or any caller that can supply the page list).
- Reuse the existing `validateAndRepairFrontmatter` / `FieldRule` infrastructure where possible.

### Hard (architectural enforcement)

- None beyond the above.

## Autonomy Zones

- Full autonomy (reversible, low risk): implementation, tests, lat.md updates.
- Proposal-first (needs approval): changes to public API surface of `validateAndRepairSourceFrontmatter` if signature changes affect callers.
- No autonomy (human only): none.

## Stop Rules

- Halt if: existing tests go red and root cause is unclear.
- Escalate if: implementing reusability for `format`/`lint` requires architectural changes beyond adding a parameter.
- Done when: all tests green, `lat check` passes, `wiki_articles` stale links are removed during ingest init/reinit.
