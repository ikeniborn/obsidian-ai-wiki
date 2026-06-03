# Design: Settings grouping — reorder global params, visual separator, dedup Semantic Search

**Date:** 2026-06-03
**Status:** approved
**Intent:** `docs/superpowers/intents/2026-06-03-settings-grouping-intent.md`

## Problem

In native backend settings, `structuredRetries` renders after the per-operation block. When per-operation is expanded, it appears after the last operation (Format), visually implying it belongs to Format rather than being a global native backend setting.

Additionally, two identical `"Semantic Search".setHeading()` calls produce a duplicate section header.

## Scope

- File: `src/settings.ts`, native backend section only
- Claude backend: no `structuredRetries` exists there, no changes needed

## New settings order (native backend)

```
[connection: baseUrl, apiKey, check connection]
[model / maxTokens / thinkingBudget / temperature]   ← shown only when !perOperation
Structured output retries                             ← global, always visible
── if (!Platform.isMobile): ──
  "Per-operation models" heading                      ← NEW separator
  Per-operation toggle
  [per-op block: ingest/query/lint/init/format]       ← shown when perOperation=true
── "Semantic Search" heading ──                       ← single (dedup)
Enable semantic similarity (embeddings)
...
```

## Changes

### 1. Move `structuredRetries` block

Cut the `structuredRetries` Setting block (currently after the per-op block) and insert it before `if (!Platform.isMobile)`.

### 2. Add heading separator

Inside `if (!Platform.isMobile)`, before the per-operation toggle, add:
```ts
new Setting(containerEl).setName("Per-operation models").setHeading();
```

### 3. Remove duplicate heading

Delete one of the two `new Setting(containerEl).setName("Semantic Search").setHeading()` lines (keep only one).

## Success criteria

- Settings render in correct order in Obsidian plugin settings tab
- `structuredRetries` visible above per-operation section regardless of per-op toggle state
- Visual heading "Per-operation models" separates global params from per-op config
- Single "Semantic Search" heading
- Per-operation toggle still shows/hides the per-op config block correctly
- Settings save and load correctly
