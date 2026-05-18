---
wiki_sources:
  - "[[docs/superpowers/plans/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_status: mature
wiki_keywords: [mobile, query, seed, plan, tdd, jaccard, wiki-index, annotation]
tags: [план, query, mobile, seed-selection, реализация]
---

# Mobile Query Seed Selection — Implementation Plan

Реализационный план для [[mobile-query-seed-design]]. 8 задач, TDD-подход.

## Основные характеристики

**Цель:** устранить таймауты мобильного query; Jaccard пропускает LLM seed call на ≥80% запросов.

**Архитектура:** два слоя — (1) `wiki-seeds.ts` читает body-текст (не frontmatter) + `wiki_keywords`; (2) `wiki-index.ts` поддерживает аннотированный `_index.md`.

**Tech Stack:** TypeScript, Vitest, `VaultTools`.

## Файловая структура

**Создаются:**
- `src/wiki-index.ts` — `parseIndexAnnotations`, `upsertIndexAnnotation`
- `tests/wiki-index.test.ts`

**Изменяются:**
- `src/wiki-seeds.ts` — bodyContent, parseFmKeywords, scoreSeed/selectSeeds signatures
- `src/phases/zod-schemas.ts` — `annotation?` в LintChatSchema.pages
- `src/phases/ingest.ts` — parseJsonPages с annotation; upsertIndexAnnotation per page
- `src/phases/lint.ts` — upsertIndexAnnotation; удалить flat index rewrite (строки 211-217)
- `src/phases/lint-chat.ts` — upsertIndexAnnotation per written page
- `src/phases/query.ts` — indexAnnotations → selectSeeds; упрощённый LLM seed prompt
- `prompts/ingest.md`, `prompts/lint.md`, `prompts/init.md`, `prompts/init-incremental.md`

## Задачи

### Task 1: `src/wiki-seeds.ts` — frontmatter skip + wiki_keywords + annotation

TDD: написать тесты → запустить (FAIL) → реализовать → запустить (PASS) → commit.

Ключевые тесты: скоринг по keywords в frontmatter; 0 баллов если keyword только в frontmatter YAML; annotation учитывается; backward compat без annotation; `selectSeeds` с `indexAnnotations`.

Commit: `feat(seeds): skip frontmatter, add wiki_keywords + annotation scoring`

### Task 2: `src/wiki-index.ts` — parseIndexAnnotations + upsertIndexAnnotation

TDD: создать `tests/wiki-index.test.ts` → FAIL → реализовать `src/wiki-index.ts` → PASS.

9 тестов: парсинг строк `PageId: annotation`; игнор строк без двоеточия; upsert (append, replace, create-from-empty); запись в правильный путь `_index.md`.

Commit: `feat(index): parseIndexAnnotations + upsertIndexAnnotation`

### Task 3: `src/phases/zod-schemas.ts` — поле annotation

Добавить `annotation: z.string().optional()` в `LintChatSchema.pages`. TDD.

Commit: `feat(schemas): add optional annotation field to LintChatSchema pages`

### Task 4: `src/phases/ingest.ts` — annotation + upsertIndexAnnotation

`parseJsonPages` возвращает `annotation?`. После записи страницы — `upsertIndexAnnotation`. Удалить `updateIndex` call из `runIngest`.

**Примечание:** `init.ts` делегирует запись к `runIngest`, поэтому отдельного изменения `init.ts` не требуется.

Commit: `feat(ingest): upsertIndexAnnotation per page, parseJsonPages includes annotation`

### Task 5: `src/phases/lint.ts` — upsertIndexAnnotation + удалить flat rewrite

Добавить `upsertIndexAnnotation` после каждой исправленной страницы. Удалить блок перезаписи `_index.md` с `- [[...]]` ссылками (строки ~210-217).

Commit: `feat(lint): upsertIndexAnnotation per fixed page, remove flat index rewrite`

### Task 6: `src/phases/lint-chat.ts` — upsertIndexAnnotation per written page

Добавить `upsertIndexAnnotation` после `vaultTools.write(page.path, page.content)`.

Commit: `feat(lint-chat): upsertIndexAnnotation per written page`

### Task 7: `src/phases/query.ts` — indexAnnotations + упрощённый seed prompt

Парсить `_index.md` → `indexAnnotations`. Передать в `selectSeeds`. Упростить `llmSelectSeeds` prompt: аннотированный индекс вместо двух дублирующихся списков bare IDs. Обновить сигнатуру `llmSelectSeeds` (принимает `Map<string, string>` вместо строки).

Commit: `feat(query): pass indexAnnotations to selectSeeds, simplify LLM seed prompt`

### Task 8: Обновление промптов

`prompts/ingest.md`: `wiki_keywords` в ПРАВИЛА + `annotation` в выходном JSON.  
`prompts/lint.md`: добавить инструкцию про `wiki_keywords` и `annotation`.  
`prompts/init.md`: секция Wiki Page Conventions с `wiki_keywords`.  
`prompts/init-incremental.md`: аналогично.

Commit: `feat(prompts): add wiki_keywords + annotation to ingest/lint/init prompts`

## Покрытие спецификации

| Требование спецификации | Задача |
|---|---|
| bodyContent пропускает frontmatter, 500 символов | Task 1 |
| parseFmKeywords извлекает wiki_keywords | Task 1 |
| scoreSeed с annotation? | Task 1 |
| selectSeeds с indexAnnotations? | Task 1 |
| parseIndexAnnotations → Map | Task 2 |
| upsertIndexAnnotation | Task 2 |
| annotation? в LintChatSchema | Task 3 |
| parseJsonPages с annotation? | Task 4 |
| ingest: upsertIndexAnnotation per page | Task 4 |
| ingest: удалить updateIndex | Task 4 |
| lint: upsertIndexAnnotation per fixed page | Task 5 |
| lint: удалить flat rewrite | Task 5 |
| lint-chat: upsertIndexAnnotation | Task 6 |
| query: indexAnnotations → selectSeeds | Task 7 |
| query: упрощённый LLM seed prompt | Task 7 |
| Промпты: wiki_keywords + annotation | Task 8 |
| DoD ≥80% без LLM seed call | Task 7 тест |

## История изменений

- **2026-05-17** — создан план (источник: `docs/superpowers/plans/2026-05-17-mobile-query-seed-design.md`); все findings check-plan помечены fixed/accepted.

## Связанные страницы

- [[mobile-query-seed-design]]
- [[wiki-seeds]]
- [[wiki-index]]
- [[query-operation]]
- [[ingest-operation]]
- [[lint-operation]]
