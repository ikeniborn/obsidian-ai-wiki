---
title: Index Path Annotation
date: 2026-05-19
status: approved
review:
  spec_hash: 3ca4497ef0e96a71
  last_run: 2026-05-19
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "## Changes"
      section_hash: 09406d1ac74f2a7a
      text: "parseIndexPaths removed — was YAGNI (no current consumer)"
      verdict: fixed
      verdict_at: 2026-05-19
---

# Index Path Annotation Design

## Problem

`_index.md` stores LLM annotations in format `pid: annotation text`. The LLM sees this via `index_block` in prompts but cannot locate the actual wiki page file without scanning the entire vault.

## Solution

Add path and Obsidian wikilink to each index entry. New format:

```
pid: [[pid]] domain/category/pid.md | annotation text
```

Example:
```
metadata-driven-моделирование: [[metadata-driven-моделирование]] ии/концепции/metadata-driven-моделирование.md | Подход к проектированию через YAML-модели, автоматическую нормализацию, генерацию SQL и диаграмм с полным data lineage.
```

Each entry has three parts:
- `[[pid]]` — clickable Obsidian wikilink when viewing `_index.md` in Obsidian
- `domain/category/pid.md` — explicit path for LLM direct file access
- `| annotation` — annotation text for Jaccard scoring in `selectSeeds`

## Backward Compatibility

Entries without `|` (old format: `pid: annotation`) continue to work. `parseIndexAnnotations` treats the full value as annotation with no path.

## Changes

### `src/wiki-index.ts`

1. `upsertIndexAnnotation` — add optional `pagePath?: string` parameter. When provided, write new format. When absent, write old format (callers that don't have path yet, e.g. init).

2. `parseIndexAnnotations` — update parser:
   - If value contains ` | `: split on first ` | `, return annotation (right side) as map value
   - Old format (no `|`): return full value as annotation (unchanged behavior)

### Callers of `upsertIndexAnnotation`

All three callers already have `page.path` available:

| File | Source of path |
|---|---|
| `src/phases/ingest.ts:120` | `page.path` |
| `src/phases/lint.ts:184` | `page.path` |
| `src/phases/lint-chat.ts:89` | `page.path` |

Pass `page.path` as `pagePath` argument.

### No changes needed

- `selectSeeds` — receives `Map<string, string>` (annotation only), unchanged
- `query.ts` — passes `indexContent` raw string to LLM; LLM now automatically sees path
- `ingest.ts`, `init.ts` — `index_block` prompt unchanged; content now richer

## Migration

No migration step. Existing entries are overwritten with new format on next ingest or lint run for that page. Mixed-format `_index.md` files work correctly during transition.

## Tests

Update `tests/` for `wiki-index.ts`:
- `parseIndexAnnotations` with new format returns annotation (not path)
- `parseIndexAnnotations` with old format returns full value (backward compat)
- `upsertIndexAnnotation` with `pagePath` writes new format
- `upsertIndexAnnotation` without `pagePath` writes old format

## Scope

4 files changed: `src/wiki-index.ts`, `src/phases/ingest.ts`, `src/phases/lint.ts`, `src/phases/lint-chat.ts`.
Tests updated: `tests/wiki-index.test.ts` (new or existing).
