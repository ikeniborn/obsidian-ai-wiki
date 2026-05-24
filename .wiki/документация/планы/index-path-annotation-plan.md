---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/plans/2026-05-19-index-path-annotation.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [index-path, _index.md, upsertIndexAnnotation, parseIndexAnnotations, wikilink, fullPath]
tags: [план, wiki-index, _index.md]
---

# Index Path Annotation Plan

Реализационный план добавления path и Obsidian wikilink к записям `_index.md`. Реализован в v0.1.109.

## Основные характеристики

Цель: добавить path и Obsidian wikilink к `_index.md` записям, чтобы LLM мог находить wiki-страницы напрямую без сканирования vault.

Архитектура: минимальный патч `src/wiki-index.ts` — добавить опциональный `fullPath` в `upsertIndexAnnotation`, обновить `parseIndexAnnotations` для strip path из новых записей, обновить 3 caller'а. Backward compatible: старые записи (без `|`) продолжают работать.

### Файловая карта

| Action | File | Что меняется |
|---|---|---|
| Modify | `src/wiki-index.ts` | `upsertIndexAnnotation` + `parseIndexAnnotations` |
| Modify | `tests/wiki-index.test.ts` | Добавить new-format tests, обновить существующие |
| Modify | `src/phases/ingest.ts:120` | Pass `page.path` к upsert |
| Modify | `src/phases/lint.ts:184` | Pass `page.path` к upsert |
| Modify | `src/phases/lint-chat.ts:89` | Pass `page.path` к upsert |

### Tasks (5 tasks, TDD)

1. Tests для `parseIndexAnnotations` — новый формат (3 новых теста, verify fail)
2. Implement `parseIndexAnnotations` — split на первом ` | `, backward compat
3. Tests для `upsertIndexAnnotation` — новый формат с `fullPath` (4 новых теста)
4. Implement `upsertIndexAnnotation` — strip wikiFolder prefix, новый формат при fullPath
5. Update 3 callers — передать `page.path` как `fullPath`; full test suite + build

### Формат результата

```
page-id: [[page-id]] domain/category/page-id.md | annotation text
```

## История изменений

- **2026-05-19** — создан по `docs/superpowers/plans/2026-05-19-index-path-annotation.md`.

## Связанные страницы

- [[index-path-annotation-design]]
- [[wiki-index]]
- [[ingest-operation]]
- [[lint-operation]]
