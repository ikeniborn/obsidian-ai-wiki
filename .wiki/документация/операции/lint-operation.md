---
wiki_status: developing
wiki_sources:
  - README.md
  - prompts/lint.md
wiki_updated: 2026-05-17
wiki_domain: документация
wiki_keywords: [lint, audit, quality, upsertIndexAnnotation, annotation, wiki-keywords, fix]
wiki_outgoing_links:
  - "[[fix-operation]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
  - "[[reasoning-first-json]]"
  - "[[wiki-index]]"
tags: [операция, lint, качество, аудит]
aliases: ["lint operation", "аудит вики"]
---

# Lint Operation

Проверяет качество и актуальность wiki-домена: находит неполные, устаревшие и несвязанные страницы.

## Назначение

Обеспечивает поддержание wiki в актуальном состоянии. Результат — отчёт о проблемах в боковой панели, на основе которого можно запустить [[fix-operation]].

## UX-поток

1. `Command Palette` → `AI Wiki: Lint домена`.
2. Агент проверяет все страницы домена.
3. Отчёт отображается в боковой панели.
4. Кнопка **Fix** в панели запускает [[fix-operation]] для автоматического исправления найденных проблем.

## LLM-промпт (lint.md)

Промпт выступает в роли рецензента wiki-домена. Фокус: дублирование страниц, пробелы в покрытии, размытые определения, устаревший контент.

Входные данные:
- `{{domain_name}}` — название домена
- `{{entity_types_block}}` — текущие entity_types из domain-map

Выходной JSON (поле `reasoning` первым):
```json
{
  "reasoning": "...",
  "entity_types": [...],
  "language_notes": "..."
}
```

Результат используется для уточнения `entity_types` домена по итогам lint-анализа. Паттерн ответа: [[reasoning-first-json]].

## Обновление индекса

После каждой исправленной страницы вызывается `upsertIndexAnnotation` ([[wiki-index]]) — добавляет/обновляет `PageId: annotation` в `_index.md`. Ранее `lint.ts` перезаписывал `_index.md` плоским списком `- [[...]]`; этот блок удалён.

LLM возвращает JSON-массив с полями `path`, `content`, `annotation`:
- `wiki_keywords` — добавлять/обновлять во frontmatter.
- `annotation` — одно предложение, описание для поиска.

## Ограничения платформы

Только desktop.

## История изменений

- **2026-05-15** — создана страница (README.md, prompts/lint.md).
- **2026-05-17** — обновлено по [[mobile-query-seed-design]]: upsertIndexAnnotation per fixed page, удалён flat index rewrite, добавлено описание annotation в промпте.

## Связанные страницы

- [[fix-operation]]
- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[reasoning-first-json]]
- [[wiki-index]]
- [[mobile-query-seed-design]]
