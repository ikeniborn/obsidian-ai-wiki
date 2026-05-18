---
review:
  spec_hash: f6152796d498fe2a
  last_run: 2026-05-17
  phases:
    structure:
      status: passed
    coverage:
      status: passed
    clarity:
      status: passed
    consistency:
      status: passed
  section_hashes:
    "## Problem": a32859311451c54f
    "### Root causes": 93376d9425044ccb
    "## Solution": cbb04d16afddc1dd
    "### 1. Data model": d96e3c6fa7c196da
    "### 2. Jaccard improvements (`src/wiki-seeds.ts`)": 2b82dbdbe6e0ddf1
    "### 3. Изменения LLM-промптов и фаз": 6754a65053459f4b
    "### 4. Query phase": 9d948236ccbb1c0e
    "### 5. Результирующий поток на мобильном": 69638454da8d43db
    "## Scope": a1f6bb6a6e8146a4
    "## Out of scope": 0c1b0d8f96d2db61
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "### 3. Изменения LLM-промптов и фаз"
      section_hash: 6754a65053459f4b
      text: "«Все три операции (ingest, lint, init)» в §3 противоречит таблице Scope — lint-chat.ts включён как 4-й файл с upsertIndexAnnotation. Либо §3 должен называть 4 операции, либо lint-chat убрать из Scope."
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "### 4. Query phase"
      section_hash: 9d948236ccbb1c0e
      text: "«Размер seed-промпта на мобильном падает в разы» — нет количественного критерия приёмки. DoD отсутствует."
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-003
      phase: clarity
      severity: INFO
      section: "## Scope"
      section_hash: a1f6bb6a6e8146a4
      text: "lint-chat.ts требует upsertIndexAnnotation в Scope, но нет prompts/lint-chat.md. Неясно — использует ли lint-chat lint.md промпт или нужен собственный."
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-004
      phase: clarity
      severity: INFO
      section: "### 5. Результирующий поток на мобильном"
      section_hash: 69638454da8d43db
      text: "`bfsExpand` и `llmSelectSeeds` упомянуты без определения — существующие функции или новые?"
      verdict: fixed
      verdict_at: 2026-05-17
---

# Mobile Query Seed Selection — Design

**Date:** 2026-05-17  
**Status:** approved  
**Branch:** dev

## Problem

На мобильном (native-agent, облачная LLM) запрос завершается по таймауту на шаге seed selection. Доступ к LLM подтверждён через настройки.

### Root causes

1. **Jaccard читает frontmatter вместо тела.** `content.slice(0, 200)` захватывает YAML-блок (`wiki_sources`, `wiki_updated` и т.д.), а не семантический текст. Результат: всегда 0 совпадений → LLM seed call всегда.
2. **LLM seed call с огромным промптом.** Промпт включает список всех ID страниц + полный `_index.md` (плоский список имён). При 100+ страницах — тысячи токенов, медленно на мобильной сети.
3. **`_index.md` — плоский список без аннотаций.** Ни Jaccard, ни LLM не получают семантического сигнала о содержимом страниц.
4. **Два LLM-запроса в одном таймаут-бюджете:** seed call + основной запрос.

## Solution

Два слоя улучшений: **исправить Jaccard** (мгновенный выигрыш) + **обогатить данные** (стратегический).

### 1. Data model

#### `wiki_keywords` во frontmatter

Каждая страница получает поле `wiki_keywords`:

```yaml
---
wiki_sources: ["[[...]]"]
wiki_updated: 2026-05-17
wiki_status: mature
wiki_keywords: [deepseek, flash, языковая-модель, инференс, облако]
tags: []
---
```

- 5–10 токенов на языке домена, строчные, дефис вместо пробела
- LLM проставляет при ingest/lint/init (та же модель, что запускает операцию)
- Существующие страницы работают без ключевых слов (Jaccard graceful fallback)

#### `_index.md` — новый формат

```
PageName: однострочная аннотация 10-15 слов
ДипСик: быстрая языковая модель для инференса в облаке
Кластеризация: алгоритм группировки данных без учителя
```

Формат: `PageId: annotation text` (одна строка на статью).  
Аннотацию генерирует LLM как часть ответа (поле `annotation` в выходном JSON), используя модель текущей операции — не эвристика.

### 2. Jaccard improvements (`src/wiki-seeds.ts`)

**Пропускаем frontmatter:**
```typescript
function bodyContent(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
  return (m ? m[1] : content).slice(0, 500); // было 200
}
```

**Читаем `wiki_keywords`:**
```typescript
function parseFmKeywords(content: string): Set<string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return new Set();
  const kw = m[1].match(/wiki_keywords:\s*\[(.*?)\]/);
  if (!kw) return new Set();
  return new Set(kw[1].split(",").map(s => s.trim().replace(/['"]/g, "")));
}
```

**Расширенные сигнатуры:**
```typescript
export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,   // из _index.md
): number

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>, // pageId → annotation
): string[]
```

Токены для scoring: `pageId` + `wiki_keywords` + `body(500 chars)` + `annotation`.

### 3. Изменения LLM-промптов и фаз

#### Выходной JSON — поле `annotation`

Все четыре операции (ingest, lint, lint-chat, init) добавляют поле `annotation` в выходной JSON:

```json
[{
  "path": "wiki/Domain/PageName.md",
  "content": "---\nwiki_keywords: [ключ1, ключ2]\n...\n---\n# PageName\n...",
  "annotation": "Краткое описание сущности 10-15 слов для поиска"
}]
```

Инструкция в промпте: `"annotation": одно предложение, описывающее сущность для контекстного поиска`.

#### Операции обновляют `_index.md`

```
ingest.ts    → upsertIndexAnnotation(wikiFolder, pageId, annotation)
lint.ts      → upsertIndexAnnotation(wikiFolder, pageId, annotation)
lint-chat.ts → upsertIndexAnnotation(wikiFolder, pageId, annotation)
init.ts      → upsertIndexAnnotation(wikiFolder, pageId, annotation)
```

#### Новая утилита `src/wiki-index.ts`

```typescript
// Парсинг _index.md → Map<pageId, annotation>
export function parseIndexAnnotations(content: string): Map<string, string>

// Upsert строки `PageId: annotation` в _index.md
export function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pageId: string,
  annotation: string,
): Promise<void>
```

#### Промпты ingest/lint/init

Добавить в правила frontmatter:
```
- wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]
```

Добавить в описание выходного формата:
```
- "annotation": одно предложение — описание сущности для поиска по смыслу
```

### 4. Query phase

**Парсинг индекса:**
```typescript
const indexAnnotations = parseIndexAnnotations(indexContent);
let seeds = selectSeeds(question, pages, topK, minScore, indexAnnotations);
```

**Упрощение LLM seed prompt:**  
Основа — индекс с аннотациями. Страницы, которых нет в индексе (свежие, ещё не ingested), добавляются как bare IDs.

```
// Было:
Available wiki pages: PageA, PageB, ..., PageN
Index: <flat list of names>

// Стало:
Wiki index with annotations:
<PageId: annotation per line>

Pages not yet indexed: PageX, PageY
```

Основной выигрыш — Jaccard-first путь исключает LLM seed call на большинстве запросов. При LLM fallback: seed-промпт содержит единый аннотированный индекс вместо двух дублирующихся списков bare IDs, что даёт семантический сигнал при сопоставимом объёме токенов. DoD: LLM seed call не вызывается на ≥80% запросов (Jaccard находит ≥1 seed). Покрытие полное.

### 5. Результирующий поток на мобильном

```
Вопрос
  → Jaccard(wiki_keywords + body[500] + index annotations)
      ├── нашёл seeds → bfsExpand → основной LLM-запрос  ← основной путь (быстро)
      └── 0 seeds → llmSelectSeeds(индекс с аннотациями)  ← fallback
```

`bfsExpand` и `llmSelectSeeds` — существующие функции в `src/phases/query.ts`, не изменяются этой спецификацией.

## Scope

| Файл | Изменение |
|---|---|
| `src/wiki-seeds.ts` | Skip frontmatter, wiki_keywords, indexAnnotations |
| `src/wiki-index.ts` | Новый файл: parseIndexAnnotations, upsertIndexAnnotation |
| `src/phases/query.ts` | Передать indexAnnotations в selectSeeds, упростить seed prompt |
| `src/phases/ingest.ts` | upsertIndexAnnotation после записи страницы |
| `src/phases/lint.ts` | upsertIndexAnnotation после записи страницы |
| `src/phases/lint-chat.ts` | upsertIndexAnnotation после записи страницы; использует тот же `prompts/lint.md` промпт |
| `src/phases/init.ts` | upsertIndexAnnotation для каждой страницы |
| `prompts/ingest.md` | wiki_keywords + annotation в правилах и выходном формате |
| `prompts/lint.md` | wiki_keywords + annotation |
| `prompts/init.md` | wiki_keywords + annotation |
| `prompts/init-incremental.md` | wiki_keywords + annotation |
| `src/phases/zod-schemas.ts` | Добавить поле annotation в схему выходных данных |

## Out of scope

- Изменение формата `_wiki_schema.md`
- Embedding-based semantic search
- Изменение timeout defaults (проблема устраняется архитектурно)
- Per-call timeout для seed LLM call
