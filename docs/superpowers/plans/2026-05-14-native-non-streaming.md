# Stream Aggregation for Native Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить три проблемы при стриминге в native-agent-режиме: раздутый счётчик шагов, DOM-трэшинг от синхронных мутаций и лишние file-I/O в лог.

**Architecture:** Три точечных исправления в двух файлах — `src/view.ts` и `src/controller.ts`. Логика фаз, типы, AgentRunner, LlmClient не затронуты. rAF-дросселирование ограничивает DOM-мутации 60fps; фильтрация в `logEvent()` устраняет 200 записей/запрос.

**Tech Stack:** TypeScript, Obsidian API (`window.requestAnimationFrame`, `window.cancelAnimationFrame`), существующие приватные поля класса `LlmWikiView`.

---

## File Map

| Файл | Что меняется |
|---|---|
| `src/view.ts` | +2 приватных поля (строки ~79–80); Fix 1: stepCount guard (строка 362); Fix 2: rAF-ветка assistant_text (строки 397–420); отмена handle в setRunning (строки ~295–299) и tool_use (строки ~364–368) |
| `src/controller.ts` | Fix 3: 1 строка early-return в `logEvent()` (строка ~478) |

---

## Task 1: Fix stepCount — исключить `assistant_text`

**Files:**
- Modify: `src/view.ts:362`

- [ ] **Step 1: Применить исправление**

В `src/view.ts` найти строку 362:

```ts
    this.stepCount++;
    if (ev.kind === "tool_use") {
```

Заменить на:

```ts
    if (ev.kind !== "assistant_text") this.stepCount++;
    if (ev.kind === "tool_use") {
```

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные, `main.js` обновлён.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): exclude assistant_text from stepCount"
```

---

## Task 2: Добавить rAF-поля в `LlmWikiView`

**Files:**
- Modify: `src/view.ts:79–80`

- [ ] **Step 1: Добавить два приватных поля**

В `src/view.ts` найти строки 79–80 (после `reasoningBuffer`):

```ts
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";
```

Заменить на:

```ts
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";
  private assistantRafHandle: number | null = null;
  private reasoningRafHandle: number | null = null;
```

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "refactor(view): add assistantRafHandle/reasoningRafHandle fields"
```

---

## Task 3: rAF-дросселирование `assistant_text` DOM-обновлений

**Files:**
- Modify: `src/view.ts:397–420` (ветка `assistant_text` в `onEvent()`)

- [ ] **Step 1: Заменить синхронную ветку assistant_text на rAF-версию**

В `src/view.ts` найти (строки 397–421, включая границу со следующей веткой):

```ts
    } else if (ev.kind === "assistant_text") {
      if (ev.isReasoning) {
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          this.reasoningBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
          this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
        }
        this.reasoningBuffer += ev.delta;
        const span = this.reasoningBlock.querySelector<HTMLElement>(".ai-wiki-reasoning-text");
        if (span) span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
      } else {
        if (!this.assistantBlock) {
          this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
          this.assistantBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
          this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
        }
        this.assistantBuffer += ev.delta;
        const span = this.assistantBlock.querySelector<HTMLElement>(".ai-wiki-assistant-text");
        if (span) span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
      }
      this.scrollSteps();
    } else if (ev.kind === "system") {
```

Заменить на:

```ts
    } else if (ev.kind === "assistant_text") {
      if (ev.isReasoning) {
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          this.reasoningBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
          this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
        }
        this.reasoningBuffer += ev.delta;
        if (!this.reasoningRafHandle) {
          this.reasoningRafHandle = window.requestAnimationFrame(() => {
            this.reasoningRafHandle = null;
            const span = this.reasoningBlock?.querySelector<HTMLElement>(".ai-wiki-reasoning-text");
            if (span) span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
            this.scrollSteps();
          });
        }
      } else {
        if (!this.assistantBlock) {
          this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
          this.assistantBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
          this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
        }
        this.assistantBuffer += ev.delta;
        if (!this.assistantRafHandle) {
          this.assistantRafHandle = window.requestAnimationFrame(() => {
            this.assistantRafHandle = null;
            const span = this.assistantBlock?.querySelector<HTMLElement>(".ai-wiki-assistant-text");
            if (span) span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
            this.scrollSteps();
          });
        }
      }
    } else if (ev.kind === "system") {
```

Обрати внимание: `this.scrollSteps()` перенесён внутрь rAF-коллбэков; прямой вызов в конце ветки и закрывающий `}` ветки `assistant_text` включены в замену для однозначного match.

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "perf(view): throttle assistant_text DOM updates via requestAnimationFrame"
```

---

## Task 4: Отмена rAF-хэндлов в `setRunning()`

**Files:**
- Modify: `src/view.ts:295–299` (блок сброса `assistantBlock/reasoningBlock` в `setRunning()`)

- [ ] **Step 1: Добавить отмену хэндлов**

В `src/view.ts` найти (строки 295–299 в `setRunning()`):

```ts
    this.assistantBlock = null;
    this.assistantBuffer = "";
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    this.lastTokPerSec = undefined;
```

Заменить на:

```ts
    this.assistantBlock = null;
    this.assistantBuffer = "";
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    if (this.assistantRafHandle !== null) {
      window.cancelAnimationFrame(this.assistantRafHandle);
      this.assistantRafHandle = null;
    }
    if (this.reasoningRafHandle !== null) {
      window.cancelAnimationFrame(this.reasoningRafHandle);
      this.reasoningRafHandle = null;
    }
    this.lastTokPerSec = undefined;
```

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): cancel pending rAF handles on setRunning reset"
```

---

## Task 5: Отмена rAF-хэндлов в ветке `tool_use`

**Files:**
- Modify: `src/view.ts:363–368` (ветка `tool_use` в `onEvent()`)

- [ ] **Step 1: Добавить отмену хэндлов**

В `src/view.ts` найти (строки 363–368 в ветке `tool_use`):

```ts
      this.toolCount++;
      this.assistantBlock = null;
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      const step = this.stepsEl.createDiv("ai-wiki-step");
```

Заменить на:

```ts
      this.toolCount++;
      this.assistantBlock = null;
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      if (this.assistantRafHandle !== null) {
        window.cancelAnimationFrame(this.assistantRafHandle);
        this.assistantRafHandle = null;
      }
      if (this.reasoningRafHandle !== null) {
        window.cancelAnimationFrame(this.reasoningRafHandle);
        this.reasoningRafHandle = null;
      }
      const step = this.stepsEl.createDiv("ai-wiki-step");
```

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): cancel pending rAF handles when tool_use resets blocks"
```

---

## Task 6: Фильтрация `assistant_text` в `logEvent()`

**Files:**
- Modify: `src/controller.ts:477–478`

- [ ] **Step 1: Добавить early return**

В `src/controller.ts` найти начало `logEvent()` (строки 476–478):

```ts
  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!this.plugin.settings.agentLogEnabled) return;
    const adapter = this.app.vault.adapter;
```

Заменить на:

```ts
  private async logEvent(_vaultRoot: string, sessionId: string, op: WikiOperation, domainId: string | undefined, ev: RunEvent): Promise<void> {
    if (!this.plugin.settings.agentLogEnabled) return;
    if (ev.kind === "assistant_text") return;
    const adapter = this.app.vault.adapter;
```

- [ ] **Step 2: Проверить сборку и тесты**

```bash
npm run build && npm test
```

Ожидаемый результат: сборка без ошибок, все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add src/controller.ts
git commit -m "fix(controller): skip assistant_text events in logEvent to reduce log noise"
```

---

## Task 7: Ручная верификация

- [ ] **Step 1: Запустить query с native backend (Ollama)**

Выполнить любой запрос через "Query". Проверить:
- Счётчик шагов в заголовке Progress отображает количество tool-call событий (0–5), а не количество токен-чанков (~200).
- Панель прокручивается плавно во время генерации без видимых фризов.

- [ ] **Step 2: Запустить init или lint**

Проверить:
- Статические строки фаз (`"Evaluating domain..."`, `"Actualising..."`) не прибавляют к счётчику — счётчик растёт только при `tool_use`.

- [ ] **Step 3: Проверить лог при `agentLogEnabled: true`**

Включить агент-лог в настройках. Выполнить запрос. Открыть `!Logs/agent.jsonl`. Проверить:
- Ни одной записи с `"kind":"assistant_text"`.
- Есть запись с `"kind":"result"` содержащая полный текст ответа.

- [ ] **Step 4: Проверить с claude-agent backend**

Повторить шаги 1–3 с backend = `claude-agent`. Убедиться, что поведение счётчика и логирования совпадает.
