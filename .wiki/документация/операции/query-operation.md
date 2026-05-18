---
wiki_status: developing
wiki_sources:
  - README.md
  - CLAUDE.md
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_domain: документация
wiki_keywords: [query, seed, jaccard, index-annotations, mobile, bfsExpand, llmSelectSeeds]
tags: [операция, query, ответ, wikilinks]
---

# Query Operation

Отвечает на вопрос пользователя по базе знаний wiki. Опционально сохраняет ответ как новую wiki-страницу с `[[WikiLinks]]`.

## Назначение

Позволяет извлекать синтезированные знания из wiki без поиска по сотням исходных заметок. Ответ включает ссылки на использованные wiki-страницы.

## Варианты запуска

| Команда | Действие |
|---|---|
| `AI Wiki: Запрос` | Вопрос → ответ в боковой панели |
| `AI Wiki: Запрос и сохранить как страницу` | Вопрос → ответ + автоматическое открытие новой wiki-страницы |

## UX-поток

1. `Command Palette` → `AI Wiki: Запрос`.
2. Ввести вопрос.
3. Агент читает релевантные wiki-страницы, при необходимости — первичные источники.
4. Ответ отображается в боковой панели с `[[WikiLinks]]` на использованные страницы.
5. Для `query-save` — новая страница создаётся и открывается автоматически.

## Ограничения платформы

Работает и на desktop, и на mobile (единственная операция, полностью поддерживаемая на мобильных).

## Контекст для LLM

- Перед вызовом LLM фаза `query` обращается к [[wiki-graph-cache]] (`graphCache.get(domain)`) для получения графа страниц домена.
- Читает `_index.md` → `parseIndexAnnotations()` из [[wiki-index]] → `Map<pageId, annotation>`.
- Затем вызывает [[wiki-seeds]] (`selectSeeds(question, pages, topK, minScore, indexAnnotations)`), который выбирает seed-страницы по Jaccard (pageId + wiki_keywords + body[500] + annotation).
- В RunEvent поток эмитится событие `graph_stats` со статистикой выбранных seed-ов.
- Если Jaccard находит ≥1 seed → LLM seed call пропускается (основной путь, быстро).
- LLM fallback (`llmSelectSeeds`) использует аннотированный индекс вместо bare IDs.

## Поток seed selection

```
Вопрос
  → parseIndexAnnotations(_index.md)
  → selectSeeds (Jaccard: pageId + wiki_keywords + body[500] + annotation)
      ├── ≥1 seed → bfsExpand → основной LLM-запрос  ← быстро
      └── 0 seeds → llmSelectSeeds(аннотированный индекс)  ← fallback
```

## История изменений

- **2026-05-16** — создана страница.
- **2026-05-17** — обновлено по [[mobile-query-seed-design]]: добавлен поток с parseIndexAnnotations, описан Jaccard-first путь и упрощённый LLM fallback prompt.

## Связанные страницы

- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[wiki-graph-cache]]
- [[wiki-seeds]]
- [[wiki-index]]
- [[mobile-query-seed-design]]
