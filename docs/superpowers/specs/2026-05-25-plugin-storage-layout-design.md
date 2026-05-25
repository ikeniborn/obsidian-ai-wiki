# Design: Plugin Storage Layout

**Date:** 2026-05-25  
**Status:** pending review  
**Context:** `.config/` → `_config/` rename (approved in 2026-05-25-config-dir-rename-intent.md) extended with schema globalisation and explicit file placement rationale.

---

## Objective

Restructure plugin file storage so that:
- All data migrates with any sync method (Obsidian Sync, LiveSync, iCloud) without extra configuration
- Domain config, index, log appear in Obsidian search and graph view
- Schemas (prompt templates) are accessible to the user for editing but do not pollute search
- No manual steps required after vault sync to a new device

---

## File Layout

```
!Wiki/
  _config/                          ← GLOBAL plugin config
    _domain.json                    — domain registry (JSON; Obsidian does not index content)
    _agent.jsonl                    — global operation log, all domains (JSONL; not indexed)
    _dev.jsonl                      — dev mode eval log (JSONL; not indexed)
    _wiki_schema.md                 — shared wiki conventions for LLM (INDEXED by Obsidian)
    _format_schema.md               — shared format conventions for LLM (INDEXED by Obsidian)

  <domain>/
    _config/                        ← PER-DOMAIN config
      _index.md                     — wiki page index with annotations (INDEXED)
      _log.md                       — ingest/lint operation log (INDEXED)
    <EntityType>/
      Article.md                    — wiki page
```

### Design decisions

| Decision | Rationale |
|---|---|
| `_config/` (underscore, not dot) | Underscore folders sync via all methods without special config; dot-folders are excluded from Obsidian Sync and LiveSync regular sync by default |
| Schemas global, not per-domain | All domains use the same extraction and format conventions; per-domain divergence was never used in practice |
| `_agent.jsonl`, `_dev.jsonl` global | Activity spans all domains; no per-domain filtering needed |
| `_index.md`, `_log.md` per-domain | Content is domain-specific; must stay co-located with wiki articles |
| JSONL files not indexed | Obsidian does not parse JSONL content — files appear in File Explorer but not in search or graph |

### Sync behaviour

| File | Obsidian Sync | LiveSync regular | Obsidian index |
|---|---|---|---|
| `_config/_domain.json` | ✅ | ✅ | ❌ JSON |
| `_config/_wiki_schema.md` | ✅ | ✅ | ✅ |
| `_config/_format_schema.md` | ✅ | ✅ | ✅ |
| `_config/_agent.jsonl` | ✅ | ✅ | ❌ JSONL |
| `_config/_dev.jsonl` | ✅ | ✅ | ❌ JSONL |
| `<domain>/_config/_index.md` | ✅ | ✅ | ✅ |
| `<domain>/_config/_log.md` | ✅ | ✅ | ✅ |

---

## Migration

Runs automatically on plugin startup. Idempotent — if old `.config/` is absent, silently skips.

### Algorithm

```
detect !Wiki/.config/ exists?
  NO  → skip
  YES →

  1. create !Wiki/_config/ if absent

  2. move _domain.json
       !Wiki/.config/_domain.json → !Wiki/_config/_domain.json

  3. resolve global schema (pick most recently modified among all per-domain copies):
       for each domain in _domain.json:
         candidate = !Wiki/<domain>/.config/_wiki_schema.md (check mtime)
       winner = candidate with latest mtime
       copy winner → !Wiki/_config/_wiki_schema.md
       repeat for _format_schema.md

  4. move per-domain files for each domain:
       mkdir !Wiki/<domain>/_config/
       mv !Wiki/<domain>/.config/_index.md  → !Wiki/<domain>/_config/_index.md
       mv !Wiki/<domain>/.config/_log.md    → !Wiki/<domain>/_config/_log.md
       merge _agent.jsonl entries → !Wiki/_config/_agent.jsonl (append, preserve order)
       merge _dev.jsonl entries   → !Wiki/_config/_dev.jsonl   (append, preserve order)

  5. remove old directories:
       rm !Wiki/<domain>/.config/  (for each domain)
       rm !Wiki/.config/

stop rules:
  - halt if any copy/move fails (I/O error) — leave old structure intact, log error
  - if both .config/ and _config/ exist at startup — halt, emit error: interrupted migration
```

### Edge cases

| Case | Behaviour |
|---|---|
| Domain in `_domain.json` has no `.config/` | Skip that domain silently |
| No per-domain schema found anywhere | Copy bundled template from `prompts/templates/` |
| `_agent.jsonl` does not exist in a domain | Skip merge for that domain |

---

## Code changes

### `wiki-path.ts`

Replace per-domain config functions with split global/per-domain API:

```typescript
// Global (was: !Wiki/.config/)
export const GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
export const GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
export const GLOBAL_WIKI_SCHEMA_PATH = `${GLOBAL_CONFIG_DIR}/_wiki_schema.md`;
export const GLOBAL_FORMAT_SCHEMA_PATH = `${GLOBAL_CONFIG_DIR}/_format_schema.md`;
export const GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
export const GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;

// Per-domain (was: <domain>/.config/)
export function domainConfigDir(domainFolder: string): string {
  return `${WIKI_ROOT}/${domainFolder}/_config`;
}
export function domainIndexPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_index.md`;
}
export function domainLogPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_log.md`;
}
```

Remove: `domainWikiSchemaPath`, `domainFormatSchemaPath` (schemas are now global constants).

Update `validateArticlePath` to accept new `_config/` paths.

### `domain-store.ts`

Update `FILE_PATH` and `CONFIG_DIR` to use `GLOBAL_DOMAIN_PATH` and `GLOBAL_CONFIG_DIR`.

### Phase functions

| File | Change |
|---|---|
| `phases/ingest.ts` | Read `_wiki_schema.md` from `GLOBAL_WIKI_SCHEMA_PATH` |
| `phases/lint.ts` | Read `_wiki_schema.md` from `GLOBAL_WIKI_SCHEMA_PATH` |
| `phases/lint-chat.ts` | Read `_wiki_schema.md` from `GLOBAL_WIKI_SCHEMA_PATH` |
| `phases/format.ts` | Read `_format_schema.md` from `GLOBAL_FORMAT_SCHEMA_PATH` |
| `phases/init.ts` | Write schemas to `GLOBAL_WIKI_SCHEMA_PATH`, `GLOBAL_FORMAT_SCHEMA_PATH` |

### `main.ts`

Add `runStorageMigration()` called during `onload`, before any other vault operations. Implements the migration algorithm above.

---

## Documentation updates

### `docs/prompt-architecture.md`

Update the "Промты по фазам" Mermaid diagram:
- Rename vault node `.config/_wiki_schema.md` → `_config/_wiki_schema.md` (global)
- Rename vault node `.config/_format_schema.md` → `_config/_format_schema.md` (global)
- Add note: schemas are global (`!Wiki/_config/`), not per-domain

Update the operations table row for `init`: "Produces `_wiki_schema.md`, `_format_schema.md`" → clarify written to `!Wiki/_config/` (global, shared by all domains).

Update the comparison table row for `_wiki_schema.md` and `_format_schema.md`: update path references from `.config/` to `_config/`; note schema is now global.

### `lat.md/domain.md`

Update "Wiki Folder Layout" section: replace `.config/` with `_config/`, move schemas to global level, add `_agent.jsonl` / `_dev.jsonl` to global config.

---

## Sidebar buttons: open log and index

Currently the sidebar panel has buttons that open `_log.md` and `_index.md` in an Obsidian leaf. Since both files are now indexed (visible in Obsidian), these buttons can use `app.workspace.openLinkText()` instead of constructing a vault-adapter path — the same mechanism Obsidian uses for wikilinks. This gives correct tab behaviour (reuse existing leaf, respect user split-pane settings) and does not require a path constant at call site.

Change in `view.ts`: replace direct `vault.adapter` open calls with `app.workspace.openLinkText(filename, sourcePath, false)`.

---

## Out of scope

- Per-domain schema overrides (removed by this design; not used in practice)
- User-configurable storage paths
- Compression or rotation of `_log.md` / `_agent.jsonl`
