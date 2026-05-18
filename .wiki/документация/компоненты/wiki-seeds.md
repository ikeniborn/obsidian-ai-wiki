---
wiki_status: developing
wiki_sources:
  - CLAUDE.md
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_domain: документация
wiki_keywords: [jaccard, seed, selectSeeds, scoreSeed, wiki-keywords, annotation, frontmatter, tokenize]
tags: [компонент, seeds, retrieval, jaccard]
---

# wiki-seeds

Модуль `src/wiki-seeds.ts` — Jaccard-scoring для выбора seed-страниц wiki при операции `query`.

## Назначение

`selectSeeds()` ранжирует wiki-страницы по близости к вопросу пользователя. Результат — список seed-страниц для LLM-промпта. Если Jaccard находит ≥1 seed — LLM seed call пропускается полностью.

## Основные характеристики

### Публичный API

```typescript
export function tokenize(s: string): Set<string>

export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,   // из _index.md (опционально)
): number

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>,  // pageId → annotation
): string[]
```

### Алгоритм скоринга (scoreSeed)

Токены кандидата = объединение:
1. `pageId` — токены из имени страницы
2. `wiki_keywords` — из frontmatter (функция `parseFmKeywords`)
3. `body[500]` — первые 500 символов **тела** (после frontmatter, функция `bodyContent`)
4. `annotation` — из `_index.md` (если передан)

Скор = пересечение токенов вопроса с токенами кандидата / размер токенов вопроса.

### bodyContent (внутренняя)

```typescript
function bodyContent(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
  return (m ? m[1] : content).slice(0, 500);
}
```

Пропускает YAML-блок frontmatter. Ранее `content.slice(0, 200)` захватывал `wiki_sources`, `wiki_updated` и т.д. — Jaccard давал 0 совпадений.

### parseFmKeywords (внутренняя)

Читает поле `wiki_keywords` из frontmatter. Формат: `wiki_keywords: [токен1, токен2]`. Все токены переводятся в lowercase.

### Стоп-слова

Русские и английские функциональные слова (>2 символов) удаляются при токенизации.

## Где используется

- `phases/query` — вызывается с `indexAnnotations` из `parseIndexAnnotations(_index.md)`.
- Если `selectSeeds` возвращает пустой массив → фаза переходит к LLM fallback (`llmSelectSeeds`).

## История изменений

- **2026-05-16** — создана страница (CLAUDE.md).
- **2026-05-17** — обновлено по спецификации [[mobile-query-seed-design]]: bodyContent пропускает frontmatter (200→500 символов), добавлен parseFmKeywords, расширены сигнатуры scoreSeed/selectSeeds.

## Связанные страницы

- [[wiki-index]]
- [[wiki-graph-cache]]
- [[query-operation]]
- [[mobile-query-seed-design]]
- [[llm-wiki-view]]
