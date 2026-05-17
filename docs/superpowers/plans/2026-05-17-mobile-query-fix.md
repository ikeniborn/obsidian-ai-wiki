---
review:
  plan_hash: "6519ab5ab4b9276b"
  spec_hash: "940bbe4b810c27db"
  last_run: "2026-05-17"
  phases:
    structure:     {status: passed}
    coverage:      {status: passed}
    dependencies:  {status: passed}
    verifiability: {status: passed}
    consistency:   {status: passed}
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Self-Review"
      section_hash: "5859182d0bfaa260"
      text: "Ручное тестирование (мобильное) — 3 сценария из спеки (недоступный хост, корректный baseUrl, Cancel) не представлены ни одним шагом плана"
      verdict: fixed
      verdict_at: "2026-05-17"
---
# Mobile Query Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить зависание query на мобильном: пробросить AbortSignal в mobileFetch, добавить таймаут в dispatch, показывать ошибку вместо тихого завершения.

**Architecture:** Три независимых точки изменений: `mobile-fetch.ts` получает `Promise.race`-обёртку вокруг `requestUrl`; `dispatch` в `controller.ts` получает `window.setTimeout` → `ctrl.abort()` плюс блок детекции тихого abort; `agent-runner.ts` добавляет `baseUrl` в первое system-событие.

**Tech Stack:** TypeScript, Obsidian API (`requestUrl`), vitest

---

## Файлы

| Файл | Изменение |
|---|---|
| `src/mobile-fetch.ts` | Добавить `abortRace()`, обернуть `requestUrl` в `Promise.race` |
| `src/controller.ts` | Добавить `timedOut` флаг + `window.setTimeout` в `dispatch`; detect silent abort |
| `src/agent-runner.ts` | Добавить `baseUrlHint` в system-событие в `run()` |
| `vitest.mock.ts` | Добавить `__setRequestUrlDelay` / `__resetRequestUrlDelay` |
| `tests/mobile-fetch.test.ts` | Добавить тест на race (signal срабатывает после старта) |
| `tests/agent-runner.integration.test.ts` | Добавить тест на baseUrl в system event |

---

### Task 1: Delay-поддержка в моке requestUrl

**Files:**
- Modify: `vitest.mock.ts:119-130`

- [ ] **Step 1: Добавить переменную задержки и хелперы экспорта**

Найди блок начиная со строки 119:
```typescript
export const __requestUrlCalls: any[] = [];
export let __requestUrlResponse: { status: number; text: string; headers: Record<string, string> } = {
  status: 200, text: "{}", headers: { "content-type": "application/json" },
};
export function __setRequestUrlResponse(r: typeof __requestUrlResponse): void {
  __requestUrlResponse = r;
}
export function __clearRequestUrlCalls(): void { __requestUrlCalls.length = 0; }
export async function requestUrl(param: any) {
  __requestUrlCalls.push(param);
  return __requestUrlResponse;
}
```

Замени на:
```typescript
export const __requestUrlCalls: any[] = [];
export let __requestUrlResponse: { status: number; text: string; headers: Record<string, string> } = {
  status: 200, text: "{}", headers: { "content-type": "application/json" },
};
export function __setRequestUrlResponse(r: typeof __requestUrlResponse): void {
  __requestUrlResponse = r;
}
export function __clearRequestUrlCalls(): void { __requestUrlCalls.length = 0; }

let __requestUrlDelayMs = 0;
export function __setRequestUrlDelay(ms: number): void { __requestUrlDelayMs = ms; }
export function __resetRequestUrlDelay(): void { __requestUrlDelayMs = 0; }

export async function requestUrl(param: any) {
  __requestUrlCalls.push(param);
  if (__requestUrlDelayMs > 0) {
    await new Promise((r) => setTimeout(r, __requestUrlDelayMs));
  }
  return __requestUrlResponse;
}
```

- [ ] **Step 2: Запустить существующие тесты mobileFetch — должны пройти**

```bash
npx vitest run tests/mobile-fetch.test.ts
```
Expected: 3 passed

---

### Task 2: Новый тест — AbortSignal через race

**Files:**
- Modify: `tests/mobile-fetch.test.ts`
- Test: `tests/mobile-fetch.test.ts`

- [ ] **Step 1: Написать падающий тест (signal срабатывает после старта)**

Добавь в конец `tests/mobile-fetch.test.ts` (перед закрывающей скобкой `describe`):
```typescript
  it("отменяет через race когда signal срабатывает после старта requestUrl (50мс задержка)", async () => {
    __setRequestUrlDelay(50);
    const ctrl = new AbortController();
    // Абортим через 10мс — раньше, чем requestUrl вернёт ответ
    setTimeout(() => ctrl.abort(), 10);
    await expect(
      mobileFetch("https://api.test/", { signal: ctrl.signal }),
    ).rejects.toThrow("Aborted");
    __resetRequestUrlDelay();
  });
```

Также добавь импорт в начало файла:
```typescript
import { __requestUrlCalls, __setRequestUrlResponse, __clearRequestUrlCalls, __setRequestUrlDelay, __resetRequestUrlDelay } from "../vitest.mock";
```

(замени существующую строку импорта)

- [ ] **Step 2: Запустить тест — должен упасть (mobileFetch не делает race)**

```bash
npx vitest run tests/mobile-fetch.test.ts
```
Expected: тест "отменяет через race..." FAIL (зависает или timeout, но не AbortError)

> Примечание: vitest имеет дефолтный timeout 5000мс на тест. Тест зависнет на 50мс и вернёт ответ без ошибки, expectation упадёт.

---

### Task 3: Реализация AbortSignal в mobileFetch

**Files:**
- Modify: `src/mobile-fetch.ts`
- Test: `tests/mobile-fetch.test.ts`

- [ ] **Step 1: Добавить `abortRace` и обернуть requestUrl в Promise.race**

Замени весь `src/mobile-fetch.ts` на:
```typescript
import { requestUrl } from "obsidian";

export const mobileFetch: typeof fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url;

  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }

  const requestPromise = requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: body ?? undefined,
    throw: false,
  });

  const r = init?.signal
    ? await Promise.race([requestPromise, abortRace(init.signal)])
    : await requestPromise;

  return new Response(r.text, { status: r.status, headers: r.headers as HeadersInit });
};

function abortRace(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const handler = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", handler, { once: true });
  });
}
```

- [ ] **Step 2: Запустить все тесты mobileFetch — все должны пройти**

```bash
npx vitest run tests/mobile-fetch.test.ts
```
Expected: 4 passed

- [ ] **Step 3: Commit**

```bash
git add src/mobile-fetch.ts vitest.mock.ts tests/mobile-fetch.test.ts
git commit -m "fix(mobile): AbortSignal via Promise.race in mobileFetch"
```

---

### Task 4: Тест — baseUrl в system event AgentRunner

**Files:**
- Modify: `tests/agent-runner.integration.test.ts`
- Test: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавь в конец блока `describe("AgentRunner", ...)` в `tests/agent-runner.integration.test.ts`:
```typescript
  it("system event содержит baseUrl для native-agent backend", async () => {
    const settingsWithUrl: LlmWikiPluginSettings = {
      ...baseSettings,
      backend: "native-agent",
      nativeAgent: {
        ...DEFAULT_SETTINGS.nativeAgent,
        baseUrl: "https://homelab.example.com/v1",
      },
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(makeLlm("[]"), settingsWithUrl, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "query",
        args: ["test"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );
    const systemEv = events[0] as { kind: string; message: string };
    expect(systemEv.kind).toBe("system");
    expect(systemEv.message).toContain("https://homelab.example.com/v1");
  });
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
npx vitest run tests/agent-runner.integration.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: тест "system event содержит baseUrl..." FAIL (message не содержит URL)

---

### Task 5: Реализация baseUrl hint в AgentRunner

**Files:**
- Modify: `src/agent-runner.ts:118`
- Test: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Добавить baseUrlHint в system событие**

В файле `src/agent-runner.ts`, найди строку 118:
```typescript
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}` };
```

Замени на:
```typescript
    const baseUrlHint = this.settings.backend === "native-agent"
      ? ` @ ${this.settings.nativeAgent.baseUrl}`
      : "";
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };
```

- [ ] **Step 2: Запустить тест — должен пройти**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```
Expected: все тесты passed

- [ ] **Step 3: Commit**

```bash
git add src/agent-runner.ts tests/agent-runner.integration.test.ts
git commit -m "feat(agent-runner): include baseUrl in system event for native-agent"
```

---

### Task 6: Таймаут и детекция тихого abort в dispatch

**Files:**
- Modify: `src/controller.ts:554-648`

Это изменение сложно покрыть unit-тестом без большого мока всего стека. Реализуем и верифицируем через `npm run build`.

- [ ] **Step 1: Добавить timedOut флаг и setTimeout после строки 569**

В `src/controller.ts`, найди блок (строки 568-571):
```typescript
    const opKey = op === "query-save" ? "query" : op === "lint-chat" ? "lint" : op;
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
    const resolvedChatMessages = op === "format" ? this._pendingFormat?.chat : chatMessages;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages });
```

Замени на:
```typescript
    const opKey = op === "query-save" ? "query" : op === "lint-chat" ? "lint" : op;
    const timeoutMs = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts] * 1000;
    let timedOut = false;
    const timeoutId = timeoutMs > 0
      ? window.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs)
      : null;
    const resolvedChatMessages = op === "format" ? this._pendingFormat?.chat : chatMessages;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages });
```

- [ ] **Step 2: Добавить clearTimeout в finally**

Найди блок `finally` (строки 608-613):
```typescript
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
      this._currentLogMeta = null;
    }
```

Замени на:
```typescript
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
      this._currentLogMeta = null;
    }
```

- [ ] **Step 3: Добавить детекцию тихого abort после finally**

Найди строку после finally (строка 614):
```typescript
    if (status === "done") {
      const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "query-save" || op === "init";
```

Вставь **перед** этой строкой:
```typescript
    if (ctrl.signal.aborted && status === "done" && !finalText) {
      if (timedOut) {
        status = "error";
        finalText = `Timeout after ${Math.round(timeoutMs / 1000)}s — check LLM backend URL`;
        this.activeView()?.appendEvent({ kind: "error", message: finalText });
        await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
      } else {
        status = "cancelled";
      }
    }
```

- [ ] **Step 4: Запустить все тесты — не должны ломаться**

```bash
npm test
```
Expected: все тесты passed

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "fix(controller): add timeout abort and surface error on silent abort in dispatch"
```

---

### Task 7: Сборка релиза

**Files:**
- Modify: `package.json` (patch version bump)
- Modify: `src/manifest.json` (patch version bump)
- Build: `main.js`

- [ ] **Step 1: Прочитать текущую версию**

```bash
node -e "const p=require('./package.json'); console.log(p.version)"
```
Expected: что-то вроде `1.2.3`

- [ ] **Step 2: Поднять patch версию в package.json и src/manifest.json**

Пример для версии `1.2.3` → `1.2.4`:
```bash
node -e "
const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const [ma,mi,pa]=pkg.version.split('.').map(Number);
const next=[ma,mi,pa+1].join('.');
pkg.version=next;
fs.writeFileSync('package.json',JSON.stringify(pkg,null,'\t')+'\n');
const mf=JSON.parse(fs.readFileSync('src/manifest.json','utf8'));
mf.version=next;
fs.writeFileSync('src/manifest.json',JSON.stringify(mf,null,'\t')+'\n');
console.log('bumped to',next);
"
```

- [ ] **Step 3: Собрать**

```bash
npm run build
```
Expected: `main.js` пересобран без ошибок TypeScript

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "build: bump version and rebuild for mobile query fix"
```

---

### Task 8: Ручное тестирование на мобильном

**Files:** нет изменений кода

- [ ] **Step 1: Сценарий — недоступный хост**

Настроить `baseUrl` на недоступный хост (например, `https://homelab.example.com/v1`).
Запустить `query` на любом домене.
Expected: операция завершается через `timeoutMs` секунд с ошибкой «Timeout after Xs — check LLM backend URL»; статус "error" в Progress-панели.

- [ ] **Step 2: Сценарий — корректный baseUrl**

Настроить `baseUrl` на доступный хост.
Запустить `query`.
Expected: шаги Glob → system event содержит baseUrl → LLM-ответ → результат отображается; поведение идентично десктопу.

- [ ] **Step 3: Сценарий — Cancel во время запроса**

Запустить `query`, немедленно нажать Cancel.
Expected: операция завершается немедленно со статусом "cancelled"; нет пустого результата и нет зависания.

---

## Self-Review

**Spec coverage:**
- [x] Bug 1: `mobileFetch` не пробрасывает AbortSignal → Task 3 (Promise.race + abortRace)
- [x] Bug 2: `dispatch` не устанавливает таймаут → Task 6 (timedOut + setTimeout)
- [x] Bug 3: silent abort → пустой результат → Task 6 (detect + status="error"/"cancelled")
- [x] Диагностика baseUrl → Task 5 (system event hint)
- [x] Unit тест: already aborted → уже был в tests/mobile-fetch.test.ts
- [x] Unit тест: signal срабатывает после старта → Task 2 + 3
- [x] Unit тест: успешный запрос → уже был в tests/mobile-fetch.test.ts
- [x] Integration тест baseUrl в system event → Task 4 + 5
- [x] Ручное тестирование мобильного → Task 8 (3 сценария)

**Placeholder scan:** Нет TBD/TODO/placeholder.

**Type consistency:** `timedOut` (boolean), `timeoutId` (number | null) — используются только в Task 6 в пределах одного метода. `abortRace` возвращает `Promise<never>` — совместимо с `Promise.race`.
