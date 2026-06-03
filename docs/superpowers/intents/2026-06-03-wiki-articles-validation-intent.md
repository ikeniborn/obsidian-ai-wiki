# Intent: wiki_articles validation in source files

**Date:** 2026-06-03
**Status:** draft

## Objective

Source files accumulate invalid entries in `wiki_articles` frontmatter (e.g., plain Russian names like `Иммуномодуляторы`, bare stems like `ИРС-19`). Origin unknown — likely leftover from earlier pipeline versions or manual edits. These must be stripped during lint and ingest. Other frontmatter fields must not be affected.

## Desired Outcomes

- After lint/ingest, `wiki_articles` in source files contains only existing wiki-stems matching `wiki_*` pattern
- Invalid entries (non-`wiki_*` format or not present in vault as `.md` files) are removed
- `wiki_added` and `wiki_updated` may be updated normally
- `wiki_sources` is not present in source files (already enforced separately)
- All other non-`wiki_*` frontmatter fields are untouched

## Health Metrics

- Valid wiki-stems already in `wiki_articles` are never removed
- Backlink Sync continues to correctly append `[[WikiPageName]]` to `wiki_articles`
- All existing lint tests pass without modification

## Strategic Context

- Interacts with: `src/phases/lint.ts` (Backlink Sync, stale cleanup), ingest pipeline (frontmatter fixes)
- Priority trade-off: trust > speed

## Constraints

### Steering (behavioral guidance)

- Delete only invalid entries — do not rewrite the entire list
- Reuse existing `stemToPath` map built during lint from `vaultTools.listFiles("")`
- Validate by both format (`wiki_*` pattern) AND actual file existence in vault

### Hard (architectural enforcement)

- Apply only to source files (outside `!Wiki/`) — never to wiki pages themselves
- Do not modify any frontmatter fields other than `wiki_articles`

## Autonomy Zones

- Full autonomy (reversible, low risk): removing invalid `wiki_articles` entries by format check + vault existence check
- Proposal-first (needs approval): changing the definition of "valid wiki-stem"
- No autonomy (human only): modifying wiki-page logic, touching other frontmatter fields

## Stop Rules

- Halt if: valid wiki-stems are being removed from `wiki_articles`
- Escalate if: vault file lookup causes performance regression on large vaults
- Done when: lint + ingest pass; `wiki_articles` in all source files contains only existing `wiki_*` stems; existing tests green; new tests cover invalid-entry removal
