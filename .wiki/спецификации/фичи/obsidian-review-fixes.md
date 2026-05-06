---
wiki_sources:
  - "docs/superpowers/specs/2026-04-28-obsidian-review-fixes-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - review
  - code-quality
aliases:
  - "ObsidianReviewBot Fixes"
  - "Community Plugin Approval"
---

# Obsidian Review Fixes (исправления для публикации плагина)

Набор механических исправлений кода по замечаниям `ObsidianReviewBot` для разблокирования публикации плагина в Community Plugins. 10 категорий изменений, без архитектурных правок. Также переводит все русские строки UI на английский язык с sentence case.

## Основные характеристики

- **Union type**: `string | "all"` → `string` (literal уже является подтипом)
- **Async cleanup**: убрать `async` с методов без `await` (`toVaultPath`, `onOpen`, `onClose`)
- **Unhandled promises**: добавить `void` оператор перед fire-and-forget вызовами
- **Console**: заменить `console.log` на `console.debug` (только `console.warn/error/debug` допустимы)
- **Type assertions**: убрать лишние `as string` там где TypeScript выводит тип самостоятельно
- **Heading API**: `containerEl.createEl("h2", ...)` → `new Setting(...).setName(...).setHeading()`
- **CSS classes**: убрать inline `style.display = "none/\"\""` → добавить CSS класс `.llm-wiki-hidden`
- **Any types**: в `stream.ts` заменить `any` на `unknown`; добавить type guard `isRecord()`
- **Regex escape**: `[\p{L}\p{N}_\-]` → `[\p{L}\p{N}_-]` (лишний escape внутри `[...]`)
- **i18n**: перевод всех русских строк UI на английский, sentence case

## Связанные концепции

- [[view-ts]]
- [[stream-ts]]
