---
chain:
  intent: docs/superpowers/intents/2026-06-01-manage-sources-removal-reinit-intent.md
state: approved
---
# Design: manage-sources removal — forced reinit

## Status

approved

## Problem

`handleManageSourcesResult` detects removed sources and runs `cleanupRemovedSources`, but never triggers `init --force`. Wiki pages derived from the removed source persist as orphans. The domain must be fully rebuilt from remaining sources to stay consistent.

## Scope

Single file, single function: `src/view.ts#handleManageSourcesResult`.

Controller API unchanged.

## Design

### Decision tree

Three mutually exclusive branches, evaluated in order:

| Condition | Action |
|-----------|--------|
| `removed > 0 && newPaths.length > 0` | ConfirmModal → on confirm: save + cleanup + reinit (force) |
| `removed > 0 && newPaths.length === 0` | Immediate: save + cleanup, no reinit |
| `added > 0 && removed === 0` | `updateDomainSources` + `IngestScopeModal` (unchanged) |

`added > 0 && removed > 0` falls into the first branch — reinit path, not `IngestScopeModal`.

### Branch 1 — remove with remaining sources

Collect file counts (same pattern as the reinit button):

```typescript
const T = i18n().modal;
const base = this.plugin.controller.cwdOrEmpty();
const toVaultRel = (p: string): string => {
  if (!base || !isAbsolute(p)) return p;
  const rel = relative(base, p);
  return rel.startsWith("..") ? p : rel;
};
const mdFiles = collectMdInPaths(this.app.vault, newPaths.map(toVaultRel));
const wikiFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(original.wiki_folder)]);
const body = T.reinitConfirmBody(original.id, wikiFiles.length, mdFiles.length, newPaths.length);
```

Open `ConfirmModal` with `T.reinitConfirmTitle` and `body`. In the confirm callback:

1. `await this.plugin.controller.updateDomainSources(original.id, newPaths)`
2. `const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed)`
3. `if (deleted > 0) new Notice(...)` — same notice as today
4. `void this.plugin.controller.init(original.id, false, newPaths, true)` — `force=true`

Cancel → no-op. Nothing is saved.

### Branch 2 — remove all sources

`newPaths.length === 0`: no confirm, no reinit. Execute immediately:

1. `await this.plugin.controller.updateDomainSources(original.id, newPaths)`
2. `const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed)`
3. `if (deleted > 0) new Notice(...)`

### Branch 3 — add-only (unchanged)

`removed === 0 && added.length > 0`:

1. `await this.plugin.controller.updateDomainSources(original.id, newPaths)`
2. `new IngestScopeModal(...)` — identical to current behaviour

## Constraints

- `updateDomainSources` always called inside the confirm callback (not before) in Branch 1 — cancel must leave domain unmodified
- `cleanupRemovedSources` called after `updateDomainSources`, before `init`
- No new i18n strings — reuse `T.reinitConfirmTitle` / `T.reinitConfirmBody`
- `newPaths` (remaining sources) passed to `init`, not the original full list

## Tests

Manual test criteria from intent:

- Remove a source, click Save, confirm → `init --force` runs with remaining sources; domain updated
- Remove a source, click Save, cancel → domain unchanged; no init, no cleanup
- Remove all sources → domain saved, cleanup runs, no confirm, no init
- Add source only → `IngestScopeModal` shown, behaviour identical to today
- Add + Remove simultaneously → confirm modal shown, reinit path taken
