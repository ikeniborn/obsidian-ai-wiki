---
wiki_sources:
  - "docs/superpowers/specs/2026-04-26-progress-display-design.md"
  - "docs/superpowers/specs/2026-04-27-interactive-mode-design.md"
  - "docs/superpowers/specs/2026-04-28-obsidian-review-fixes-design.md"
  - "docs/superpowers/specs/2026-05-04-chat-feedback-design.md"
  - "docs/superpowers/specs/2026-05-05-chat-after-all-operations-design.md"
wiki_updated: 2026-05-05
wiki_status: developing
tags:
  - specs
  - component
  - typescript
  - ui
aliases:
  - "LlmWikiView"
  - "src/view.ts"
---

# src/view.ts

Obsidian `ItemView` — живой рендер операций в боковой панели. Обрабатывает RunEvent поток, управляет UI секциями (прогресс, результат, история, чат).

## Ключевые изменения по спекам

- **Collapsible progress**: поля `progressToggle`, `progressCount`, `stepsOpen`; кликабельный `<h4>`; счётчик «N шагов · X.Xs»; автосворачивание после завершения
- **System event translation**: маппинг `hook_started/hook_response/init` → человекочитаемый текст с иконкой `⚙`
- **`WikiQuestionModal`**: новый Modal для `ask_user` событий; варианты-кнопки или текстовый input; resolve/reject через ответ/Отмену
- **CSS classes**: `style.display = "none"` → `.llm-wiki-hidden` класс (требование ObsidianReviewBot); `onOpen`/`onClose` без `async`
- **Chat timer**: поля `chatTickHandle`, `chatStartTs`; `⏳ X.Xs…` в пузыре до первого токена
- **Collapsible chat**: поля `chatToggle`, `chatOpen`, `chatBodyEl`; аналогично прогресс-блоку
- **`lastContext`**: заменяет `lastLint`; содержит `{ operation, domainId, report }` для чата
- **Populate events**: рендер `populate_start/file_start/file_done` как прогресс-бар

## Связанные концепции

- [[collapsible-progress-display]]
- [[interactive-mode]]
- [[chat-feedback]]
- [[chat-after-all-operations]]
