# Intent: Manage Sources — Reinit on Source Removal

**Date:** 2026-06-01
**Status:** approved

## Objective

`handleManageSourcesResult` detects removed sources and calls `cleanupRemovedSources`, but never triggers `init --force`. When at least one source is removed, the wiki pages derived from that source may still exist as orphans. A forced reinit with the remaining sources is needed to rebuild the domain cleanly. Fix is needed now because the current behavior silently leaves stale wiki pages without rebuilding the index.

## Desired Outcomes

- User removes source(s) → clicks Save → `ConfirmModal` appears (reusing `reinitConfirmTitle` / `reinitConfirmBody` i18n strings) explaining reinit will run
- User confirms → `updateDomainSources(newPaths)` → `cleanupRemovedSources` → `controller.init(domainId, false, newPaths, true)` (force)
- User cancels confirm → nothing is saved, reinit does not run
- Add-only path (no removals) → `IngestScopeModal` as before, unchanged
- Add + Remove simultaneously → reinit force path (not `IngestScopeModal`)
- Remove all sources → `newPaths` is empty → no reinit, only save + cleanup

## Health Metrics

- Add-only path behaviour is identical to current
- No new i18n strings introduced (reuse existing `reinitConfirmTitle` / `reinitConfirmBody`)

## Strategic Context

- Interacts with: `src/view.ts#handleManageSourcesResult`, `src/controller.ts#init`, `src/controller.ts#cleanupRemovedSources`, `src/controller.ts#updateDomainSources`
- Priority trade-off: trust > speed — confirm gate before destructive reinit

## Constraints

### Steering (behavioral guidance)

- Reuse `T.reinitConfirmTitle` and `T.reinitConfirmBody` for the confirmation dialog
- Pass `newPaths` (remaining sources after deletion) to `init --force`, not the original full source list

### Hard (architectural enforcement)

- `updateDomainSources` called first inside the confirm callback (domain persisted before reinit starts)
- `cleanupRemovedSources` called after `updateDomainSources`, before `init`
- Only `view.ts` changes — controller API unchanged

## Autonomy Zones

- Full autonomy (reversible, low risk): all changes in `handleManageSourcesResult`

## Stop Rules

- Halt if: `newPaths` is empty and removals occurred — skip reinit, still save + cleanup
- Done when: manual test — remove a source, Save, confirm → `init --force` runs with remaining sources; cancel → nothing saved
