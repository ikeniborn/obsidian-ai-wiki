---
review:
  spec_hash: "940bbe4b810c27db"
  last_run: "2026-05-17"
  phases:
    structure:   {status: passed}
    coverage:    {status: passed}
    clarity:     {status: passed}
    consistency: {status: passed}
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Testing"
      section_hash: "5c99d71167aea72d"
      text: "\"мок с задержкой\" без указания конкретного значения — тест-имплементация варьируется"
      verdict: fixed
      verdict_at: "2026-05-17"
---
# Mobile Query Fix — Design Spec

**Date:** 2026-05-17  
**Status:** Approved  
**Scope:** `mobile-fetch.ts`, `controller.ts`, `agent-runner.ts`

---

## Problem

На мобильном устройстве запрос по домену (`query`) зависает после шагов Glob/system и никогда не завершается. LLM-бэкенд запросов не получает. Пользователь видит статус «running» вечно, отмена не работает.

**Подтверждённый сценарий:** `baseUrl = https://homelab.ikeniborn.ru/v1`. Сервер недоступен с мобильного устройства (LAN/VPN/сеть) или SSL-ошибка. `requestUrl` зависает на TCP-соединении.

**Три кодовых бага:**

1. `mobileFetch` не пробрасывает `AbortSignal` в `requestUrl` — зависший запрос нельзя прервать.
2. `dispatch` не устанавливает таймаут на `ctrl` — операция висит вечно независимо от `timeoutMs`.
3. При abort (таймаут или кнопка Cancel) `runQuery` возвращается без ошибки (`signal.aborted` → silent return), пользователь видит пустой результат вместо сообщения об ошибке.

---

## Architecture

Три точки изменений:

| Файл | Изменение |
|---|---|
| `src/mobile-fetch.ts` | `Promise.race` с AbortSignal watcher |
| `src/controller.ts` | Таймаут в `dispatch`; detect timeout-abort → показать ошибку + логировать |
| `src/agent-runner.ts` | Добавить `baseUrl` в системное событие для диагностики |

---

## Component Design

### 1. `mobile-fetch.ts` — AbortSignal через Promise.race

```typescript
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

`requestUrl` продолжает выполняться в фоне (нельзя прервать), но цепочка обещаний разблокируется немедленно при abort.

### 2. `controller.ts` — Таймаут + показ ошибки при abort

`timeoutMs` вычисляется после `const ctrl = new AbortController()` (строки 554 и 568). Добавить флаг `timedOut` и таймер **после** вычисления `timeoutMs`, перед `const runGen = agentRunner.run(...)`:

```typescript
let timedOut = false;
const timeoutId = timeoutMs > 0
  ? window.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs)
  : null;
```

В `finally`:

```typescript
if (timeoutId !== null) window.clearTimeout(timeoutId);
```

После `for await` loop, перед `finish(entry)` — detect silent abort:

```typescript
// runQuery (и другие фазы) при abort возвращаются без ошибки.
// Восстанавливаем статус вручную.
if (ctrl.signal.aborted && status === "done" && !finalText) {
  if (timedOut) {
    status = "error";
    finalText = `Timeout after ${Math.round(timeoutMs / 1000)}s — check LLM backend URL`;
    this.activeView()?.appendEvent({ kind: "error", message: finalText });
    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
  } else {
    // явная отмена пользователем
    status = "cancelled";
  }
}
```

**Важно:** `logEvent` здесь вызывается без изменений — пишет в `agent.jsonl` только если `agentLogEnabled` включён (существующее поведение, не меняем).

### 3. `agent-runner.ts` — baseUrl в системном событии

В методе `run()`, при формировании первого `system`-события:

```typescript
const baseUrlHint = this.settings.backend === "native-agent"
  ? ` @ ${this.settings.nativeAgent.baseUrl}`
  : "";
yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };
```

Позволяет сразу видеть в `agent.jsonl` и в Progress, какой URL используется. Упрощает диагностику "не тот `baseUrl`".

---

## Data Flow (исправленный)

```
dispatch()
  → setTimeout(timeoutMs, ctrl.abort + timedOut=true)
  → agentRunner.run()
      → yield system ("native-agent / model @ https://homelab...")
      → runQuery()
          → listFiles() ✓
          → llm.create({ stream: true })
              → wrapMobileNoStream → stream: false
                  → openaiClient.create(noStream)
                      → mobileFetch()
                          → Promise.race([requestUrl(...), abortRace(signal)])
                          ← AbortError при signal.abort()
          ← runQuery: signal.aborted → return (silent)
  ← for-await loop ends normally, finalText=""
  → detect: ctrl.signal.aborted && !finalText && timedOut
      → status="error", finalText="Timeout after Xs — check LLM backend URL"
      → view.appendEvent({ kind: "error" })
      → logEvent(agent.jsonl, error)  [если agentLogEnabled]
  → finally: clearTimeout(timeoutId)
  → finish(entry) — показывает ошибку пользователю
```

---

## Error Handling

| Сценарий | До фикса | После фикса |
|---|---|---|
| Сервер недоступен, TCP timeout | Вечный hang | Ошибка через `timeoutMs` сек, сообщение пользователю, лог (если включён) |
| SSL / HTTP ошибка (не hang) | Тихий fail | Ошибка всплывает через обычный catch, показывается и логируется |
| Пользователь нажимает Cancel | requestUrl продолжает, нет feedback | AbortError немедленно, статус "cancelled" |
| agentLogEnabled = false | — | Логирование не меняется — только если включён |

---

## Testing

**Unit:**
- `tests/mobile-fetch.test.ts` — новый файл:
  - Тест: AbortSignal уже aborted → немедленный AbortError
  - Тест: AbortSignal срабатывает после старта `requestUrl` (мок с задержкой 50 мс) → AbortError через race
  - Тест: успешный запрос без signal → Response с нужными полями

**Integration:**
- `tests/agent-runner.integration.test.ts` — проверить что system event содержит baseUrl для native-agent

**Ручное тестирование (мобильное):**
- Настроить `baseUrl` на недоступный хост → query → должен завершиться с ошибкой "Timeout after Xs" через `timeoutMs` секунд
- Настроить корректный `baseUrl` → query → должен работать как на десктопе (шаги Glob → LLM ответ → результат)
- Нажать Cancel во время запроса → должен отмениться немедленно, статус "cancelled"

---

## Out of Scope

- Исправление сетевой конфигурации (это задача пользователя — настроить доступный `baseUrl`)
- Прерывание `requestUrl` изнутри (API Obsidian не поддерживает)
- Поддержка других мобильных операций (ingest, lint) — они намеренно заблокированы
- `dispatchChat` — аналогичная проблема, отдельная задача
