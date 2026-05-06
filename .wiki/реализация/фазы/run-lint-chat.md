---
wiki_sources: ["src/phases/chat.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-utils-ts]]"
  - "[[run-event]]"
  - "[[llm-client]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["chat.ts", "runLintChat", "chat phase"]
---
# runLintChat (phases/chat.ts)

Фазовая функция чат-режима после операций. Принимает историю сообщений и контекст (результат предыдущей операции), формирует системный промпт, выполняет streaming-запрос к LLM.

## Основные характеристики

- **Расположение:** `src/phases/chat.ts`
- **Функция:** `runLintChat(llm, model, domain, signal, opts, context, history, operationHeader): AsyncGenerator<RunEvent>`
- **Промпт:** `prompts/chat.md` — встраивается через esbuild text-loader

### Параметры

| Параметр | Тип | Назначение |
|---------|-----|-----------|
| `llm` | `LlmClient` | Backend для LLM-запросов |
| `model` | `string` | Модель (передаётся в `buildChatParams`) |
| `domain` | `DomainEntry \| undefined` | Домен (не используется в текущей реализации, зарезервирован) |
| `signal` | `AbortSignal` | Прерывание операции |
| `opts` | `LlmCallOptions` | Дополнительные параметры LLM (temperature, maxTokens) |
| `context` | `string` | Результат предыдущей операции (lint report и т.д.) |
| `history` | `ChatMessage[]` | История диалога |
| `operationHeader` | `string` | Заголовок операции для системного промпта |

### Поток выполнения

1. Рендерит `chat.md` через `render(chatTemplate, { operation_header, context })`
2. Строит messages: `[system, ...history]`
3. Вызывает `buildChatParams`, запускает streaming
4. При каждом chunk: если есть reasoning → `assistant_text` с `isReasoning: true`; если content → `assistant_text` + накапливает `fullText`
5. Fallback: при ошибке streaming — non-streaming запрос
6. Yield `result` с накопленным текстом и `durationMs`

## Связанные концепции

- [[llm-utils-ts]] — `buildChatParams`, `extractStreamDeltas`
- [[run-event]] — события `assistant_text`, `result`
- [[llm-client]] — интерфейс backend
