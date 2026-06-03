---
chain:
  intent: docs/superpowers/intents/2026-06-03-lint-wiki-sources-guard-intent.md
review:
  spec_hash: 121a54c822b0a27d
  last_run: 2026-06-03
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "### 3. Post-loop empty-sources deletion"
      section_hash: d7a6e9d2a6b1b7b8
      text: "Insertion point was ambiguous — clarified to 'after line 385, before line 392-407 backlink rewrite'"
      verdict: fixed
      verdict_at: 2026-06-03
    - id: F-002
      phase: clarity
      severity: INFO
      section: "### 4. Tests"
      section_hash: 5a2d2192312c46b8
      text: "Test #5 expected outcome now specifies which pass (deletedRefs rewrite, line 392-407) removes wiki_articles"
      verdict: fixed
      verdict_at: 2026-06-03
---
# Design: lint wiki_sources guard

**Date:** 2026-06-03
**Status:** approved
**Intent:** `docs/superpowers/intents/2026-06-03-lint-wiki-sources-guard-intent.md`

## Problem

`validateWikiSources` only sees the LLM-fixed content. When the LLM returns `wiki_sources: []`
(inline YAML) or a reduced list, `parseWikiSourcesFromFm` returns `[]` (its regex requires
block-list format), so the guard returns content unchanged — silently losing valid source links.

Secondary gap: `cleanupInvalidPages` checks only for the *presence* of the `wiki_sources:` key,
not for valid entries. A wiki page whose all sources are stale persists indefinitely with an
empty `wiki_sources` field; its `wiki_articles` backlinks in source files are never removed.

## Changes

### 1. `validateWikiSources` — new `originalContent` parameter

```ts
export function validateWikiSources(
  content: string,
  originalContent: string,
  knownStems: Set<string>,
  titleMap: Map<string, string>,
): string
```

**Algorithm:**

1. Parse `originalEntries = parseWikiSourcesFromFm(originalContent)`.
2. Parse `llmEntries = parseWikiSourcesFromFm(content)`.
3. `validOriginal` = originalEntries where `isValid(e)` (stem in knownStems or titleMap).
4. `missingValid` = validOriginal − llmEntries (exact string set-difference).
5. **Restore:** if `missingValid` non-empty, insert them as block-list items under `wiki_sources:`.
   - If content has `wiki_sources: []` (inline), replace it with a proper block list.
   - If content has block-list format, append missing items.
6. **Remove stale:** entries in the result that are `[[...]]` format but not in knownStems/titleMap are removed via raw string substitution (existing logic).

**Invariant:** a valid entry (stem exists in vault) is never removed from `wiki_sources`.

### 2. Call site in `runLint`

```ts
// src/phases/lint.ts ~line 324
const rawFixed = wlFixResult.fixed.get(fix.path) ?? fix.content;
const originalContent = pages.get(fix.path) ?? "";
const fixedContent = validateWikiSources(rawFixed, originalContent, knownStems, titleMap);
```

`pages` is populated before the per-article loop — original content always available.
If `fix.path` absent from `pages` (not possible in practice), `originalContent = ""` →
`validOriginal = []` → no restore → existing stale-removal behaviour preserved.

### 3. Post-loop empty-sources deletion

**Insertion point:** immediately after the per-article loop (after line 385 `// ── End per-article loop ──`)
and **before** the source-file backlink rewrite at line 392-407. This ensures the new entries
pushed into `deletedRefs` are included in that rewrite pass.

```
for each path in writtenPaths:
  content = pages.get(path)
  if parseWikiSourcesFromFm(content).length === 0:
    delete file, pages.delete(path)
    push { deletedName: stem, redirectName: null } into deletedRefs
    emit info_text warning
```

This reuses the existing machinery:
- `deletedRefs` is consumed by the source-file backlink rewrite (line 392-407), which removes
  `[[deletedName]]` references (including `wiki_articles` entries) from all source files via
  raw string replace.
- The stale-link cleanup pass (line 447-471) additionally covers any residual `wiki_articles`
  references via `filterStaleWikiLinks`.

No new deletion infrastructure needed.

### 4. Tests

New cases in `describe("validateWikiSources")`:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | LLM returned `wiki_sources: []`, original had valid entry | Entry restored in block-list format |
| 2 | LLM reduced list (dropped one of two valid entries) | Missing entry restored |
| 3 | LLM dropped stale entry (stem absent from knownStems) | Not restored |
| 4 | `originalContent` is `""` | No restore; stale removal only |

Existing 4 tests pass without modification — `originalContent` passed as `""` or matching `content`.

New integration test for post-loop deletion:

| # | Scenario | Expected |
|---|----------|----------|
| 5 | Wiki page whose only source stem is deleted from vault | Page deleted; source file's `wiki_articles` entry `[[wikiStem]]` removed by the `deletedRefs` backlink rewrite pass (line 392-407) |

### 5. `lat.md` updates

Update `lat.md/tests.md` under `validateWikiSources` section with new test cases.
Add a note in `lat.md/operations.md` under the Lint section about the post-loop empty-sources
deletion step.

## Constraints honoured

- No YAML parser used for `wiki_sources` (block-list format manipulated via raw string ops).
- No changes to Zod schemas or LLM prompts.
- `validateWikiSources` signature change is the only public API change; call site updated accordingly.
- No vault data recovery for already-damaged pages.

## Out of scope

- Recovering already-broken pages in the vault.
- Changes to `cleanupInvalidPages` (it runs pre-loop; empty-sources check is post-loop concern).
