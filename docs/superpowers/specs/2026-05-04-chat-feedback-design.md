# Chat Feedback & Collapsible Section

**Date:** 2026-05-04  
**Scope:** `src/view.ts`, `src/controller.ts`

## Problem

После отправки сообщения в чат-режиме (lint → chat) пользователь видит только `…` в пузыре ответа. Непонятно, началась ли работа агента. Задержка до первого токена может достигать 5–15 секунд. Также секция чата не сворачивается, в отличие от Result и History. Чат-события не попадают в лог JSONL.

## Goals

1. Показать elapsed time в пузыре до появления первого токена — независимо от выбранного бэкенда.
2. Записывать чат-события в JSONL-лог, если `agentLogPath` настроен.
3. Сделать секцию чата сворачиваемой по той же схеме, что Result и History.

## Non-Goals

- Не показывать tool_use шаги из claude-agent в чате (это отдельная задача).
- Не менять `runLintChat`, `ClaudeCliClient`, типы `RunEvent`.

---

## Design

### 1. Animated bubble timer — `view.ts`

**Новые поля класса:**
```typescript
private chatTickHandle: number | null = null;
private chatStartTs = 0;
```

**`setChatRunning()`** — после создания `currentChatBubble`:
```typescript
this.chatStartTs = Date.now();
this.chatTickHandle = window.setInterval(() => {
  if (this.currentChatBubble) {
    const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
    this.currentChatBubble.setText(`⏳ ${s}s…`);
  }
}, 500);
```

**`appendChatEvent()`** — внутри существующего `if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble)`, до записи текста:
```typescript
if (this.chatTickHandle !== null) {
  window.clearInterval(this.chatTickHandle);
  this.chatTickHandle = null;
  this.currentChatBubble.setText(""); // currentChatBubble гарантированно не null здесь
}
```

**`finishChat()`** — cleanup в любом случае (ошибка / cancel / успех):
```typescript
if (this.chatTickHandle !== null) {
  window.clearInterval(this.chatTickHandle);
  this.chatTickHandle = null;
}
```

Решение не зависит от бэкенда: таймер управляется только событиями view (`setChatRunning` / `appendChatEvent` / `finishChat`), которые вызываются одинаково для `claude-agent` и `native-agent`.

---

### 2. JSONL logging for chat — `controller.ts`

Сейчас `dispatchChat()` не логирует события. Добавляем тот же паттерн что в `dispatch()`.

**В начале `dispatchChat()`:**
```typescript
const startedAt = Date.now();
const sessionId = String(startedAt);
const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
this.logEvent(sessionId, "chat", domainId, {
  kind: "system",
  message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
});
```

**В `for await` цикле:**
```typescript
this.logEvent(sessionId, "chat", domainId, ev);
```

**В `catch`:**
```typescript
this.logEvent(sessionId, "chat", domainId, { kind: "error", message: finalText });
```

**В `finally` (после `this.current = null`):**
```typescript
this.logEvent(sessionId, "chat", domainId, {
  kind: "system",
  message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
});
```

`status` объявляется как `"done" | "error" | "cancelled"` в начале метода, по той же схеме что в `dispatch()`.

---

### 3. Collapsible chat section — `view.ts`

**Новые поля класса:**
```typescript
private chatToggle: HTMLElement | null = null;
private chatOpen = true;
private chatBodyEl: HTMLElement | null = null;
```

**`showChatSection()`** — заменяем `llm-wiki-section-label` на toggle-заголовок:
```typescript
const chatHeader = this.chatSection.createDiv("llm-wiki-progress-header");
const chatH4 = chatHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
this.chatToggle = chatH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▼" });
chatH4.appendText(` ${T.view.chatLabel}`);
chatHeader.addEventListener("click", () => this.toggleChat());

this.chatBodyEl = this.chatSection.createDiv("llm-wiki-chat-body");
this.chatMessagesEl = this.chatBodyEl.createDiv("llm-wiki-chat-messages");
const inputRow = this.chatBodyEl.createDiv("llm-wiki-chat-input-row");
// ... остальное без изменений
```

**Новый метод `toggleChat()`:**
```typescript
private toggleChat(): void {
  this.chatOpen = !this.chatOpen;
  this.chatBodyEl?.toggleClass("llm-wiki-hidden", !this.chatOpen);
  this.chatToggle?.setText(this.chatOpen ? "▼" : "▶");
}
```

**`showChatSection()`** при повторном вызове (новый lint) — сбрасывает `chatOpen = true`.

---

## Files Changed

| Файл | Изменения |
|---|---|
| `src/view.ts` | +2 поля таймера, логика в 3 методах; +3 поля toggle, `toggleChat()`, рефакторинг `showChatSection()` |
| `src/controller.ts` | `dispatchChat()` — sessionId, logEvent вызовы, status tracking |

## Testing

- Отправить сообщение в чат: пузырь должен показывать `⏳ Xs…` до первого токена
- Первый токен: таймер гасится, текст начинает стримиться
- Ошибка / отмена: таймер тоже гасится, пузырь не зависает
- При указанном `agentLogPath`: чат-события появляются в JSONL с `op=chat`
- Секция чата: заголовок кликабелен, тело скрывается/открывается, `▼/▶` переключается
- Оба бэкенда (`claude-agent`, `native-agent`): поведение одинаковое
