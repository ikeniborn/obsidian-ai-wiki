---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-chat-after-all-operations-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - chat
  - ui
aliases:
  - "Universal Chat"
  - "Chat для всех операций"
---

# Chat After All Operations (чат после ingest и query)

Расширение чат-секции: теперь она показывается не только после `lint`, но и после `ingest`, `query`, `query-save`. Чат сбрасывается при старте любой новой операции. `lintChat()` переименовывается в `chat()`.

## Основные характеристики

- **Расширение условия**: `CHAT_OPS = ["lint", "ingest", "query", "query-save"]`; условие — `entry.status === "done" && entry.finalText`
- **`lastContext`**: заменяет `lastLint`; хранит `{ operation, domainId, report }` для передачи в чат
- **Сброс при старте**: `setRunning()` удаляет `chatSection`, обнуляет `lastContext` и `chatHistory`
- **`domainId` в `RunHistoryEntry`**: новое опциональное поле; заполняется в `dispatch()`; обратно совместимо
- **`operationHeader`**: генерируется контроллером из `OPERATION_LABELS`; передаётся в `runLintChat()` как параметр
- **Промпт `chat.md`**: переменные `{{domain_header}}` → `{{operation_header}}`, `{{lint_report}}` → `{{context}}`

## Связанные концепции

- [[chat-feedback]]
- [[view-ts]]
- [[controller-ts]]
