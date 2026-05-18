---
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
  - "[[docs/superpowers/plans/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_status: mature
wiki_keywords: [wiki-index, index-annotations, upsert, parse, annotation, _index.md]
tags: [компонент, index, annotations, seed-selection]
---

# wiki-index

Модуль `src/wiki-index.ts` — парсинг и обновление аннотированного `_index.md`.

## Назначение

Поддерживает файл `_index.md` в формате `PageId: однострочная аннотация`. Аннотации используются [[wiki-seeds]] для Jaccard-скоринга и [[query-operation]] для упрощения LLM seed prompt.

## Основные характеристики

### Публичный API

```typescript
// Парсинг _index.md → Map<pageId, annotation>
export function parseIndexAnnotations(content: string): Map<string, string>

// Upsert строки «PageId: annotation» в _index.md
export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pageId: string,
  annotation: string,
): Promise<void>
```

### Формат `_index.md`

```
PageId: однострочная аннотация 10-15 слов
ДипСик: быстрая языковая модель для инференса в облаке
Кластеризация: алгоритм группировки данных без учителя
```

- Одна строка на статью.
- Строки без двоеточия игнорируются (headers, пустые строки).
- Аннотация может содержать двоеточие (`key: val: more`) — первое двоеточие — разделитель.

### Поведение upsertIndexAnnotation

- Если `pageId` уже есть в файле — строка заменяется.
- Если нет — добавляется в конец.
- Если файл не существует — создаётся с единственной строкой.
- Путь записи: `{wikiFolder}/_index.md`.
- Ошибки чтения (файл не найден) — обрабатываются gracefully (начинает с пустой строки).

## Где используется

| Компонент | Роль |
|---|---|
| `phases/ingest.ts` | upsertIndexAnnotation после каждой записи страницы |
| `phases/lint.ts` | upsertIndexAnnotation per fixed page |
| `phases/lint-chat.ts` | upsertIndexAnnotation per written page |
| `phases/init.ts` | через runIngest (делегирование) |
| `phases/query.ts` | parseIndexAnnotations → передаёт Map в selectSeeds и llmSelectSeeds |

## Связь с `_index.md`

До этого компонента `lint.ts` перезаписывал `_index.md` плоским списком `- [[...]]`. После внедрения `wiki-index.ts` этот блок удалён — индекс поддерживается только через `upsertIndexAnnotation`.

## История изменений

- **2026-05-17** — создан как новый модуль по [[mobile-query-seed-design]].

## Связанные страницы

- [[wiki-seeds]]
- [[query-operation]]
- [[mobile-query-seed-design]]
- [[ingest-operation]]
- [[lint-operation]]
