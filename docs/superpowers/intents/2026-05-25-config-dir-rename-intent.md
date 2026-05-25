# Intent: Rename .config/ to _config/ for Obsidian Sync compatibility

**Date:** 2026-05-25
**Status:** draft

## Objective

Obsidian Sync ignores hidden directories (prefixed with `.`). After syncing the vault to another PC, `.config/` is absent — the plugin cannot find domains and fails to start. Renaming to `_config/` (non-hidden) makes the directory visible to Obsidian Sync, enabling multi-device wiki usage without manual intervention.

## Desired Outcomes

- On a second PC after vault sync, the wiki works without any manual steps
- `_domain.json` is visible in Obsidian on all devices
- Plugin starts without "domain not found" errors
- Sidebar buttons (index link, log link) work correctly
- Agent correctly updates log, index, and domain files using new paths

## Health Metrics

- Existing wiki with `.config/` continues to work — no data loss during migration
- All operations (ingest, lint, lint-chat, format) do not fail on existing vaults before or after migration
- `_domain.json` content is preserved exactly after migration (format unchanged)

## Strategic Context

- Interacts with: `DomainStore`, `wiki-path.ts`, all phase modules (ingest, lint, lint-chat, format), sidebar panel, plugin startup
- Both directory levels renamed: `!Wiki/.config/` (global) and `!Wiki/<domain>/.config/` (per-domain)
- Priority trade-off: **reliability** — data integrity during migration takes precedence over release speed

## Constraints

### Steering (behavioral guidance)

- Migration runs automatically on plugin startup — no user action required
- Migration logic: detect `.config/` → copy all contents to `_config/` → remove old `.config/`
- If old `.config/` not present, skip silently

### Hard (architectural enforcement)

- Do not change `_domain.json` format or internal file structure — only the containing directory name changes
- Do not require any manual steps from the user
- Both `!Wiki/.config/` and `!Wiki/<domain>/.config/` must be renamed — not one without the other

## Autonomy Zones

- **Full autonomy** (reversible, low risk): refactoring path constants in `wiki-path.ts`, updating all phase modules to use new paths, updating `DomainStore`, updating sidebar path references, updating `lat.md/` docs
- **Proposal-first** (needs approval): migration execution order (global config first vs domain configs first), error recovery strategy if partial migration occurs
- **No autonomy** (human only): decision to delete old `.config/` after successful migration vs keeping as backup

## Stop Rules

- **Halt if:** migration detects `.config/` but cannot copy its contents (permission error, I/O failure) — log error, leave old directory intact, do not proceed
- **Escalate if:** both `.config/` and `_config/` exist simultaneously at startup (indicates interrupted previous migration)
- **Done when:** all tests pass, both directory levels renamed in code, automatic migration works on a test vault with existing `.config/` structure
