---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-19-index-path-annotation-design.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [index-path, _index.md, wikilink, path-annotation, upsert, parse, annotation]
tags: [спецификация, wiki-index, _index.md]
---

# Index Path Annotation Design

Добавляет путь и Obsidian wikilink к каждой записи `_index.md`, чтобы LLM мог напрямую находить wiki-страницы без сканирования vault.

## Основные характеристики

### Проблема

`_index.md` хранит аннотации в формате `pid: annotation text`. LLM видит это через `index_block` в промптах, но не может найти файл страницы без полного сканирования vault.

### Решение — новый формат записи

```
pid: [[pid]] domain/category/pid.md | annotation text
```

Пример:
```
metadata-driven-моделирование: [[metadata-driven-моделирование]] ии/концепции/metadata-driven-моделирование.md | Подход к проектированию через YAML-модели
```

Три части:
- `[[pid]]` — кликабельный wikilink в Obsidian
- `domain/category/pid.md` — явный путь для LLM
- `| annotation` — аннотация для Jaccard-скоринга в [[wiki-seeds]]

### Backward Compatibility

Записи без `|` (старый формат: `pid: annotation`) продолжают работать. `parseIndexAnnotations` возвращает полное значение как аннотацию.

### Изменения src/wiki-index.ts

1. **`upsertIndexAnnotation`** — добавлен опциональный параметр `fullPath?: string`. При наличии — новый формат. При отсутствии — старый формат (callers без page.path, например init).

2. **`parseIndexAnnotations`** — обновлён парсер:
   - Если значение содержит ` | `: split по первому ` | `, возвращает аннотацию (правая часть)
   - Старый формат (без `|`): возвращает полное значение (поведение не изменилось)

### Callers upsertIndexAnnotation

| Файл | Источник path |
|---|---|
| `src/phases/ingest.ts:120` | `page.path` |
| `src/phases/lint.ts:184` | `page.path` |
| `src/phases/lint-chat.ts:89` | `page.path` |

### Что не меняется

- `selectSeeds` — получает `Map<string, string>` (только аннотация), без изменений
- `query.ts` — передаёт `indexContent` как raw string в LLM; LLM теперь автоматически видит path
- Промпты `ingest.ts`, `init.ts` — `index_block` не меняется; контент становится богаче

### Миграция

Не требуется. Существующие записи перезаписываются новым форматом при следующем ingest или lint для этой страницы. Mixed-format файлы работают корректно при переходе.

## История изменений

- **2026-05-19** — создана по `docs/superpowers/specs/2026-05-19-index-path-annotation-design.md`.

## Связанные страницы

- [[wiki-index]]
- [[wiki-seeds]]
- [[ingest-operation]]
- [[lint-operation]]
- [[index-path-annotation-plan]]
