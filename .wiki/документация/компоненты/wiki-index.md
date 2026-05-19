---
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
  - "[[docs/superpowers/plans/2026-05-17-mobile-query-seed-design.md]]"
  - "[[docs/superpowers/specs/2026-05-19-index-path-annotation-design.md]]"
  - "[[docs/superpowers/plans/2026-05-19-index-path-annotation.md]]"
wiki_updated: 2026-05-19
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

// Upsert строки в _index.md; fullPath опционален (новый формат)
export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pageId: string,
  annotation: string,
  fullPath?: string,  // добавлен в v0.1.109
): Promise<void>
```

### Формат `_index.md` (v0.1.109+)

**Новый формат** (при передаче `fullPath`):
```
pid: [[pid]] domain/category/pid.md | annotation text
```

**Старый формат** (backward compat):
```
pid: annotation text
```

Пример нового формата:
```
metadata-driven-моделирование: [[metadata-driven-моделирование]] ии/концепции/metadata-driven-моделирование.md | Подход через YAML-модели
```

- Одна строка на статью.
- Строки без двоеточия игнорируются (headers, пустые строки).
- В новом формате: split по первому ` | `, аннотация = правая часть.
- Wikilink `[[pid]]` — кликабельный в Obsidian.
- Путь `domain/category/pid.md` — для прямого доступа LLM.
- Backward compat: mixed-format файлы работают корректно.

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
- **2026-05-19** — обновлено по [[index-path-annotation-design]]: добавлен `fullPath` в `upsertIndexAnnotation`, новый формат `pid: [[pid]] path | annotation`, backward compat в `parseIndexAnnotations`.

## Связанные страницы

- [[wiki-seeds]]
- [[query-operation]]
- [[mobile-query-seed-design]]
- [[ingest-operation]]
- [[lint-operation]]
- [[index-path-annotation-design]]
- [[index-path-annotation-plan]]
