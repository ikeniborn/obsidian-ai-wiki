# Chat After All Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать чат-секцию после ingest и query (не только после lint), сбрасывать чат при старте новой операции.

**Architecture:** Генерализуем `lastLint` → `lastContext` в view; добавляем `domainId` в `RunHistoryEntry`; передаём `operationHeader` через `RunRequest` в `runLintChat`; обновляем промпт `prompts/chat.md`.

**Tech Stack:** TypeScript, Obsidian ItemView API, esbuild (npm run build), vitest (npm test)

---

### Task 1: Расширить типы — `RunHistoryEntry` и `RunRequest`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Добавить `domainId` в `RunHistoryEntry` и `operationHeader` в `RunRequest`**

В `src/types.ts` найти интерфейс `RunHistoryEntry` (строки ~46–55) и добавить поле `domainId?`:

```typescript
export interface RunHistoryEntry {
  id: string;
  operation: WikiOperation;
  args: string[];
  domainId?: string;        // ← добавить
  startedAt: number;
  finishedAt: number;
  status: "done" | "error" | "cancelled";
  finalText: string;
  steps: Array<{ kind: "tool_use" | "tool_result"; label: string }>;
}
```

В интерфейс `RunRequest` (строки ~20–30) добавить поле `operationHeader?`:

```typescript
export interface RunRequest {
  operation: WikiOperation;
  args: string[];
  cwd: string | undefined;
  signal: AbortSignal;
  timeoutMs: number;
  domainId?: string;
  context?: string;
  instruction?: string;
  chatMessages?: ChatMessage[];
  operationHeader?: string;  // ← добавить
}
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd /home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki
npm test
```

Ожидаемый результат: все тесты проходят (stream, prompt, settings, runner.integration).

- [ ] **Step 3: Коммит**

```bash
git add src/types.ts
git commit -m "feat(types): add domainId to RunHistoryEntry, operationHeader to RunRequest"
```

---

### Task 2: Обновить промпт `prompts/chat.md`

**Files:**
- Modify: `prompts/chat.md`

- [ ] **Step 1: Заменить содержимое файла**

Текущее содержимое `prompts/chat.md`:

```
{{domain_header}}
Помогай пользователю анализировать и исправлять проблемы, выявленные lint-проверкой.
Отвечай конкретно, ссылаясь на страницы и сущности из отчёта.

ОТЧЁТ LINT:
{{lint_report}}
```

Новое содержимое:

```
{{operation_header}}
Помогай пользователю анализировать и обсуждать результаты операции.
Отвечай конкретно, ссылаясь на страницы и сущности из контекста.

РЕЗУЛЬТАТ ОПЕРАЦИИ:
{{context}}
```

- [ ] **Step 2: Коммит**

```bash
git add prompts/chat.md
git commit -m "feat(prompts): generalize chat prompt for all operations"
```

---

### Task 3: Обновить `src/phases/chat.ts` — добавить `operationHeader`

**Files:**
- Modify: `src/phases/chat.ts`

- [ ] **Step 1: Добавить параметр `operationHeader` и обновить рендер**

Текущая сигнатура `runLintChat` (строки ~8–16):

```typescript
export async function* runLintChat(
  llm: LlmClient,
  model: string,
  domain: DomainEntry | undefined,
  signal: AbortSignal,
  opts: LlmCallOptions,
  lintReport: string,
  history: ChatMessage[],
): AsyncGenerator<RunEvent>
```

Новая сигнатура (добавить `operationHeader` последним, переименовать `lintReport` → `context`):

```typescript
export async function* runLintChat(
  llm: LlmClient,
  model: string,
  domain: DomainEntry | undefined,
  signal: AbortSignal,
  opts: LlmCallOptions,
  context: string,
  history: ChatMessage[],
  operationHeader: string,
): AsyncGenerator<RunEvent>
```

Обновить переменную `domainHeader` и вызов `render` (строки ~19–26):

```typescript
  const systemContent = render(chatTemplate, {
    operation_header: operationHeader,
    context,
  });
```

Удалить строки с `domainHeader` (они были частью старого рендера):

```typescript
// Удалить:
const domainHeader = domain
  ? `Ты — редактор wiki-базы знаний домена «${domain.name || domain.id}».`
  : `Ты — редактор wiki-базы знаний.`;

const systemContent = render(chatTemplate, {
  domain_header: domainHeader,
  lint_report: lintReport,
});
```

Параметр `domain` остаётся в сигнатуре (не удалять — может пригодиться в будущем для более детального контекста), но больше не используется при рендере промпта. Если TypeScript выдаст предупреждение о неиспользуемом параметре — добавить `void domain;` после объявления переменных.

- [ ] **Step 2: Проверить компиляцию**

```bash
npm test
```

Ожидаемый результат: ошибка компиляции в `src/agent-runner.ts` — не хватает аргумента `operationHeader`. Это нормально, исправим в Task 4.

- [ ] **Step 3: Перейти к Task 4**

Не коммитить отдельно — `chat.ts` вызывает `runLintChat` с новой сигнатурой, `agent-runner.ts` ещё не обновлён и не компилируется. Коммит будет в Task 4 Step 3.

---

### Task 4: Обновить `src/agent-runner.ts` — передать `operationHeader`

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Передать `operationHeader` из `RunRequest` в `runLintChat`**

Найти блок `case "chat":` (строки ~79–82):

```typescript
case "chat": {
  const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
  yield* runLintChat(this.llm, model, domain, req.signal, opts, req.context ?? "", req.chatMessages ?? []);
  break;
}
```

Заменить на:

```typescript
case "chat": {
  const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
  yield* runLintChat(
    this.llm, model, domain, req.signal, opts,
    req.context ?? "",
    req.chatMessages ?? [],
    req.operationHeader ?? "",
  );
  break;
}
```

- [ ] **Step 2: Проверить компиляцию и тесты**

```bash
npm test
```

Ожидаемый результат: все тесты проходят. Если остались ошибки TypeScript — исправить несоответствия типов.

- [ ] **Step 3: Коммит вместе с Task 3**

```bash
git add src/phases/chat.ts src/agent-runner.ts
git commit -m "feat(chat): add operationHeader param, generalize context variable name"
```

---

### Task 5: Обновить `src/controller.ts`

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Добавить `domainId` в `RunHistoryEntry` внутри `dispatch()`**

Найти создание `entry` в конце `dispatch()` (строки ~290–299):

```typescript
const entry: RunHistoryEntry = {
  id: `${startedAt}`,
  operation: op,
  args,
  startedAt,
  finishedAt: Date.now(),
  status,
  finalText,
  steps,
};
```

Заменить на:

```typescript
const entry: RunHistoryEntry = {
  id: `${startedAt}`,
  operation: op,
  args,
  domainId,
  startedAt,
  finishedAt: Date.now(),
  status,
  finalText,
  steps,
};
```

- [ ] **Step 2: Переименовать `lintChat()` → `chat()` и добавить генерацию `operationHeader`**

Найти метод `lintChat()` (строки ~52–55):

```typescript
async lintChat(domainId: string, lintReport: string, history: ChatMessage[], newMessage: string): Promise<void> {
  const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
  await this.dispatchChat(domainId, lintReport, chatMessages);
}
```

Заменить на:

```typescript
async chat(operation: WikiOperation, domainId: string | undefined, context: string, history: ChatMessage[], newMessage: string): Promise<void> {
  const chatMessages: ChatMessage[] = [...history, { role: "user", content: newMessage }];
  await this.dispatchChat(operation, domainId, context, chatMessages);
}
```

- [ ] **Step 3: Обновить `dispatchChat()` — принять `operation`, добавить `operationHeader`**

Текущая сигнатура `dispatchChat()` (строка ~57):

```typescript
private async dispatchChat(domainId: string, lintReport: string, chatMessages: ChatMessage[]): Promise<void> {
```

Новая сигнатура:

```typescript
private async dispatchChat(operation: WikiOperation, domainId: string | undefined, context: string, chatMessages: ChatMessage[]): Promise<void> {
```

Внутри `dispatchChat()` добавить генерацию `operationHeader` перед вызовом `agentRunner.run(...)` (строка ~90):

```typescript
const OPERATION_LABELS: Partial<Record<WikiOperation, string>> = {
  lint: "Lint-проверка wiki",
  ingest: "Извлечение знаний (ingest)",
  query: "Ответ на запрос (query)",
  "query-save": "Ответ на запрос с сохранением (query-save)",
};
const operationHeader = OPERATION_LABELS[operation] ?? operation;
```

Обновить вызов `agentRunner.run(...)` — заменить `context: lintReport` на `context` и добавить `operationHeader`:

```typescript
const runGen = agentRunner.run({
  operation: "chat", args: [], cwd: repoRoot,
  signal: ctrl.signal, timeoutMs, domainId, context, chatMessages, operationHeader,
});
```

Обновить логирование в `dispatchChat` — заменить упоминание `lintReport` на `context` (если есть в строках лога).

- [ ] **Step 4: Проверить компиляцию и тесты**

```bash
npm test
```

Ожидаемый результат: ошибка компиляции в `src/view.ts` — `lintChat` не найден. Это нормально, исправим в Task 6.

- [ ] **Step 5: Коммит (после Task 6)**

Пропустить — коммитим вместе с Task 6.

---

### Task 6: Обновить `src/view.ts`

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Заменить поле `lastLint` на `lastContext`**

Найти объявление (строка ~38):

```typescript
private lastLint: { domainId: string; report: string } | null = null;
```

Заменить на:

```typescript
private lastContext: { operation: WikiOperation; domainId: string | undefined; report: string } | null = null;
```

Убедиться, что `WikiOperation` импортирован в начале файла (строка ~4):

```typescript
import type { ChatMessage, RunEvent, RunHistoryEntry, WikiOperation } from "./types";
```

- [ ] **Step 2: Обновить `setRunning()` — добавить сброс чата**

Найти метод `setRunning()` (строка ~221). В начале тела метода после `this.fixChatEl?.remove()` и `this.fixChatEl = null;` добавить:

```typescript
this.chatSection?.remove();
this.chatSection = null;
this.lastContext = null;
this.chatHistory = [];
```

- [ ] **Step 3: Обновить `finish()` — расширить условие показа чата**

Найти блок условия (строки ~363–369):

```typescript
// Чат — только после lint на конкретном домене
const domainId = entry.args[0];
if (entry.operation === "lint" && entry.status === "done" && domainId) {
  this.lastLint = { domainId, report: entry.finalText };
  this.chatHistory = [];
  this.showChatSection();
}
```

Заменить на:

```typescript
const CHAT_OPS: WikiOperation[] = ["lint", "ingest", "query", "query-save"];
if (CHAT_OPS.includes(entry.operation) && entry.status === "done" && entry.finalText) {
  this.lastContext = {
    operation: entry.operation,
    domainId: entry.domainId,
    report: entry.finalText,
  };
  this.chatHistory = [];
  this.showChatSection();
}
```

- [ ] **Step 4: Обновить `showChatSection()` — использовать `lastContext` и переименованный метод**

Найти в `showChatSection()` строку submit (строки ~391–398):

```typescript
const submit = () => {
  const text = this.chatInputEl!.value.trim();
  if (!text || !this.lastLint) return;
  this.chatInputEl!.value = "";
  this.addChatBubble("user", text);
  this.lastUserMessage = text;
  void this.plugin.controller.lintChat(this.lastLint.domainId, this.lastLint.report, this.chatHistory, text);
};
```

Заменить на:

```typescript
const submit = () => {
  const text = this.chatInputEl!.value.trim();
  if (!text || !this.lastContext) return;
  this.chatInputEl!.value = "";
  this.addChatBubble("user", text);
  this.lastUserMessage = text;
  void this.plugin.controller.chat(
    this.lastContext.operation,
    this.lastContext.domainId,
    this.lastContext.report,
    this.chatHistory,
    text,
  );
};
```

- [ ] **Step 5: Проверить компиляцию и тесты**

```bash
npm test
```

Ожидаемый результат: все тесты проходят, нет ошибок TypeScript.

- [ ] **Step 6: Коммит Task 5 + Task 6**

```bash
git add src/controller.ts src/view.ts
git commit -m "feat(chat): generalize chat to ingest/query, reset on new operation"
```

---

### Task 7: Сборка и финальная проверка

**Files:**
- Modify: `package.json`, `manifest.json` (версия 0.1.44 → 0.1.45)
- Rebuild: `dist/main.js`

- [ ] **Step 1: Обновить версию**

В `package.json` изменить `"version": "0.1.44"` → `"version": "0.1.45"`.
В `manifest.json` изменить `"version": "0.1.44"` → `"version": "0.1.45"`.

- [ ] **Step 2: Собрать**

```bash
npm run build
```

Ожидаемый результат: `dist/main.js` пересобран без ошибок.

- [ ] **Step 3: Ручная проверка в Obsidian**

1. Перезагрузить плагин в Obsidian (Settings → Community Plugins → disable/enable)
2. Выбрать домен, запустить **ingest** на активном файле → дождаться завершения → убедиться, что под результатом появился раздел «Чат»
3. Написать вопрос в чат → убедиться, что приходит ответ
4. Запустить **query** → убедиться, что чат появляется после завершения
5. Запустить **lint** → убедиться, что чат появляется (поведение не изменилось)
6. Запустить новую операцию пока открыт чат → убедиться, что чат исчезает

- [ ] **Step 4: Финальный коммит**

```bash
git add dist/main.js dist/manifest.json package.json manifest.json
git commit -m "chore: bump version to 0.1.45, rebuild"
```
