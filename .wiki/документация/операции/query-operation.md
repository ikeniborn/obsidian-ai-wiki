---
wiki_status: developing
wiki_sources:
  - README.md
  - CLAUDE.md
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
  - docs/TODO.md
  - docs/superpowers/specs/2026-05-23-ux-cleanup-design.md
  - docs/superpowers/plans/2026-05-23-ux-cleanup.md
wiki_updated: 2026-05-24
wiki_domain: документация
wiki_keywords: [query, seed, jaccard, index-annotations, mobile, bfsExpand, llmSelectSeeds]
tags: [операция, query, ответ, wikilinks]
---

# Query Operation

Отвечает на вопрос пользователя по базе знаний wiki. Ответ включает `[[WikiLinks]]` на использованные страницы.

## Назначение

Позволяет извлекать синтезированные знания из wiki без поиска по сотням исходных заметок.

## Варианты запуска

| Команда | Действие |
|---|---|
| `AI Wiki: Запрос` | Вопрос → ответ в боковой панели |
| Кнопка **Ask** в боковой панели | То же (desktop и mobile) |

## UX-поток

1. `Command Palette` → `AI Wiki: Запрос` или нажать **Ask** в боковой панели.
2. Ввести вопрос.
3. Агент читает релевантные wiki-страницы, при необходимости — первичные источники.
4. Ответ отображается в боковой панели с `[[WikiLinks]]` на использованные страницы.

## Удаление query-save (Task 30+, [[ux-cleanup-design]])

Операция `query-save` и кнопка "Ask and save" удалены из кодовой базы целиком. Удалены:
- `| "query-save"` из `WikiOperation` union
- addCommand `query-save` из `main.ts`
- `askSaveBtn` из `LlmWikiView`
- все ветки `query-save` в `controller.ts` и `agent-runner.ts`
- ключ `querySave` из i18n

Сигнатура `runQuery(args, save=false, ...)` сохранена без изменений.

## Ограничения платформы

Работает и на desktop, и на mobile. На мобильном — единственная доступная операция.

## Известные проблемы (docs/TODO.md)

| # | Статус | Описание |
|---|---|---|
| 7 | `[]` | Нативный агент не работает на мобильном при запуске query — при запросе ничего не происходит. Требует диагностики запуска native-agent на mobile. |
| 30 | `[!]` → реализован [[ux-cleanup-plan]] | Кнопка "Ask and save" удалена из боковой панели. `query-save` операция полностью удалена из кодовой базы. |
| 32 | `[]` | Добавить возможность повторно запускать query из истории (кнопка или действие на записи истории). |

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
- [[ux-cleanup-design]]
- [[ux-cleanup-plan]]
