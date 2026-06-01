# Intent: wiki_outgoing_links / wiki_sources — link separation fix

**Date:** 2026-06-01
**Status:** approved

## Objective

During init/reinit/ingest, wiki page frontmatter fields `wiki_outgoing_links` and `wiki_sources` are incorrectly populated: source file links leak into `wiki_outgoing_links` (which should contain only `!Wiki/` pages), and wiki page links leak into `wiki_sources` (which should contain only source files). Bug discovered in latest testing. Fix requires changes in validator logic and possibly LLM prompt schema.

## Desired Outcomes

- After init/reinit/ingest, every wiki page has:
  - `wiki_outgoing_links` containing only `[[links]]` that resolve to pages inside `!Wiki/`
  - `wiki_sources` containing only `[[links]]` that resolve to source files outside `!Wiki/`
  - Zero cross-contamination between the two fields
- Lint detects and removes invalid entries from both fields (wrong-bucket links)
- All operations (init, reinit, ingest, lint) log field correction events to agent log
- Relevant tests updated and new tests added to cover the separation invariant

## Health Metrics

- All existing tests must remain green
- `lat check` must pass after changes
- `outgoing-desync` detection (body links ≠ `wiki_outgoing_links`) must continue to work
- Backlink Sync in lint (`wiki_articles` in source files) must not be affected
- Every change must be accompanied by an explanation of why it is necessary

## Strategic Context

- Interacts with: `src/wiki-link-validator.ts`, ingest pipeline, lint pipeline, `_wiki_schema.md` prompt template, frontmatter validator
- Priority trade-off: correctness over speed — separation must be enforced both at LLM generation time (prompt) and post-processing time (validator)

## Constraints

### Steering (behavioral guidance)

- Validator must check `!Wiki/` path membership, not just `[[...]]` format validity
- Prompt schema changes must include explicit examples showing which links belong in which field
- Changes to existing tests are allowed when they reflect the corrected expected behavior
- All lint corrections must be logged as agent events

### Hard (architectural enforcement)

- Do not change the LLM schema structure (field names, schema shape) — only add rules/examples within existing fields
- Do not break backward compatibility with existing vault data
- `wiki_sources` field semantics: source files only (outside `!Wiki/`)
- `wiki_outgoing_links` field semantics: wiki pages only (inside `!Wiki/`)

## Autonomy Zones

- Full autonomy (reversible, low risk): updating existing tests, adding new tests, logging agent events
- Guarded (log + confidence threshold): frontmatter validator path-check logic
- Proposal-first (needs approval): new validator rules for path-based membership check, prompt schema changes (`_wiki_schema.md` examples and rules)
- No autonomy (human only): changing field names or schema structure

## Stop Rules

- Halt if: proposed validator change breaks existing `outgoing-desync` or backlink sync behavior
- Escalate if: LLM consistently ignores prompt schema rules after examples are added
- Done when: init/reinit/ingest/lint produce no cross-contamination between `wiki_outgoing_links` and `wiki_sources`; lint actively detects and removes invalid entries; all tests pass; `lat check` passes
