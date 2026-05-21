# Design: Move _domain.json to !Wiki/.config/

Date: 2026-05-21

## Goal

Move `_domain.json` from `!Wiki/_domain.json` to `!Wiki/.config/_domain.json` to consolidate config files under `.config/`, alongside `_wiki_schema.md` and `_format_schema.md`.

No migration. Clean break — users re-run init if needed.

## Changes

### src/domain-store.ts

- Change `FILE_PATH` constant: `"!Wiki/_domain.json"` → `"!Wiki/.config/_domain.json"`
- Change `TMP_PATH` (derives from `FILE_PATH`, no separate edit needed)
- Add `CONFIG_DIR = "!Wiki/.config"` constant
- Update `save()`: ensure both `!Wiki` and `!Wiki/.config` exist before writing

New `save()` sequence:
1. If `!Wiki` missing → `createFolder("!Wiki")`
2. If `!Wiki/.config` missing → `createFolder("!Wiki/.config")`
3. Write to `.tmp`, remove old if exists, rename

### src/main.ts

- Line 284: change hardcoded `"!Wiki/_domain.json"` → `"!Wiki/.config/_domain.json"`

### tests/domain-store.test.ts

Update all path assertions:
- `"!Wiki/_domain.json"` → `"!Wiki/.config/_domain.json"`
- `"!Wiki/_domain.json.tmp"` → `"!Wiki/.config/_domain.json.tmp"`
- `calls` arrays: add `exists:!Wiki/.config` + `createFolder:!Wiki/.config` where applicable

### tests/main-migration.test.ts

Update all path assertions:
- `"!Wiki/_domain.json"` → `"!Wiki/.config/_domain.json"`

## Out of Scope

- No runtime migration of existing `!Wiki/_domain.json`
- No changes to `wiki-path.ts` (`_domain.json` is not validated there)
- No changes to phases (they do not reference `_domain.json` directly)
