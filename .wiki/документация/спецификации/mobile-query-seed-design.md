---
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_status: mature
wiki_keywords: [mobile, query, seed, jaccard, wiki-keywords, index-annotations, timeout]
tags: [спецификация, query, mobile, seed-selection]
---

# Mobile Query Seed Selection — Design

Спецификация устраняет таймаут мобильного `query` на этапе seed selection: исправляет Jaccard-алгоритм и обогащает индекс семантическими аннотациями.

## Основные характеристики

**Дата:** 2026-05-17  
**Статус:** approved  
**Ветка:** dev

### Проблема

На мобильном (native-agent, облачная LLM) запрос завершается по таймауту на шаге seed selection.

**Root causes:**
1. `content.slice(0, 200)` захватывает YAML-блок frontmatter (не семантический текст) → Jaccard всегда 0 → LLM seed call всегда запускается.
2. LLM seed prompt содержит список всех ID страниц + полный `_index.md` (тысячи токенов при 100+ страницах).
3. `_index.md` — плоский список без семантических аннотаций.
4. Два LLM-запроса в одном таймаут-бюджете: seed call + основной запрос.

### Решение (два слоя)

**Слой 1: исправить Jaccard** (`src/wiki-seeds.ts`) — мгновенный выигрыш.  
**Слой 2: обогатить данные** (`src/wiki-index.ts` + `_index.md`) — стратегический.

## Модель данных

### `wiki_keywords` во frontmatter

```yaml
wiki_keywords: [deepseek, flash, языковая-модель, инференс, облако]
```

- 5–10 токенов на языке домена, строчные, дефис вместо пробела.
- LLM проставляет при ingest/lint/init.
- Существующие страницы работают без поля (Jaccard graceful fallback).

### `_index.md` — новый формат

```
PageId: однострочная аннотация 10-15 слов
ДипСик: быстрая языковая модель для инференса в облаке
```

Аннотацию генерирует LLM как поле `annotation` в выходном JSON.

## Изменения `src/wiki-seeds.ts`

- `bodyContent()` — пропускает YAML-блок, читает 500 символов тела.
- `parseFmKeywords()` — парсит `wiki_keywords` из frontmatter.
- `scoreSeed(q, pageId, content, annotation?)` — расширенная сигнатура.
- `selectSeeds(q, pages, topK, minScore, indexAnnotations?)` — расширенная сигнатура.

Токены для скоринга: `pageId` + `wiki_keywords` + `body[500]` + `annotation`.

## Новый компонент `src/wiki-index.ts`

```typescript
parseIndexAnnotations(content: string): Map<string, string>
upsertIndexAnnotation(vaultTools, wikiFolder, pageId, annotation): Promise<void>
```

## Обновление операций

Все четыре операции (ingest, lint, lint-chat, init) добавляют поле `annotation` в выходной JSON и вызывают `upsertIndexAnnotation` после записи каждой страницы.

`lint.ts` удаляет старую перезапись `_index.md` плоским списком ссылок `- [[...]]`.

## Query phase

```
Вопрос
  → Jaccard(wiki_keywords + body[500] + index annotations)
      ├── нашёл seeds → bfsExpand → LLM  ← основной путь (быстро)
      └── 0 seeds → llmSelectSeeds(аннотированный индекс)  ← fallback
```

**DoD:** LLM seed call не вызывается на ≥80% запросов (Jaccard находит ≥1 seed).

## Scope

| Файл | Изменение |
|---|---|
| `src/wiki-seeds.ts` | Skip frontmatter, wiki_keywords, indexAnnotations |
| `src/wiki-index.ts` | Новый: parseIndexAnnotations, upsertIndexAnnotation |
| `src/phases/query.ts` | Передать indexAnnotations, упростить seed prompt |
| `src/phases/ingest.ts` | upsertIndexAnnotation после записи |
| `src/phases/lint.ts` | upsertIndexAnnotation + удалить flat index rewrite |
| `src/phases/lint-chat.ts` | upsertIndexAnnotation после записи |
| `src/phases/init.ts` | покрывается через runIngest |
| `src/phases/zod-schemas.ts` | Поле `annotation?` в LintChatSchema.pages |
| `prompts/ingest.md`, `prompts/lint.md`, `prompts/init.md`, `prompts/init-incremental.md` | wiki_keywords + annotation |

## Out of scope

- Embedding-based semantic search
- Изменение `_wiki_schema.md`
- Изменение timeout defaults

## История изменений

- **2026-05-17** — создана спецификация (источник: `docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md`); все findings check-spec помечены fixed.

## Связанные страницы

- [[wiki-seeds]]
- [[wiki-index]]
- [[query-operation]]
- [[mobile-query-seed-plan]]
- [[ingest-operation]]
- [[lint-operation]]
