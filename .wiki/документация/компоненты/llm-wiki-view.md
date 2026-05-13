---
wiki_status: developing
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [компонент, view, ui, obsidian]
---

# LlmWikiView

Боковая панель Obsidian (ItemView). Рендерит прогресс операций в реальном времени, историю запусков, чат и preview форматирования.

## Назначение

`LlmWikiView` (`src/view.ts`) получает события `RunEvent` через `appendEvent()` и немедленно обновляет DOM. Не хранит состояние операции — только рендер.

## Ключевые UI-блоки

| Блок | Описание |
|---|---|
| Domain select + action row | Выбор домена, кнопки Ingest/Lint/Format |
| Progress section | Шаги операции (Read, Write, thinking) |
| Result block | Итоговый текст и метрики |
| Format preview | Отчёт об изменениях + Apply/Cancel/Refine chat |
| History | Список предыдущих запусков (лимит 20) |

## Mobile UI gating (v0.1.68)

На mobile не создаются элементы: `domainSelect`, `initBtn`, `ingestBtn`, `lintBtn`, `formatBtn`. Весь код использует optional chaining (`this.formatBtn?.disabled = true`). Секции «Создание домена» и «Наполнение/Актуализация» обёрнуты `if (!Platform.isMobile)`. На mobile остаются только Query-блок, чат и история.

## Format preview

При событии `format_preview` вызывается `renderFormatPreview(tempPath, report, missingTokens)`:
- Ссылка на temp-файл (`!Temp/<name>.formatted.md`)
- Markdown-отчёт об изменениях
- Warning с раскрываемым `<details>` если `missingTokens.length > 0`
- Кнопки Apply/Cancel
- Чат-textarea для refine

## Связанные страницы

- [[wiki-controller]]
- [[format-operation]]
- [[async-generator-events]]
