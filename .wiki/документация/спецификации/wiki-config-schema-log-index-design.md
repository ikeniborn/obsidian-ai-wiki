---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-20-wiki-config-schema-log-index-design.md]]"
wiki_updated: 2026-05-20
wiki_domain: документация
wiki_keywords: [wiki-log, wiki-index, appendWikiLog, config-layout, grouped-index, enriched-log, schema-path]
tags: [спецификация, wiki-log, wiki-index, config]
---

# Wiki Config: Schema Centralization, Grouped Index, Enriched Log

Спецификация трёх улучшений: централизация конфигурации, человекочитаемый grouped-index и обогащённый лог операций.

## Проблема

1. **Schema files scattered** — `_wiki_schema.md` и `_format_schema.md` лежали в корне `!Wiki/`, рядом с доменными папками. Нет выделенного config-пространства.
2. **Flat index** — `pid: [[pid]] path | annotation` строки не читаются человеком и дают LLM слабый структурный контекст.
3. **Sparse log** — лог не различал CREATE/UPDATE, не фиксировал wiki_status-переходы, токены и non-ingest операции (lint/fix).

## Решение

### 1. Config Layout

Оба schema-файла перенесены в `!Wiki/.config/`:

```
!Wiki/.config/
  _wiki_schema.md      ← wiki page conventions (ingest reads this)
  _format_schema.md    ← formatting rules (format reads this)
```

Изменения в коде:
- `ingest.ts`: читает `${schemaRoot}/.config/_wiki_schema.md`
- `format.ts`: читает `${WIKI_ROOT}/.config/_format_schema.md`
- `init.ts`: scaffold `.config/` с обоими файлами в `ensureRootFiles()`

### 2. Grouped Markdown Index

Per-domain `_index.md` переформатирован из flat key-value в grouped Markdown по подпапкам:

```markdown
## компоненты
- [[wiki-controller]] компоненты/wiki-controller.md — WikiController: single-flight guard
## операции
- [[ingest-operation]] операции/ingest-operation.md — Ingest: извлечение сущностей
```

Правила:
- Секция = имя подпапки внутри домена; страницы без подпапки → `## general`
- `pid` = имя файла без `.md`
- Порядок секций и записей — по первой записи (first-write order)
- Отсутствующая секция → добавляется в конец файла

`wiki-index.ts` полностью переписан: `parseIndexAnnotations` парсит grouped-формат, `upsertIndexAnnotation` производит секционный upsert. Тот же публичный API — callers (`wiki-seeds.ts`, ingest) не изменились.

### 3. Enriched Log Format

Все операции пишут в `!Wiki/<domain>/_log.md` через общий `appendWikiLog`:

| Поле | Источник |
|---|---|
| СОЗДАНА vs ОБНОВЛЕНА | `vaultTools.read(path)` до записи: throws → СОЗДАНА, else ОБНОВЛЕНА |
| `stub→developing` | Парсинг `wiki_status` из старого frontmatter до и нового после записи |
| Токены | `outputTokens` из `result` event |
| Проверено/Исправлено | Существующие счётчики lint |

Новый модуль `src/wiki-log.ts` содержит `appendWikiLog`, типы `LogOperation` и `IngestLogEntry`.

## Реализованные изменения

| Файл | Изменение |
|---|---|
| `src/wiki-log.ts` | Новый модуль: `appendWikiLog`, `LogOperation`, `IngestLogEntry` |
| `src/phases/ingest.ts` | Schema path → `.config/`, вызов `appendWikiLog`, детект СОЗДАНА/ОБНОВЛЕНА + status |
| `src/phases/format.ts` | Schema path → `.config/_format_schema.md` |
| `src/phases/init.ts` | `ensureRootFiles` scaffold `.config/` + оба schema-файла |
| `src/phases/lint.ts` | Вызов `appendWikiLog` с lint-вариантом |
| `src/wiki-index.ts` | Полная перепись: grouped Markdown парсер + writer |

## Связанные страницы

- [[wiki-index]]
- [[wiki-log]]
- [[ingest-operation]]
- [[lint-operation]]
- [[format-operation]]
- [[init-operation]]
