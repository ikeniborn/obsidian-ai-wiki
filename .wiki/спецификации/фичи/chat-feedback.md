---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-chat-feedback-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - ui
  - chat
aliases:
  - "Animated Bubble Timer"
  - "Collapsible Chat"
---

# Chat Feedback (анимированный таймер + сворачиваемый чат)

Три улучшения чат-режима: показ elapsed time в пузыре ответа до появления первого токена, запись чат-событий в JSONL-лог, и сворачиваемая секция чата по аналогии с Result и History.

## Основные характеристики

- **Animated timer**: поля `chatTickHandle` и `chatStartTs` в `LlmWikiView`; при `setChatRunning()` запускается `setInterval(500ms)` → обновляет пузырь `⏳ X.Xs…`; при первом `assistant_text` таймер гасится и пузырь очищается
- **JSONL logging**: `dispatchChat()` логирует события через существующий `logEvent()` с `op=chat`; sessionId из `Date.now()`; финальный статус `"done" | "error" | "cancelled"`
- **Collapsible chat**: поля `chatToggle`, `chatOpen`, `chatBodyEl`; заголовок `<h4>` с ▶/▼; `toggleChat()` — аналогично прогресс-блоку
- **Backend-независимость**: таймер управляется только view-методами, срабатывает одинаково для `claude-agent` и `native-agent`

## Затронутые файлы

| Файл | Изменения |
|---|---|
| `src/view.ts` | +2 поля таймера, 3 метода; +3 поля toggle, `toggleChat()`, `showChatSection()` |
| `src/controller.ts` | `dispatchChat()` — sessionId, logEvent вызовы, status tracking |

## Связанные концепции

- [[chat-after-all-operations]]
- [[view-ts]]
- [[controller-ts]]
