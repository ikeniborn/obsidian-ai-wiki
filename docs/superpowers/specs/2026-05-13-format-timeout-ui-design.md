---
title: Format timeout — expose in settings UI
date: 2026-05-13
status: approved
---

## Problem

`timeouts.format` and `timeouts.fix` exist in `LlmWikiPluginSettings` (types.ts:118) with defaults (600s, 900s), and `controller.ts:544` reads them correctly via `timeouts[opKey]`. However, the settings UI text field only exposes 4 values (`ingest/query/lint/init`) — `fix` and `format` are invisible and unchangeable by the user.

## Goal

Expose all 6 timeout values in the existing single-field UI pattern. User can edit format timeout from Settings.

## Scope

Three files touched, no architectural changes.

## Design

### `src/i18n.ts`

Update `timeouts_desc` in all three locales (en, ru, es):

```
"ingest / query / lint / fix / init / format"
```

### `src/settings.ts`

Expand the single timeout text field to read/write 6 slash-separated values.

**Current format (4 parts):** `ingest/query/lint/init`

**New format (6 parts):** `ingest/query/lint/fix/init/format`

Order matches the type definition in `types.ts:118`: `ingest, query, lint, fix, init, format`.

Note: `init` moves from position 3 to position 4. Users with manually memorised order should update. The field label in `timeouts_desc` always shows the canonical order, so this is self-documenting.

onChange validation: `parts.length === 6 && parts.every(n => isFinite(n) && n > 0)`.

setValue reads from all 6 fields of `s.timeouts`.

### Backward compatibility

Existing saved settings have only 4 keys. On plugin load, Obsidian merges saved data with `DEFAULT_SETTINGS` — missing keys (`fix`, `format`) remain at default values (900, 600). No migration needed.

### No changes needed

- `src/types.ts` — type already correct
- `src/controller.ts` — reads `timeouts[opKey]` dynamically, format already works

## Testing

1. Open Settings → verify field shows `300/300/900/900/3600/600` (defaults)
2. Change format value → save → re-open Settings → verify persisted
3. Run format operation → verify it uses the configured timeout (check AgentRunner dev log)
4. Existing 4-value saved settings → verify plugin loads without error, fix/format use defaults
