# Chat Session Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить потерю контекста в многотурновом чате для `claude-agent` бэкенда, используя нативный `--resume <session_id>` механизм Claude CLI.

**Architecture:** После первого тура чата `ClaudeCliClient` возвращает `session_id` из init-события; `WikiController` хранит его в `_chatSessionId` и передаёт в `ClaudeCliConfig.resumeSessionId` для последующих туров. При resume `--system-prompt` не передаётся (контекст уже в сессии), только новый вопрос пользователя. Нативный агент (Ollama) не затронут — он уже работает корректно.

**Tech Stack:** TypeScript, Vitest, Claude CLI (`--resume`), spawn/readline (node:child_process)

---

## Затрагиваемые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | Добавить `sessionId?: string` в system RunEvent |
| `src/stream.ts` | Извлекать `session_id` из init-строки |
| `src/claude-cli-client.ts` | Добавить `resumeSessionId?` в config, передавать `--resume` и пропускать `--system-prompt` |
| `src/controller.ts` | Хранить `_chatSessionId`, передавать в `buildAgentRunner`, очищать при ошибке/не-чат операции |
| `tests/stream.test.ts` | Тесты на извлечение `sessionId` |
| `tests/claude-cli-client.test.ts` | Тесты на `--resume` в args |

---

## Task 1: Добавить `sessionId` в тип RunEvent

**Files:**
- Modify: `src/types.ts`

- [ ] **Шаг 1: Написать падающий тест**

В `tests/stream.test.ts` добавить в конец блока `describe("parseStreamLine")`:

```ts
it("extracts session_id from system init event", () => {
  const line = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "abc-123",
    model: "claude-sonnet-4-6",
    cwd: "/home/u",
  });
  const ev = parseStreamLine(line);
  expect(ev?.kind).toBe("system");
  expect((ev as Extract<RunEvent, { kind: "system" }>).sessionId).toBe("abc-123");
});

it("returns undefined sessionId when session_id is missing from system event", () => {
  const line = JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-6" });
  const ev = parseStreamLine(line);
  expect(ev?.kind).toBe("system");
  expect((ev as Extract<RunEvent, { kind: "system" }>).sessionId).toBeUndefined();
});
```

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/stream.test.ts
```

Ожидаемый результат: TypeScript-ошибка — у типа `{ kind: "system" }` нет поля `sessionId`.

- [ ] **Шаг 3: Обновить тип в `src/types.ts`**

Найти строку 34 — ветку `system` в union RunEvent:

```ts
// Было:
| { kind: "system"; message: string }

// Стало:
| { kind: "system"; message: string; sessionId?: string }
```

- [ ] **Шаг 4: Запустить тест — должен упасть на другой причине**

```bash
npx vitest run tests/stream.test.ts
```

Ожидаемый результат: тест компилируется, но падает — `sessionId` ещё `undefined` потому что `stream.ts` его не извлекает.

- [ ] **Шаг 5: Коммит типа**

```bash
git add src/types.ts tests/stream.test.ts
git commit -m "test(stream): add tests for session_id extraction from init event"
```

---

## Task 2: Извлекать `session_id` в `stream.ts`

**Files:**
- Modify: `src/stream.ts`

- [ ] **Шаг 1: Обновить ветку `system` в `parseStreamLine`**

Файл `src/stream.ts`, функция `parseStreamLine`, блок `case "system"`:

```ts
// Было:
case "system": {
  const subtype = typeof obj.subtype === "string" ? obj.subtype : "system";
  const model = typeof obj.model === "string" ? obj.model : "";
  const msg = `${subtype}${model ? ` (${model})` : ""}`;
  return { kind: "system", message: msg };
}

// Стало:
case "system": {
  const subtype = typeof obj.subtype === "string" ? obj.subtype : "system";
  const model = typeof obj.model === "string" ? obj.model : "";
  const sessionId = typeof obj.session_id === "string" ? obj.session_id : undefined;
  const msg = `${subtype}${model ? ` (${model})` : ""}`;
  return { kind: "system", message: msg, sessionId };
}
```

- [ ] **Шаг 2: Запустить тест — должен пройти**

```bash
npx vitest run tests/stream.test.ts
```

Ожидаемый результат: все тесты `parseStreamLine` проходят. Существующий тест `"maps full ingest fixture in order"` тоже проходит — он проверяет только `kinds`, а fixture уже содержит `session_id: "abc"`.

- [ ] **Шаг 3: Коммит**

```bash
git add src/stream.ts
git commit -m "feat(stream): extract session_id from system init event"
```

---

## Task 3: Поддержать `--resume` в `ClaudeCliClient`

**Files:**
- Modify: `src/claude-cli-client.ts`
- Modify: `tests/claude-cli-client.test.ts`

- [ ] **Шаг 1: Написать падающие тесты**

В `tests/claude-cli-client.test.ts` добавить после последнего `it(...)` в `describe("ClaudeCliClient")`:

```ts
it("passes --resume after -- and skips --system-prompt when resumeSessionId is set", async () => {
  (spawn as any).mockReturnValue(makeMockProcess([]));

  const client = new ClaudeCliClient({ ...cfg, resumeSessionId: "session-xyz" });
  await client.chat.completions.create(
    {
      model: "sonnet",
      messages: [
        { role: "system", content: "operation context" },
        { role: "user", content: "первый вопрос" },
        { role: "assistant", content: "первый ответ" },
        { role: "user", content: "второй вопрос" },
      ],
      stream: false,
    } as any,
  );

  const args: string[] = (spawn as any).mock.calls[0][1];
  const separatorIdx = args.indexOf("--");
  expect(separatorIdx).toBeGreaterThan(-1);

  // --resume должен идти после --
  const resumeIdx = args.indexOf("--resume");
  expect(resumeIdx).toBeGreaterThan(separatorIdx);
  expect(args[resumeIdx + 1]).toBe("session-xyz");

  // --system-prompt не должен присутствовать при resume
  expect(args).not.toContain("--system-prompt");
  expect(args).not.toContain("--system-prompt-file");

  // -p содержит только последнее user-сообщение
  const pIdx = args.indexOf("-p");
  expect(args[pIdx + 1]).toBe("второй вопрос");
});

it("does not pass --resume and does pass --system-prompt when resumeSessionId is absent", async () => {
  (spawn as any).mockReturnValue(makeMockProcess([]));

  const client = new ClaudeCliClient(cfg); // resumeSessionId не задан
  await client.chat.completions.create(
    {
      model: "sonnet",
      messages: [
        { role: "system", content: "operation context" },
        { role: "user", content: "первый вопрос" },
      ],
      stream: false,
    } as any,
  );

  const args: string[] = (spawn as any).mock.calls[0][1];
  expect(args).not.toContain("--resume");
  expect(args).toContain("--system-prompt");
  const pIdx = args.indexOf("-p");
  expect(args[pIdx + 1]).toBe("первый вопрос");
});
```

- [ ] **Шаг 2: Запустить тест — убедиться что падает**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Ожидаемый результат: TypeScript-ошибка `resumeSessionId` не существует в `ClaudeCliConfig`, или тест падает по поведению.

- [ ] **Шаг 3: Добавить `resumeSessionId` в `ClaudeCliConfig`**

В `src/claude-cli-client.ts`, интерфейс `ClaudeCliConfig` (строка ~9):

```ts
export interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
  tmpDir: string;
  resumeSessionId?: string;  // добавить эту строку
}
```

- [ ] **Шаг 4: Обновить логику `_create()` — добавить `--resume` и условный `--system-prompt`**

В методе `_create()` файла `src/claude-cli-client.ts`.

Найти и заменить весь блок сборки `args` — от `const args: string[] = []` до конца блока `try`:

```ts
// Было:
const args: string[] = [];
if (model) args.push("--model", model);
args.push("--");

try {
  const isLargeUser = Buffer.byteLength(userText, "utf8") > LARGE_THRESHOLD;
  if (isLargeUser) {
    const tmpUsrFile = join(this.cfg.tmpDir, `llm-wiki-usr-${id}.txt`);
    writeFileSync(tmpUsrFile, userText, "utf-8");
    tmpFiles.push(tmpUsrFile);
    args.push("-p", ".");
    args.push("--append-system-prompt-file", tmpUsrFile);
  } else {
    args.push("-p", userText);
  }

  args.push("--output-format", "stream-json", "--verbose");
  args.push("--disable-slash-commands");
  args.push("--dangerously-skip-permissions");

  if (this.cfg.allowedTools) args.push("--tools", this.cfg.allowedTools);

  if (systemContent) {
    const isLargeSys = Buffer.byteLength(systemContent, "utf8") > LARGE_THRESHOLD;
    if (isLargeSys) {
      const tmpSysFile = join(this.cfg.tmpDir, `llm-wiki-sys-${id}.txt`);
      writeFileSync(tmpSysFile, systemContent, "utf-8");
      tmpFiles.push(tmpSysFile);
      args.push("--system-prompt-file", tmpSysFile);
    } else {
      args.push("--system-prompt", systemContent);
    }
  }
} catch (err) {
  for (const f of tmpFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
  throw err;
}

// Стало:
const isResume = Boolean(this.cfg.resumeSessionId);
const args: string[] = [];
if (model) args.push("--model", model);
args.push("--");

// --resume идёт после -- как claude-флаг
if (isResume) {
  args.push("--resume", this.cfg.resumeSessionId!);
}

try {
  const isLargeUser = Buffer.byteLength(userText, "utf8") > LARGE_THRESHOLD;
  if (isLargeUser) {
    const tmpUsrFile = join(this.cfg.tmpDir, `llm-wiki-usr-${id}.txt`);
    writeFileSync(tmpUsrFile, userText, "utf-8");
    tmpFiles.push(tmpUsrFile);
    args.push("-p", ".");
    args.push("--append-system-prompt-file", tmpUsrFile);
  } else {
    args.push("-p", userText);
  }

  args.push("--output-format", "stream-json", "--verbose");
  args.push("--disable-slash-commands");
  args.push("--dangerously-skip-permissions");

  if (this.cfg.allowedTools) args.push("--tools", this.cfg.allowedTools);

  // При resume системный промпт уже хранится в сессии claude —
  // повторная передача может перезаписать исходный контекст операции.
  if (!isResume && systemContent) {
    const isLargeSys = Buffer.byteLength(systemContent, "utf8") > LARGE_THRESHOLD;
    if (isLargeSys) {
      const tmpSysFile = join(this.cfg.tmpDir, `llm-wiki-sys-${id}.txt`);
      writeFileSync(tmpSysFile, systemContent, "utf-8");
      tmpFiles.push(tmpSysFile);
      args.push("--system-prompt-file", tmpSysFile);
    } else {
      args.push("--system-prompt", systemContent);
    }
  }
} catch (err) {
  for (const f of tmpFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
  throw err;
}
```

- [ ] **Шаг 5: Запустить все тесты клиента — должны пройти**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Ожидаемый результат: все 10 тестов проходят (8 существующих + 2 новых).

- [ ] **Шаг 6: Коммит**

```bash
git add src/claude-cli-client.ts tests/claude-cli-client.test.ts
git commit -m "feat(claude-cli-client): support --resume session_id for multi-turn chat"
```

---

## Task 4: Хранить `_chatSessionId` в `WikiController`

**Files:**
- Modify: `src/controller.ts`

Внимание: тесты контроллера не изолированы (нет отдельного файла). Изменения проверяются запуском полного набора тестов.

- [ ] **Шаг 1: Добавить поле `_chatSessionId` в класс**

В `src/controller.ts`, строка 17 (после объявления `current`):

```ts
// Было:
export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;

// Стало:
export class WikiController {
  private current: AbortController | null = null;
  currentOp: { op: WikiOperation; args: string[] } | null = null;
  private _chatSessionId: string | undefined;
```

- [ ] **Шаг 2: Обновить `buildAgentRunner` — принять и передать `resumeSessionId`**

Найти сигнатуру метода `private buildAgentRunner(vaultRoot: string)` (строка ~170):

```ts
// Было:
private buildAgentRunner(vaultRoot: string): AgentRunner {

// Стало:
private buildAgentRunner(vaultRoot: string, resumeSessionId?: string): AgentRunner {
```

Найти внутри `buildAgentRunner` строку создания `ClaudeCliClient`:

```ts
// Было:
const llm = s.backend === "claude-agent"
  ? new ClaudeCliClient({ ...s.claudeAgent, requestTimeoutSec: maxTimeoutSec, cwd: s.claudeAgent.spawnCwd || "/tmp", tmpDir })

// Стало:
const llm = s.backend === "claude-agent"
  ? new ClaudeCliClient({ ...s.claudeAgent, requestTimeoutSec: maxTimeoutSec, cwd: s.claudeAgent.spawnCwd || "/tmp", tmpDir, resumeSessionId })
```

- [ ] **Шаг 3: Обновить `dispatchChat` — передать `_chatSessionId`, поймать новый session_id**

В методе `dispatchChat` найти строку создания `agentRunner`:

```ts
// Было:
const agentRunner = this.buildAgentRunner(vaultRoot);

// Стало:
const agentRunner = this.buildAgentRunner(vaultRoot, this._chatSessionId);
```

Найти цикл событий — внутри `try { for await (const ev of runGen) {`:

```ts
// Было:
for await (const ev of runGen) {
  this.logEvent(sessionId, "chat", domainId, ev);
  this.activeView()?.appendChatEvent(ev);
  if (ev.kind === "result") finalText = ev.text;
  if (ev.kind === "error") status = "error";
}

// Стало:
for await (const ev of runGen) {
  this.logEvent(sessionId, "chat", domainId, ev);
  this.activeView()?.appendChatEvent(ev);
  // Обновляем session_id при каждом init-событии (первый тур — получаем ID,
  // последующие — подтверждаем что сессия жива или получаем новый ID при форке).
  if (ev.kind === "system" && ev.sessionId) {
    this._chatSessionId = ev.sessionId;
  }
  if (ev.kind === "result") finalText = ev.text;
  if (ev.kind === "error") status = "error";
}
```

Найти блок `catch/finally` — заменить вместе, чтобы не потерять очистку `this.current`:

```ts
// Было:
} catch (err) {
      status = "error";
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      this.logEvent(sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.currentOp = null;
    }

// Стало:
} catch (err) {
      status = "error";
      // Сессия может быть невалидна (expired, --resume failed) — сбросить для следующего тура.
      this._chatSessionId = undefined;
      finalText = i18n().ctrl.errorPrefix((err as Error).message);
      this.logEvent(sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.currentOp = null;
    }
```

- [ ] **Шаг 4: Очистить `_chatSessionId` в `dispatch` (не-чат операции)**

В методе `dispatch`, найти строку после проверки `isBusy()`:

```ts
// Было:
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string): Promise<void> {
  if (this.isBusy()) {
    new Notice(i18n().ctrl.operationRunning);
    return;
  }

  if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;

// Стало:
private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string): Promise<void> {
  if (this.isBusy()) {
    new Notice(i18n().ctrl.operationRunning);
    return;
  }

  // Новая операция делает предыдущий чат-контекст нерелевантным.
  this._chatSessionId = undefined;

  if (this.plugin.settings.backend === "claude-agent" && !this.requireClaudeAgent()) return;
```

- [ ] **Шаг 5: Запустить все тесты — убедиться что всё проходит**

```bash
npm test
```

Ожидаемый результат: все тесты проходят. Никаких TypeScript-ошибок.

- [ ] **Шаг 6: Сборка**

Инкрементировать patch-версию в `package.json` и `manifest.json` (читай текущую, прибавь 1 к Z в X.Y.Z), затем:

```bash
npm run build
```

Ожидаемый результат: `main.js` собран без ошибок.

- [ ] **Шаг 7: Коммит**

```bash
git add src/controller.ts package.json manifest.json main.js
git commit -m "feat(controller): store chat session_id and pass --resume for multi-turn chat"
```

---

## Self-Review

**Покрытие требований:**

| Требование | Задача |
|---|---|
| Извлечь `session_id` из init-события | Task 2 |
| Хранить `session_id` между турами | Task 4 |
| Передать `--resume` при повторном туре | Task 3 |
| Не передавать `--system-prompt` при resume | Task 3 |
| Сбросить сессию при ошибке | Task 4 (catch) |
| Сбросить сессию при новой операции | Task 4 (dispatch) |
| Ollama не затронут | — (нет задачи, не нужна) |

**Проверка типов между задачами:**

- Task 1 добавляет `sessionId?: string` в `{ kind: "system" }` — Task 2 возвращает это поле, Task 4 читает `ev.sessionId` ✓
- `ClaudeCliConfig.resumeSessionId?: string` из Task 3 — `buildAgentRunner(vaultRoot, resumeSessionId?)` из Task 4 передаёт его ✓
- `parseStreamLine` возвращает `RunEvent | null` — контроллер проверяет `ev.kind === "system" && ev.sessionId` ✓

**Плейсхолдеры:** отсутствуют.
