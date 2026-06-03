# Intent: lint wiki_sources guard

**Date:** 2026-06-03
**Status:** draft

## Objective

During lint, the LLM sometimes returns `wiki_sources: []` (inline YAML) instead of the list format, or strips individual entries. `validateWikiSources` only parses list-format entries via regex — it returns the content unchanged when it sees `[]`, silently allowing source link loss. Fix the guard so no valid source link is ever removed while the source file exists in the vault.

## Desired Outcomes

- After lint, a wiki page's `wiki_sources` never loses a `[[stem]]` entry when that source file exists anywhere in the vault outside the wiki folder.
- LLM-emitted `wiki_sources: []` or reduced-list is silently corrected — valid entries are restored before the vault write.
- Source entries pointing to non-existent files are still allowed to be removed (stale link cleanup remains correct).

## Health Metrics

- All existing `validateWikiSources` tests pass unchanged.
- `cleanupInvalidPages` does not delete pages due to missing `wiki_sources` (field must stay in list format, not `[]`).
- Backlink sync (lint → `wiki_articles` in source files) continues to work correctly.
- `lat check` passes after changes.

## Strategic Context

- Interacts with: `src/phases/lint.ts#runLint` (sole call site), `src/phases/lint.ts#validateWikiSources`, `src/utils/raw-frontmatter.ts#parseWikiSourcesFromFm`
- Priority trade-off: trust (data correctness) > speed > cost

## Constraints

### Steering (behavioral guidance)

- `wiki_sources` entries use only bare stem format: `[[filename]]` — no paths, no aliases.
- Do not use a YAML parser for `wiki_sources` (YAML treats `[[...]]` as a flow sequence — existing comment in code explains this).
- Restore entries from the **original** page content, not from the LLM output.

### Hard (architectural enforcement)

- Changing `validateWikiSources` signature is allowed.
- Do not change Zod schemas or LLM prompts without proposal-first review.
- Do not attempt to recover already-broken pages in the vault (scope: prevent future corruption only).

## Autonomy Zones

- Full autonomy (reversible, low risk): modify `validateWikiSources` logic and signature, update call site in `runLint`, add/update tests, update `lat.md/`.
- Proposal-first (needs approval): changes to `LintOutputSchema`, `prompts/lint.md`, or any other phase files.
- No autonomy (human only): vault data recovery of already-damaged pages.

## Stop Rules

- Halt if: existing tests fail after changes.
- Halt if: `lat check` fails.
- Done when: `validateWikiSources` correctly restores valid `wiki_sources` entries regardless of whether LLM returned `[]`, an empty list, or a partial list — and new tests cover these cases.
