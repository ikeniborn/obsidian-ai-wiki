---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-19-wiki-path-hierarchy-design.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [wiki-path, 4-level, hierarchy, sanitize, validate, path-validation, domain]
tags: [спецификация, wiki-path, валидация]
---

# Wiki Path Hierarchy Design

Спецификация строгой 4-уровневой иерархии wiki-путей: `!Wiki/<domain>/<entity>/<Article>.md`. Sanitize-функции в init, validate+retry в ingest.

## Основные характеристики

### Проблема

LLM неправильно генерирует значения `wiki_subfolder` с domain-префиксом (например `os/network` вместо `network`), что приводит к путям вида `!Wiki/os/os/network/nfs/NFS.md`. Нет валидации для обнаружения и отклонения таких нарушений.

### Обязательная иерархия

```
!Wiki/                    ← level 1: wiki root (фиксировано)
  <domain>/               ← level 2: domain subfolder (например os)
    <entity>/             ← level 3: тип сущности (например network)
      <Article>.md        ← level 4: файл статьи
```

Системные файлы (`_index.md`, `_log.md`, `_wiki_schema.md`) в `!Wiki/<domain>/` освобождены от правила.

### Новые функции src/wiki-path.ts

```typescript
// Очищает wiki_folder от vault-префиксов, берёт последний сегмент
export function sanitizeWikiFolder(raw: string): string

// Берёт последний сегмент (strips domain prefix: "os/network" → "network")
export function sanitizeWikiSubfolder(raw: string): string

// Проверяет ровно 2 сегмента после domain-prefix
export function validateArticlePath(path: string, wikiVaultPath: string): boolean
```

### Изменения в промптах

**`prompts/ingest.md`** — добавлено перед инструкцией JSON:
```
ПРАВИЛО ПУТЕЙ: путь каждой статьи = !Wiki/<domain>/<entity>/<Article>.md — ровно 4 сегмента.
```

**`prompts/init.md`** — добавлено правило для wiki_subfolder:
```
ПРАВИЛО wiki_subfolder: одно слово, без слэшей, без domain_id.
```

### Изменения src/phases/init.ts

Применяет `sanitizeWikiFolder` и `sanitizeWikiSubfolder` после LLM-парсинга — молчаливо исправляет без повторного запроса.

### Изменения src/phases/ingest.ts

После парсинга JSON-страниц:
1. Разделить на `valid` и `invalid` через `validateArticlePath`
2. При `invalid.length > 0`: emit warning, re-call LLM с feedback
3. После retry, всё ещё invalid → emit `tool_result ok: false`, пропустить запись

## Тест-кейсы

| Input path | wikiVaultPath | Результат |
|---|---|---|
| `!Wiki/os/network/NFS.md` | `!Wiki/os` | valid |
| `!Wiki/os/os/network/NFS.md` | `!Wiki/os` | invalid → retry |
| `!Wiki/os/network/nfs/NFS.md` | `!Wiki/os` | invalid → retry |
| `!Wiki/os/_index.md` | `!Wiki/os` | valid (exempt) |
| `!Wiki/other/network/NFS.md` | `!Wiki/os` | invalid (wrong domain) |

## История изменений

- **2026-05-19** — создана по `docs/superpowers/specs/2026-05-19-wiki-path-hierarchy-design.md`.

## Связанные страницы

- [[ingest-operation]]
- [[init-operation]]
- [[wiki-path-hierarchy-plan]]
