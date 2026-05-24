---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/plans/2026-05-19-wiki-path-hierarchy.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [wiki-path, 4-level, sanitize, validate, retryInvalidPaths, ingest, init, prompts]
tags: [план, wiki-path, валидация]
---

# Wiki Path Hierarchy Plan

Реализационный план строгой 4-уровневой иерархии wiki-путей. Sanitize в init, validate+retry в ingest, правила в промптах.

## Основные характеристики

Цель: применить `!Wiki/<domain>/<entity>/<Article>.md` (ровно 4 сегмента) через sanitize-функции в init, validate+retry в ingest, правила в промптах.

### Файловая карта

| Action | File | Ответственность |
|---|---|---|
| Modify | `src/wiki-path.ts` | Добавить 3 новые exported functions |
| Modify | `src/phases/init.ts` | Заменить manual strip на `sanitizeWikiFolder`; добавить `sanitizeWikiSubfolder` per entity_type |
| Modify | `src/phases/ingest.ts` | Добавить validate+retry после `parseJsonPages` |
| Modify | `prompts/ingest.md` | ПРАВИЛО ПУТЕЙ перед JSON output |
| Modify | `prompts/init.md` | ПРАВИЛО wiki_subfolder в entity_types section |
| Create | `tests/wiki-path.test.ts` | Unit tests для 3 новых функций |
| Modify | `tests/phases/ingest.test.ts` | Tests для path validation и retry |

### Tasks (4 tasks, TDD)

**Task 1:** `sanitizeWikiFolder`, `sanitizeWikiSubfolder`, `validateArticlePath` в `src/wiki-path.ts` + 14 unit tests

**Task 2:** Apply sanitize в `src/phases/init.ts` + тесты; оба bootstrap-блока (runInit + runInitWithSources)

**Task 3:** Validate+retry в `src/phases/ingest.ts`:
- `splitByPathValidity()` — private helper
- `retryInvalidPaths()` — private helper, один retry
- Emit warning + retry → merge; still invalid → `tool_result ok: false`

**Task 4:** Добавить ПРАВИЛО ПУТЕЙ в `prompts/ingest.md`, ПРАВИЛО wiki_subfolder в `prompts/init.md`

### Ключевые реализации

```typescript
// src/wiki-path.ts
export function sanitizeWikiFolder(raw: string): string  // strips vault/!Wiki, last segment
export function sanitizeWikiSubfolder(raw: string): string  // last segment if "/"
export function validateArticlePath(path: string, wikiVaultPath: string): boolean  // 2 segs after domain
```

## История изменений

- **2026-05-19** — создан по `docs/superpowers/plans/2026-05-19-wiki-path-hierarchy.md`.

## Связанные страницы

- [[wiki-path-hierarchy-design]]
- [[ingest-operation]]
- [[init-operation]]
