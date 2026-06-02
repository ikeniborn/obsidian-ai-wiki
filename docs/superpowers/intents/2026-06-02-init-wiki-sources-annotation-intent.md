# Intent: Fix init — missing wiki_sources and redundant annotation in frontmatter

**Date:** 2026-06-02
**Status:** draft

## Objective

Init operation (via ingest passes for subsequent files) creates wiki pages without `wiki_sources`
in frontmatter. Lint's `cleanupInvalidPages` then deletes these pages because `wiki_sources` is
required for validity. In addition, LLM writes `annotation:` directly into wiki page YAML
frontmatter (it should exist only as a separate JSON field stored into `_index.md`).
`validateAndRepairWikiPageFrontmatter` does not strip unknown fields, so `annotation` persists.
Result: wiki built by init is broken after first lint run.

Root causes identified:
1. LLM may write wiki-stem entries into `wiki_sources` → `list-wikilinks-sources-only` repair
   removes them → field deleted → Check B / lint deletes the page.
2. LLM writes `annotation:` key inside page content frontmatter in addition to the separate JSON
   field → annotation leaks into page files → redundant and misleading.

## Desired Outcomes

- Wiki pages created by init survive lint without being deleted.
- `wiki_sources` is present and valid (source-file stems only) in all pages after init.
- `annotation` field is absent from wiki page frontmatter; exists only in `_index.md`.
- `lat check` passes after the fix.

## Health Metrics

- `ingest` Check B (delete pages missing `wiki_sources`) logic unchanged.
- `lint#Cleanup Pass` (`cleanupInvalidPages`) logic unchanged.
- `lint#Backlink Sync` still resolves `wiki_sources` → `wiki_articles` correctly.
- `query` vector search over `_index.md` annotations unaffected.
- All existing tests pass.

## Strategic Context

- Interacts with: `src/phases/init.ts` → `runIngest` → `validateAndRepairWikiPageFrontmatter`
  → `src/phases/lint.ts` → `cleanupInvalidPages` → `upsertIndexAnnotation`.
- Priority trade-off: **trust + speed** — correctness first, minimal latency second.

## Constraints

### Steering (behavioral guidance)

- Prefer code-side fixes over prompt changes where possible.
- Keep schema, prompts, and `cleanupInvalidPages` unchanged unless a specific problem is confirmed
  and the change is agreed upon.
- No speculative changes beyond the identified root causes.

### Hard (architectural enforcement)

- Any change to LLM schema (`WikiPageSchema`, `WikiPagesOutputSchema`), prompts, or
  `cleanupInvalidPages` requires explicit agreement before implementation.
- `wiki_sources` validation rule (`list-wikilinks-sources-only`) must remain intact.

## Autonomy Zones

- **Full autonomy:** Write reproduction tests for both bugs (missing wiki_sources, annotation in frontmatter).
- **Proposal-first:** Strip `annotation` from wiki page frontmatter in `validateAndRepairWikiPageFrontmatter`.
- **Proposal-first:** Modify ingest/lint prompts (remove `annotation` from frontmatter example).
- **Proposal-first:** Change LLM output schema (`WikiPageSchema`, `WikiPagesOutputSchema`).
- **Proposal-first:** Changes to `cleanupInvalidPages`.
- **No autonomy:** Changes to `wiki_sources` validation logic or Check B deletion behavior.

## Stop Rules

- Halt if: any change to `list-wikilinks-sources-only` rule logic is needed — escalate first.
- Escalate if: root cause turns out to be in prompt template rendering (`{{source_stem}}` variable
  not being substituted correctly).
- Done when: pages created by init have valid `wiki_sources`, no `annotation` in frontmatter,
  and survive a full lint run without deletion.
