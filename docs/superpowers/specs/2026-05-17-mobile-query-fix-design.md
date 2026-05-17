# Mobile Query Fix — Design Spec

**Date:** 2026-05-17  
**Status:** Approved  
**Scope:** `mobile-fetch.ts`, `controller.ts`, `agent-runner.ts`

---

## Problem

На мобильном устройстве запрос по домену (`query`) зависает после шагов Glob/system и никогда не завершается. LLM-бэкенд запросов не получает. Пользователь видит статус «running» вечно, отмена не работает.

**Подтверждённый сценарий:** `baseUrl = https://homelab.ikeniborn.ru/v1`. Сервер недоступен с мобильного устройства (LAN/VPN/сеть) или SSL-ошибка. `requestUrl` зависает на TCP-соединении.

**Два кодовых бага:**

1. `mobileFetch` не пробрасывает `AbortSignal` в `requestUrl` — зависший запрос нельзя прервать.
2. `dispatch` не устанавливает таймаут на `ctrl` — операция висит вечно независимо от `timeoutMs`.

**Следствие:** Ошибка никогда не всплывает → `catch` в `dispatch` не срабатывает → `agent.jsonl` не получает запись об ошибке → диагностика невозможна.

---

## Architecture

Три точки изменений:

| Файл | Изменение |
|---|---|
| `src/mobile-fetch.ts` | `Promise.race` с AbortSignal watcher |
| `src/controller.ts` | `setTimeout → ctrl.abort()` в `dispatch`; force-логирование ошибок |
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

### 2. `controller.ts` — Таймаут в `dispatch`

`timeoutMs` вычисляется после `const ctrl = new AbortController()` (строки 554 и 568 в текущем коде). Таймер устанавливается **после** вычисления `timeoutMs`, перед `const runGen = agentRunner.run(...)`:

```typescript
// после: const timeoutMs = this.plugin.settings.timeouts[...] * 1000;
const timeoutId = timeoutMs > 0
  ? window.setTimeout(() => ctrl.abort(), timeoutMs)
  : null;
```

В `finally` (уже существует, добавить одну строку):

```typescript
if (timeoutId !== null) window.clearTimeout(timeoutId);
```

### 3. `controller.ts` — Force-логирование ошибок

`logEvent` получает необязательный параметр `force?: boolean`:

```typescript
private async logEvent(..., ev: RunEvent, force?: boolean): Promise<void> {
  if (!force && !this.plugin.settings.agentLogEnabled) return;
  // остальное без изменений
}
```

Вызовы старта, финиша и ошибок используют `force=true`:

```typescript
await this.logEvent(vaultRoot, sessionId, op, domainId, startEvent, true);
// ...
await this.logEvent(vaultRoot, sessionId, op, domainId, errorEvent, true);
await this.logEvent(vaultRoot, sessionId, op, domainId, finishEvent, true);
```

### 4. `agent-runner.ts` — baseUrl в системном событии

В `buildOptsFor` — нет. В `run()`:

```typescript
const baseUrlHint = this.settings.backend === "native-agent"
  ? ` @ ${this.settings.nativeAgent.baseUrl}`
  : "";
yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };
```

Это позволяет сразу видеть в `agent.jsonl` и в Progress, какой URL используется.

---

## Data Flow (исправленный)

```
dispatch()
  → setTimeout(timeoutMs, ctrl.abort)
  → agentRunner.run()
      → yield system ("native-agent / model @ https://homelab...")
      → runQuery()
          → listFiles() ✓
          → llm.create({ stream: true })
              → wrapMobileNoStream → stream: false
                  → openaiClient.create(noStream)
                      → mobileFetch()
                          → Promise.race([requestUrl(...), abortRace(signal)])
                          ← AbortError при signal.abort() (таймаут или кнопка Cancel)
  ← AbortError propagates через chain
  → catch(err): logEvent(agent.jsonl, error, force=true)
  → view.appendEvent({ kind: "error" })
  → finally: clearTimeout(timeoutId)
```

---

## Error Handling

| Сценарий | До фикса | После фикса |
|---|---|---|
| Сервер недоступен, TCP timeout | Вечный hang | AbortError через `timeoutMs`, запись в agent.jsonl |
| SSL ошибка | Hang или тихий fail | AbortError или HTTP error, запись в agent.jsonl |
| Пользователь нажимает Cancel | Не работает (requestUrl продолжает) | AbortError немедленно |
| agentLogEnabled = false | Ошибки не логируются | Старт/финиш/ошибки всегда логируются |

---

## Testing

- `tests/mobile-fetch.test.ts` — новый: тест AbortSignal через Promise.race (мок `requestUrl`)
- `tests/agent-runner.integration.test.ts` — добавить проверку baseUrl в system event
- Ручное тестирование: запустить query с недоступным baseUrl → должен завершиться с ошибкой через `timeoutMs`

---

## Out of Scope

- Исправление сетевой конфигурации (это задача пользователя — настроить доступный `baseUrl`)
- Прерывание `requestUrl` изнутри (API Obsidian не поддерживает)
- Поддержка других мобильных операций (ingest, lint) — они намеренно заблокированы
