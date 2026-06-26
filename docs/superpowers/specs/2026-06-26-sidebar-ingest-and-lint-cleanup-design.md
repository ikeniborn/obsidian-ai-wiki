---
review:
  spec_hash: 13c8a1b679a0f267
  last_run: 2026-06-26
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "R1 — src/view.ts, updateButtonAvailability()"
      section_hash: 3a2c45170bb84679
      fragment: "updateButtonAvailability() (~line 404)"
      text: "Concrete source line numbers (~line 404, ~line 801) drift across edits and are not stable anchors."
      fix: "Reference symbols (updateButtonAvailability, LintOptionsModal constructor) and mark line numbers approximate."
      verdict: open
      verdict_at: null
chain:
  intent: null
---

# Sidebar Ingest Gating & Lint Empty-Type Cleanup — Design

**Date:** 2026-06-26
**Status:** Approved (design)

## Problem

Two sidebar/lint defects:

1. **Ingest button** is enabled for any active file while a domain is selected, including
   files that already live inside the wiki tree (`!Wiki/...`). Ingesting a wiki article back
   into the wiki is nonsensical and should be blocked at the UI level.

2. **Lint Options modal** and the lint run mishandle *empty entity types* (entity types whose
   wiki subfolder contains zero article files):
   - On open, empty types (count `0`) have their toggle ON by default.
   - After a lint run, empty types are never removed, so they keep reappearing in the modal on
     the next run with `(0)` counts.

## Definitions

- **Article count of an entity type** = number of `.md` files under
  `!Wiki/<wiki_folder>/<wiki_subfolder>/` (matches the existing count in `view.ts`). Meta files
  (`_index.md`, `_log.md`) live under `_config/` and are not counted.
- **Empty entity type** = an entity type whose article count is `0`. A type with no
  `wiki_subfolder` configured also counts as empty.

## Requirements

### R1 — Ingest button gating
The Ingest button MUST be disabled when the active file is inside the wiki tree
(`isWikiArticlePath(activeFile.path)` is true). Existing conditions are unchanged: it is also
disabled when no domain is selected. Behavior with no active file is unchanged (the button stays
enabled and the click handler shows the existing "no active file" notice).

### R2a — Modal default toggles
When the Lint Options modal opens, an entity type with article count `0` MUST have its toggle
OFF. Types with count `> 0` stay ON (current behavior). The "Add all" / "Remove all" buttons are
unchanged: "Add all" selects every type, "Remove all" clears every type.

### R2b — Empty-type cleanup after lint
After a lint run completes, for every entity type with article count `0` (always, regardless of
the `useLlm` flag and regardless of the modal's type filter):
- delete its wiki subfolder directory if it exists, and
- remove the entity type from the domain config (`domain.entity_types`).

This MUST run *always when the count is 0* — including on a freshly created domain that has not
been ingested yet (accepted trade-off: lint on an un-ingested domain strips all its types).

Effect: on the next lint, the removed types no longer appear in the modal, and remaining counts
reflect only real files.

## Approach

Three placement options were considered for R2b:

- **A. Deterministic post-step inside `runLint` (lint.ts)** — chosen. Sits next to the existing
  deterministic cleanups (`cleanupInvalidPages`, empty-sources deletion, index reconcile), has
  `vaultTools` + the live `pages` map, and reuses the `domain_updated` event pipeline that the
  controller already persists. Works for the UI, agent, and CLI paths.
- B. In the controller after `dispatch("lint")` — rejected: duplicates path logic, does not run
  in the agent-runner context, extra plumbing.
- C. In the view/modal — rejected: the UI must not mutate the vault or config.

## Implementation

### R1 — `src/view.ts`, `updateButtonAvailability()` (~line 404)
```ts
const onWikiArticle = !!activeFile && isWikiArticlePath(activeFile.path);
// ...
if (this.ingestBtn) this.ingestBtn.disabled = !hasDomain || onWikiArticle;
```
`isWikiArticlePath` is already imported. This is symmetric with the existing `canFormat`
computation, which already excludes `!Wiki` paths.

### R2a — `src/modals.ts`, `LintOptionsModal` constructor (~line 801)
```ts
this.entityTypeFilter = (domain.entity_types ?? [])
  .filter(e => (this.articleCounts.get(e.type) ?? 0) > 0)
  .map(e => e.type);
```
`articleCounts` is already passed into the constructor. The per-type toggle already calls
`setValue(this.entityTypeFilter.includes(et.type))`, so empty types render OFF without further
changes. The "Add all" button still sets the filter to all types.

### R2b — `src/phases/lint.ts`, new deterministic step in `runLint`
Add a step that runs **always** (both `useLlm` modes), after the `if (useLlm)` block (so it sees
the post-actualize entity types) and after all article deletions have settled.

1. Base type list = `patch?.entity_types ?? domain.entity_types ?? []` — capture the
   actualize patch result (when `useLlm`) so we strip from the latest list. Lift a
   `let baseEntityTypes` variable; inside the `useLlm` block set it from `patch.entity_types`
   when present.
2. For each type, compute `count` = number of keys in the live `pages` map whose path starts with
   `${wikiVaultPath}/${et.wiki_subfolder}/`. No `wiki_subfolder` → count `0`.
3. Partition into `survivors` (count > 0) and `removed` (count === 0).
4. For each `removed` type with a `wiki_subfolder`, delete the folder via
   `vaultTools.rmdir(`${wikiVaultPath}/${et.wiki_subfolder}`, true)` (best-effort; ignore errors
   if the folder is missing).
5. If `removed.length > 0`:
   - `yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: survivors } }`
     — the controller persists it (`controller.ts:776-780`), and the view refreshes domains
     (`view.ts:718`).
   - push a report line: `Removed empty entity types: <comma-separated type names>`.

The existing actualize `domain_updated` emit is kept; this strip emit is applied afterward, and
the patch merge (`{ ...prev, ...patch }`, `domain.ts:95`) means the later strip wins while
`language_notes` from actualize is preserved.

Counting from the live `pages` map is accurate because `pages` already excludes meta files and
reflects every deletion made during the run; lint never creates new article files.

### Supporting change — `src/vault-tools.ts`
Add a thin wrapper to remove a specific folder (the adapter already exposes `rmdir`; only
`remove` (files) and `removeSubfolders` (children) are wrapped today):
```ts
async rmdir(vaultPath: string, recursive: boolean): Promise<void> {
  await this.adapter.rmdir?.(vaultPath, recursive);
}
```

## Scope boundaries (not changing)

- Per-file "empty article" semantics: emptiness is defined at the **type** level (0 files in the
  folder), per the clarified requirement. Existing per-page cleanups
  (`cleanupInvalidPages`, empty-`wiki_sources` deletion) are unchanged.
- The per-article LLM loop and the `entityTypeFilter` behavior: the filter still only scopes the
  LLM pass. Empty-type cleanup is independent of the filter — an unselected empty type is still
  removed.
- No-active-file Ingest behavior is unchanged.

## Verification

- **R1:** Build and load in Obsidian. Open a `!Wiki/...` article → Ingest disabled. Open a source
  file with a domain selected → Ingest enabled. Deselect domain → Ingest disabled.
- **R2a:** Domain with a type that has `0` files → open Lint modal → that type's toggle is OFF;
  non-empty types ON.
- **R2b:** Domain with at least one empty type → run lint → the subfolder is deleted, the type is
  gone from the domain config, and reopening the Lint modal no longer lists it. Non-empty types
  and their counts are intact.
- **Gates:** `npx tsc --noEmit` (real type check), eslint, esbuild build.
