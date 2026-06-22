---
review:
  spec_hash: 2cc29f507da2037c
  last_run: 2026-06-22
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings: []
chain:
  intent: null
---
# Format button activation decoupled from domain membership

**Date:** 2026-06-22
**Branch:** `dev/format-button-domain`
**Status:** Design approved, pending implementation plan

## Problem

In the AI Wiki side view, the **Format** button is greyed out whenever the
active markdown file is not a registered source of the selected domain. This is
wrong: `controller.format()` happily formats any markdown file that is not a
wiki article — it does not require the file to be in `domain.source_paths`. The
button's disabled predicate is stricter than the action it triggers, so a valid
source page that has not been added to the domain cannot be formatted.

Root cause — `src/view.ts` `updateButtonAvailability()`:

```typescript
const isSource = !!activeFile && !!domain && isSourceFile(activeFile.path, domain);
if (this.formatBtn) this.formatBtn.disabled = !isSource;   // BUG
if (this.deleteBtn) this.deleteBtn.disabled = !isSource;   // correct
```

`isSourceFile` (`src/source-deletion.ts`) returns `true` only when the path is a
member of `domain.source_paths`. The **Delete source** button is correctly
gated this way — you can only delete a source that is actually tracked. The
**Format** button must not be.

## Desired behavior

- **Format button** is active for any active markdown file that is *not* a wiki
  article, independent of domain or wiki membership. Disabled only when there is
  no active file, the file is not `.md`, or the file lives inside the wiki tree.
- **Delete source button** stays gated on `isSource` — active only when the
  active file is a tracked source of the selected domain. No change.

The controller remains the final gate: clicking Format on a wiki article shows
the existing "action forbidden" `InfoModal`; clicking on a non-markdown file
shows the existing `Notice`. The button predicate is a usability hint, not the
enforcement boundary.

## Key fact

Every domain's wiki content lives under the single `WIKI_ROOT` prefix
(`!Wiki`), because `domainWikiFolder(subfolder)` returns `` `${WIKI_ROOT}/${subfolder}` ``.
Therefore "is this path a wiki article" reduces to a domain-independent prefix
check — exactly the guard `isSourceFile` already performs inline. This is why
approach C (mirroring `controller.format()`'s per-domain scan) was rejected: it
is strictly more complex and produces an identical result.

## Changes

### 1. New pure predicate — `src/wiki-path.ts`

```typescript
/** True if `path` is inside the wiki tree (every domain's wiki lives under WIKI_ROOT). */
export function isWikiArticlePath(path: string): boolean {
  return path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`);
}
```

### 2. Reuse in `src/source-deletion.ts`

`isSourceFile` replaces its inline wiki guard with the shared helper, removing
the duplicated prefix logic:

```typescript
if (isWikiArticlePath(path)) return false;
```

Behavior is unchanged — this is a de-duplication, not a logic change.

### 3. Decouple the format predicate — `src/view.ts`

`updateButtonAvailability()` computes a dedicated `canFormat` for the format
button while leaving the delete button on `isSource`:

```typescript
const activeFile = this.plugin.app.workspace.getActiveFile();
const canFormat = !!activeFile && activeFile.extension === "md"
  && !isWikiArticlePath(activeFile.path);
// ...
if (this.formatBtn) this.formatBtn.disabled = !canFormat;   // was !isSource
if (this.deleteBtn) this.deleteBtn.disabled = !isSource;     // unchanged
```

## Data flow

`workspace.on("file-open")` and the domain `<select>` change handler both call
`updateButtonAvailability()`. The recomputed `canFormat` depends only on the
active file (no domain needed); `isSource` still depends on the selected domain.
No new events or state.

## Edge cases

| Active file | Format button |
|---|---|
| none | disabled |
| non-`.md` | disabled |
| under `!Wiki/...` (any domain or `_config`) | disabled |
| `!Wiki` exactly | disabled |
| source page in `domain.source_paths` | **enabled** |
| source page *not* in `domain.source_paths` | **enabled** (the fix) |
| any other `.md` outside the wiki | **enabled** |

## Testing

Out-of-vault headless eval at `eval/format-button/run.ts`, following the
`eval/rerun-domain/` template: import the real `isWikiArticlePath` from
`src/wiki-path.ts`, run `check()` assertions, build with esbuild to `run.cjs`,
run with node, exit 1 on any failure.

Cases:

- `!Wiki` → `true`
- `!Wiki/Alpha/Page.md` → `true`
- `!Wiki/_config/_index.md` → `true`
- `Sources/doc.md` → `false`
- `notes/x.md` → `false`
- `!WikiOther/z.md` → `false` (prefix without the `/` boundary must not match)

## Out of scope

- Rendering the Format button when no domain is selected (separate concern; the
  button currently lives in the domain box).
- Mobile vs desktop divergence — both layouts share
  `updateButtonAvailability()`, so the single-line change covers both.
- Any change to `controller.format()` enforcement.

## Post-task checklist

- Update the affected `docs/wiki` page via `iwiki:iwiki-ingest`; run
  `/iwiki-lint` (no `lat.md/` in this project).
- `npm run lint`; verify no new `tsc` errors in touched files (a pre-existing
  baseline of unrelated `tsc` errors exists).
- PR from `dev/format-button-domain` into `master`.
