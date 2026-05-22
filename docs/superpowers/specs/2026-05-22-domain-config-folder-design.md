# Design: Move _index.md and _log.md to Domain .config Folder

**Date:** 2026-05-22  
**Status:** Approved

## Problem

`_index.md` and `_log.md` are internal files placed at the domain root (e.g., `!Wiki/ии/_index.md`). They appear in the Obsidian file explorer alongside user-facing wiki articles, causing noise. Their paths are hardcoded in 7 places across the codebase with no single source of truth.

## Goal

Move these files to `!Wiki/{domain}/.config/` where Obsidian hides them from the explorer. Implement paths exclusively in TypeScript — no prompt changes required. Auto-migrate existing files on first operation.

## Target Structure

```
!Wiki/
  .config/                        # global (existing)
    _wiki_schema.md
    _format_schema.md
  ии/
    .config/                      # NEW — hidden from Obsidian explorer
      _index.md                   # moved here
      _log.md                     # moved here
    технологии/
      article.md
```

## Architecture

### 1. Path Functions — `src/wiki-path.ts`

Add three new exported functions as the single source of truth:

```ts
export function domainConfigDir(domainFolder: string): string {
  return `${domainFolder}/.config`;
}
export function domainIndexPath(domainFolder: string): string {
  return `${domainFolder}/.config/_index.md`;
}
export function domainLogPath(domainFolder: string): string {
  return `${domainFolder}/.config/_log.md`;
}
```

Update `validateArticlePath` to reference `.config/_index.md` and `.config/_log.md` instead of root-level paths.

### 2. Migration — `src/wiki-path.ts` (or inline in phases)

New function `ensureDomainConfig(vaultTools, domainFolder)`:
- Creates `.config/` directory if absent
- If `{domainFolder}/_index.md` exists and `{domainFolder}/.config/_index.md` does not — reads old, writes new, removes old
- Same for `_log.md`
- Called at the start of every domain operation: `ingest`, `lint`, `lint-chat`, `query`

Migration is idempotent — safe to call repeatedly.

### 3. Callers Updated

| File | Change |
|---|---|
| `src/wiki-index.ts` | `upsertIndexAnnotation` uses `domainIndexPath(wikiFolder)` |
| `src/wiki-log.ts` | `appendWikiLog` — replace `logPath: string` param with `domainFolder: string`, builds path internally via `domainLogPath` |
| `src/phases/ingest.ts` | reads `domainIndexPath(domainRoot)`; passes `domainFolder` to `appendWikiLog`; calls `ensureDomainConfig` first |
| `src/phases/lint.ts` | `META_FILES` filter updated; log path via `domainLogPath`; calls `ensureDomainConfig` per domain |
| `src/phases/lint-chat.ts` | `META_FILES` filter updated |
| `src/phases/query.ts` | reads `domainIndexPath`; `META_FILES` filter updated |
| `src/phases/init.ts` | reads `domainIndexPath` for bootstrap; `ensureRootFiles` already removes root-level files |
| `src/wiki-path.ts` | `validateArticlePath` updated |

### 4. META_FILES Filter

Current: `["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"]` — suffix match via `f.endsWith(m)`.

`VaultTools._listRecursive` recurses into all folders including `.config/`, so after the move, `listFiles` will return paths like `!Wiki/ии/.config/_index.md`. These still end with `_index.md` — the existing suffix filter works unchanged. No modifications to `META_FILES` arrays needed.

### 5. Opening Files in Obsidian (Edit Mode)

Add button/link in `LlmWikiView` (sidebar) per domain: "Open _log" / "Open _index" using `app.workspace.openLinkText(domainLogPath(...), "", true)`. This makes the files accessible from the UI without exposing them in the explorer.

## Migration Behavior

```
First ingest/lint/query on domain "ии":
  ensureDomainConfig("!Wiki/ии")
    mkdir "!Wiki/ии/.config"            → ok (already exists → no-op)
    exists "!Wiki/ии/_index.md"?        → yes
    exists "!Wiki/ии/.config/_index.md"? → no
    read + write + remove               → migrated
    exists "!Wiki/ии/_log.md"?          → yes (same migration)
  → operation continues with new paths
```

## Testing

- Unit tests in `tests/wiki-path.test.ts`: `domainIndexPath`, `domainLogPath`, `domainConfigDir`, `validateArticlePath`
- `ensureDomainConfig` migration test: mock vaultTools with old files present → assert new files created, old removed
- `upsertIndexAnnotation` and `appendWikiLog` updated tests to reflect new path signatures
- Existing phase tests: update path expectations

## Out of Scope

- No changes to prompts
- No changes to `_wiki_schema.md` / `_format_schema.md` locations (already in global `.config`)
- No UI redesign beyond the "Open _log / _index" buttons in the sidebar
