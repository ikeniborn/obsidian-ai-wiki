# Chat Feedback & Collapsible Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить анимированный таймер в чат-пузырь, логирование чат-событий в JSONL и сворачиваемую секцию чата.

**Architecture:** Три изолированных изменения в двух файлах. Таймер живёт полностью в `view.ts` — не зависит от бэкенда. Логирование в `controller.ts` по уже существующему паттерну `dispatch()`. Toggle-секция чата повторяет шаблон Result/History секций.

**Tech Stack:** TypeScript, Obsidian Plugin API (`window.setInterval`, `window.clearInterval`, `HTMLElement.toggleClass`)

---

## File Map

| Файл | Что меняется |
|---|---|
| `src/view.ts` | +2 поля таймера; `setChatRunning`, `appendChatEvent`, `finishChat`, `onClose`; +3 поля toggle, `toggleChat()`, `showChatSection()` |
| `src/controller.ts` | `dispatchChat()` — sessionId + logEvent вызовы |

---

### Task 1: Animated bubble timer — поля и setChatRunning

**Files:**
- Modify: `src/view.ts`

**Контекст:** Класс `LlmWikiView` уже имеет `tickHandle: number | null` для основного прогресса (строка ~51). Чат-таймер — отдельный handle, чтобы не конфликтовать. `setChatRunning()` сейчас на строке ~388 — создаёт `currentChatBubble` и ставит текст `"…"`.

- [ ] **Step 1: Добавить поля таймера в класс**

В `src/view.ts`, после поля `private currentChatBuffer = "";` (строка ~46), добавить два поля:

```typescript
private chatTickHandle: number | null = null;
private chatStartTs = 0;
```

- [ ] **Step 2: Запустить таймер в setChatRunning()**

В методе `setChatRunning()` (строка ~388), текущий код:
```typescript
setChatRunning(): void {
    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    if (this.chatInputEl) this.chatInputEl.disabled = true;
    // Создаём пустой пузырь ассистента — будем стримить в него
    this.currentChatBuffer = "";
    if (this.chatMessagesEl) {
      this.currentChatBubble = this.chatMessagesEl.createDiv("llm-wiki-chat-msg llm-wiki-chat-msg--assistant llm-wiki-chat-msg--streaming");
      this.currentChatBubble.setText("…");
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
  }
```

Заменить на:
```typescript
setChatRunning(): void {
    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    if (this.chatInputEl) this.chatInputEl.disabled = true;
    this.currentChatBuffer = "";
    if (this.chatMessagesEl) {
      this.currentChatBubble = this.chatMessagesEl.createDiv("llm-wiki-chat-msg llm-wiki-chat-msg--assistant llm-wiki-chat-msg--streaming");
      this.currentChatBubble.setText("…");
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
    this.chatStartTs = Date.now();
    this.chatTickHandle = window.setInterval(() => {
      if (this.currentChatBubble) {
        const s = ((Date.now() - this.chatStartTs) / 1000).toFixed(1);
        this.currentChatBubble.setText(`⏳ ${s}s…`);
      }
    }, 500);
  }
```

- [ ] **Step 3: Сommit**

```bash
git add src/view.ts
git commit -m "feat: add chat bubble timer fields and setChatRunning timer start"
```

---

### Task 2: Остановить таймер в appendChatEvent и finishChat

**Files:**
- Modify: `src/view.ts`

**Контекст:** `appendChatEvent()` строка ~400. Нужно гасить таймер при первом токене. `finishChat()` строка ~408 — cleanup при любом исходе (ошибка, cancel, успех). `onClose()` строка ~159 — уже чистит `tickHandle`, добавить `chatTickHandle`.

- [ ] **Step 1: Остановить таймер в appendChatEvent при первом токене**

Текущий `appendChatEvent()`:
```typescript
appendChatEvent(ev: RunEvent): void {
    if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble) {
      this.currentChatBuffer += ev.delta;
      this.currentChatBubble.setText(this.currentChatBuffer);
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
  }
```

Заменить на:
```typescript
appendChatEvent(ev: RunEvent): void {
    if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble) {
      if (this.chatTickHandle !== null) {
        window.clearInterval(this.chatTickHandle);
        this.chatTickHandle = null;
        this.currentChatBubble.setText("");
      }
      this.currentChatBuffer += ev.delta;
      this.currentChatBubble.setText(this.currentChatBuffer);
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
  }
```

- [ ] **Step 2: Добавить cleanup таймера в finishChat()**

Текущий `finishChat()` начинается так (строка ~408):
```typescript
finishChat(msg: ChatMessage, isError: boolean): void {
    if (this.chatSendBtn) this.chatSendBtn.disabled = false;
    if (this.chatInputEl) { this.chatInputEl.disabled = false; this.chatInputEl.focus(); }
    if (this.currentChatBubble) {
```

Добавить в самое начало метода, перед первым `if`:
```typescript
finishChat(msg: ChatMessage, isError: boolean): void {
    if (this.chatTickHandle !== null) {
      window.clearInterval(this.chatTickHandle);
      this.chatTickHandle = null;
    }
    if (this.chatSendBtn) this.chatSendBtn.disabled = false;
    if (this.chatInputEl) { this.chatInputEl.disabled = false; this.chatInputEl.focus(); }
    if (this.currentChatBubble) {
```

- [ ] **Step 3: Добавить cleanup chatTickHandle в onClose()**

Текущий `onClose()`:
```typescript
onClose(): void {
    if (this.tickHandle !== null) window.clearInterval(this.tickHandle);
  }
```

Заменить на:
```typescript
onClose(): void {
    if (this.tickHandle !== null) window.clearInterval(this.tickHandle);
    if (this.chatTickHandle !== null) window.clearInterval(this.chatTickHandle);
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat: stop chat timer on first token and on cleanup"
```

---

### Task 3: JSONL logging в dispatchChat()

**Files:**
- Modify: `src/controller.ts`

**Контекст:** `dispatchChat()` строки 55–100. Метод уже имеет `startedAt`, `finalText`, `status` переменные (добавлены в рамках текущей реализации). `logEvent()` — приватный метод строки ~173, принимает `(sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent)`.

Текущий `dispatchChat()`:
```typescript
private async dispatchChat(domainId: string, lintReport: string, chatMessages: ChatMessage[]): Promise<void> {
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultBasePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const vaultName = this.app.vault.getName();
    const vaultSuffix = `/vaults/${vaultName}`;
    const repoRoot = vaultBasePath.endsWith(vaultSuffix)
      ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
      : vaultBasePath;

    const agentRunner = this.buildAgentRunner(repoRoot);
    const ctrl = new AbortController();
    this.current = ctrl;

    const startedAt = Date.now();
    let finalText = "";
    let status: "done" | "error" | "cancelled" = "done";

    view.setChatRunning();

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: repoRoot,
      signal: ctrl.signal, timeoutMs, domainId, context: lintReport, chatMessages,
    });

    try {
      for await (const ev of runGen) {
        view.appendChatEvent(ev);
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "error") status = "error";
      }
    } catch (err) {
      status = "error";
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
    } finally {
      this.current = null;
    }

    view.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }
```

- [ ] **Step 1: Добавить sessionId и log start/loop/catch/finish**

Заменить `dispatchChat()` целиком:
```typescript
private async dispatchChat(domainId: string, lintReport: string, chatMessages: ChatMessage[]): Promise<void> {
    if (this.isBusy()) { new Notice(i18n().ctrl.operationRunning); return; }
    if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;

    await this.ensureView();
    const view = this.activeView();
    if (!view) return;

    const vaultBasePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    const vaultName = this.app.vault.getName();
    const vaultSuffix = `/vaults/${vaultName}`;
    const repoRoot = vaultBasePath.endsWith(vaultSuffix)
      ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
      : vaultBasePath;

    const agentRunner = this.buildAgentRunner(repoRoot);
    const ctrl = new AbortController();
    this.current = ctrl;

    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
    let finalText = "";
    let status: "done" | "error" | "cancelled" = "done";

    this.logEvent(sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`,
    });

    view.setChatRunning();

    const timeoutMs = this.plugin.settings.timeouts.lint * 1000;
    const runGen = agentRunner.run({
      operation: "chat", args: [], cwd: repoRoot,
      signal: ctrl.signal, timeoutMs, domainId, context: lintReport, chatMessages,
    });

    try {
      for await (const ev of runGen) {
        this.logEvent(sessionId, "chat", domainId, ev);
        view.appendChatEvent(ev);
        if (ev.kind === "result") finalText = ev.text;
        if (ev.kind === "error") status = "error";
      }
    } catch (err) {
      status = "error";
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      this.logEvent(sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
    }

    this.logEvent(sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`,
    });

    view.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/controller.ts
git commit -m "feat: add JSONL logging to dispatchChat"
```

---

### Task 4: Collapsible chat section — поля и toggleChat()

**Files:**
- Modify: `src/view.ts`

**Контекст:** Поля класса в начале файла. Метод `showChatSection()` строка ~357. Паттерн toggle взят из `toggleResult()` строка ~440 и `toggleHistory()` строка ~430.

- [ ] **Step 1: Добавить поля toggle в класс**

После поля `private chatHistory: ChatMessage[] = [];` (строка ~44), добавить:
```typescript
private chatToggle: HTMLElement | null = null;
private chatOpen = true;
private chatBodyEl: HTMLElement | null = null;
```

- [ ] **Step 2: Добавить метод toggleChat()**

После метода `toggleSteps()` (строка ~450), добавить:
```typescript
private toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    this.chatBodyEl?.toggleClass("llm-wiki-hidden", !this.chatOpen);
    this.chatToggle?.setText(this.chatOpen ? "▼" : "▶");
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat: add chat section toggle fields and toggleChat method"
```

---

### Task 5: Collapsible chat section — рефакторинг showChatSection()

**Files:**
- Modify: `src/view.ts`

**Контекст:** Текущий `showChatSection()` строка ~357:
```typescript
private showChatSection(): void {
    this.chatSection?.remove();
    const T = i18n();
    this.chatSection = this.resultSection.createDiv("llm-wiki-chat-section");
    this.chatSection.createDiv({ cls: "llm-wiki-section-label", text: T.view.chatLabel });
    this.chatMessagesEl = this.chatSection.createDiv("llm-wiki-chat-messages");
    const inputRow = this.chatSection.createDiv("llm-wiki-chat-input-row");
    this.chatInputEl = inputRow.createEl("textarea", { cls: "llm-wiki-chat-input", attr: { rows: "2" } });
    this.chatSendBtn = inputRow.createEl("button", { text: T.view.chatSend, cls: "llm-wiki-chat-send" });
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastLint) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      void this.plugin.controller.lintChat(this.lastLint.domainId, this.lastLint.report, this.chatHistory, text);
    };
    this.chatSendBtn.addEventListener("click", submit);
  }
```

- [ ] **Step 1: Заменить showChatSection() на версию с toggle-заголовком**

```typescript
private showChatSection(): void {
    this.chatSection?.remove();
    this.chatOpen = true;
    const T = i18n();
    this.chatSection = this.resultSection.createDiv("llm-wiki-chat-section");

    const chatHeader = this.chatSection.createDiv("llm-wiki-progress-header");
    const chatH4 = chatHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.chatToggle = chatH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "▼" });
    chatH4.appendText(` ${T.view.chatLabel}`);
    chatHeader.addEventListener("click", () => this.toggleChat());

    this.chatBodyEl = this.chatSection.createDiv("llm-wiki-chat-body");
    this.chatMessagesEl = this.chatBodyEl.createDiv("llm-wiki-chat-messages");
    const inputRow = this.chatBodyEl.createDiv("llm-wiki-chat-input-row");
    this.chatInputEl = inputRow.createEl("textarea", { cls: "llm-wiki-chat-input", attr: { rows: "2" } });
    this.chatSendBtn = inputRow.createEl("button", { text: T.view.chatSend, cls: "llm-wiki-chat-send" });
    const submit = () => {
      const text = this.chatInputEl!.value.trim();
      if (!text || !this.lastLint) return;
      this.chatInputEl!.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      void this.plugin.controller.lintChat(this.lastLint.domainId, this.lastLint.report, this.chatHistory, text);
    };
    this.chatSendBtn.addEventListener("click", submit);
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/view.ts
git commit -m "feat: collapsible chat section with toggle header"
```

---

### Task 6: Version bump, build, ручное тестирование

**Files:**
- Modify: `package.json`, `manifest.json`

- [ ] **Step 1: Поднять patch-версию**

Прочитать текущую версию из `package.json`. Если `0.1.35` → поменять на `0.1.36` в `package.json` и `manifest.json`.

- [ ] **Step 2: Собрать плагин**

```bash
npm run build
```

Ожидаемый вывод:
```
dist/ updated: main.js, manifest.json, styles.css
```

- [ ] **Step 3: Перезагрузить плагин в Obsidian**

В Obsidian: Settings → Community Plugins → LLM Wiki → отключить → включить (или Ctrl+R если dev-режим).

- [ ] **Step 4: Проверить анимированный таймер**

1. Запустить lint на домене
2. После завершения — открыть чат
3. Отправить любое сообщение
4. Убедиться: пузырь ответа показывает `⏳ 0.5s…`, `⏳ 1.0s…` и т.д. до первого токена
5. После первого токена: таймер пропадает, текст стримится нормально
6. Проверить оба бэкенда, если доступны

- [ ] **Step 5: Проверить JSONL-лог**

1. Указать `agentLogPath` в настройках (например `/tmp/agent.jsonl`)
2. Отправить сообщение в чат
3. Проверить файл: должны появиться строки с `"op":"chat"` — start, события, finish:

```bash
grep '"op":"chat"' /tmp/agent.jsonl
```

Ожидаемые строки с `kind: "system"` (start/finish) и `kind: "assistant_text"` между ними.

- [ ] **Step 6: Проверить сворачиваемый чат**

1. После lint кликнуть на заголовок чат-секции
2. Тело (сообщения + поле ввода) скрывается, стрелка `▼` → `▶`
3. Повторный клик — разворачивается обратно
4. Повторный lint: секция чата открыта по умолчанию

- [ ] **Step 7: Commit**

```bash
git add package.json manifest.json
git commit -m "chore: bump version to 0.1.36"
```
