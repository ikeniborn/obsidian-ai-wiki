---
wiki_sources: [docs/superpowers/plans/2026-05-05-chat-after-all-operations.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [chat-generalize, чат-после-операций]
---
# Chat After All Operations

Фича расширяет отображение чат-секции с «только после lint» до «после любой основной операции» (ingest, query, query-save, lint). Чат сбрасывается при старте новой операции.

## Основные характеристики

- `RunHistoryEntry` получает новое поле `domainId?: string`
- `RunRequest` получает поле `operationHeader?: string` — заголовок для контекста чата
- Промпт `prompts/chat.md` обобщается: `{{domain_header}}` + `{{lint_report}}` → `{{operation_header}}` + `{{context}}`
- `lastLint` в `view.ts` переименовывается в `lastContext: { operation, domainId, report }`
- `lintChat()` в `controller.ts` переименовывается в `chat(operation, domainId, context, history, message)`
- Список операций с чатом: `["lint", "ingest", "query", "query-save"]`
- В `setRunning()` добавляется сброс: `this.lastContext = null; this.chatHistory = []`

## Маппинг operation → заголовок

```typescript
const OPERATION_LABELS = {
  lint: "Lint-проверка wiki",
  ingest: "Извлечение знаний (ingest)",
  query: "Ответ на запрос (query)",
  "query-save": "Ответ на запрос с сохранением (query-save)",
};
```
