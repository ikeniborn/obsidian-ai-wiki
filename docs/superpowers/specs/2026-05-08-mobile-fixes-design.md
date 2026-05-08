# Mobile fixes + per-device settings + ingest silent-fail fix

**Date:** 2026-05-08
**Scope:** v0.1.61 follow-up to v0.1.59 mobile support

## Problem

Шесть связанных проблем:

1. **Mobile + Ollama Cloud HTTPS connection error.** Запрос на `https://ollama.com/v1` падает CORS из Obsidian Mobile WebView. OpenRouter работает (CORS-friendly), Ollama Cloud — нет.
2. **Mobile UI: per-operation toggle избыточен.** Mobile использует только `query` — настройки per-op-моделей бесполезны и засоряют интерфейс.
3. **Mobile UI: dev mode toggle избыточен.** Dev-логирование требует fs-доступа, evaluator-цикл удлиняет операцию — на mobile не нужно.
4. **Backend/API настройки device-specific.** На разных устройствах могут быть разные ключи/baseUrl/модели. Сейчас всё в `data.json` синкается через Obsidian Sync.
5. **Desktop: ingest silent fail.** После refactor v0.1.59 (lazy-load `node:fs`/`node:path`) клик "Run" в ConfirmModal не приводит ни к какому видимому действию. Console: `Failed to fetch dynamically imported module: node:fs`.
6. **Mobile логи отсутствуют.** Логи пишутся через `node:fs` в `<vault>/!Logs/`. Gate `if (Platform.isMobile) return;` отрубает всю запись. Но vault-adapter работает на mobile — логи можно писать через него.

## Root causes

### Issue 1 — CORS

`OpenAI` SDK использует стандартный `fetch()`. Obsidian Mobile WebView origin = `app://obsidian.md`. Сервер должен отдавать `Access-Control-Allow-Origin: *` или эхо-значение origin. Ollama Cloud этого не делает.

Obsidian предоставляет `requestUrl()` — ходит из native-слоя плагина (Capacitor), CORS не применяется. OpenAI SDK 6.x принимает custom `fetch` через конструктор (`node_modules/openai/client.d.ts:92`).

### Issue 5 — silent fail (root)

Esbuild с `external: ["node:fs", ...]` оставляет **статический** `import {...} from "node:fs"` как `require("node:fs")` (CJS, работает в Electron). Но **динамический** `await import("node:fs")` esbuild не транслирует — браузер выполняет реальный ES dynamic import → пытается fetch URL `node:fs` → CORS-блок.

Коммиты `fe2934c` (controller) и `84bc244` (agent-runner) перевели `node:fs`/`node:path` на динамические импорты для mobile-compat. Это сломало desktop.

Симптом silent: `dispatch:319` вызывает `buildAgentRunner` вне `try/catch`. Throw → unhandled rejection → caller `void this.controller.ingestActive(...)` глотает.

## Solution

### 1. Mobile fetch via requestUrl

Новый файл `src/mobile-fetch.ts`:

```ts
import { requestUrl } from "obsidian";

export const mobileFetch: typeof fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.toString() : (input as Request).url;
  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }
  const r = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: body ?? undefined,
    throw: false,
  });
  return new Response(r.text, { status: r.status, headers: r.headers });
};
```

В `controller.ts:273`:
```ts
import { Platform } from "obsidian";
import { mobileFetch } from "./mobile-fetch";

llm = new OpenAI({
  baseURL: s.nativeAgent.baseUrl,
  apiKey: s.nativeAgent.apiKey,
  timeout: maxTimeoutSec * 1000,
  dangerouslyAllowBrowser: true,
  fetch: Platform.isMobile ? mobileFetch : undefined,
});
```

**Trade-offs**:
- Streaming-чанки приходят все разом после полного ответа (`requestUrl` не стримит). UX: ответ появляется одним блоком вместо токенов. Допустимо для query.
- AbortSignal не пробрасывается в `requestUrl` — отмена не прерывает HTTP. Caller (`query.ts:93,101`) уже проверяет `signal.aborted` после await — отменённая операция не отрисует ответ.

### 2. Hide per-operation toggle on mobile

`settings.ts`:
- Toggle `nativeAgent.perOperation` (line 294-300) → `if (!Platform.isMobile) { ... }`.
- Блок `if (s.nativeAgent.perOperation) { ... }` (line 302-339) — оставить как есть; на mobile `perOperation` форсится в `false` при загрузке, ветка не активируется.

`main.ts loadSettings()` после миграций:
```ts
if (Platform.isMobile) {
  this.settings.nativeAgent.perOperation = false;
  this.settings.devMode.enabled = false;
}
```

### 3. Hide dev mode on mobile

`settings.ts:343-363` — обернуть весь блок Dev mode в `if (!Platform.isMobile) { ... }`.

### 4. Per-device backend+API in local.json

Расширить `LocalConfig` в `src/local-config.ts`:

```ts
export interface LocalConfig {
  iclaudePath: string;
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
  };
  migrated_v1?: boolean;
}
```

**Стратегия overlay** — новый модуль `src/effective-settings.ts`:

```ts
import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig } from "./local-config";

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): LlmWikiPluginSettings {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...(l.claudeAgent ?? {}) },
    nativeAgent: { ...s.nativeAgent, ...(l.nativeAgent ?? {}) },
  };
}
```

Все потребители (`controller.buildAgentRunner`, `agent-runner.buildOptsFor`, `settings.ts` UI) читают через `resolveEffective(this.plugin.settings, await this.localConfigStore.load())`.

Settings UI: поля `backend / baseUrl / apiKey / model / temperature / numCtx / topP / allowedTools / claudeAgent.model / iclaudePath` пишут в `localConfigStore`. Поля `systemPrompt / timeouts / historyLimit / domains / history` остаются в `data.json`.

**Миграция (one-shot)** — `main.ts onload` после `loadSettings`:

```ts
const local = await this.localConfigStore.load();
if (!local.migrated_v1) {
  await this.localConfigStore.save({
    backend: this.settings.backend,
    nativeAgent: {
      baseUrl: this.settings.nativeAgent.baseUrl,
      apiKey: this.settings.nativeAgent.apiKey,
      model: this.settings.nativeAgent.model,
      temperature: this.settings.nativeAgent.temperature,
      topP: this.settings.nativeAgent.topP,
      numCtx: this.settings.nativeAgent.numCtx,
    },
    claudeAgent: {
      model: this.settings.claudeAgent.model,
      allowedTools: this.settings.claudeAgent.allowedTools,
    },
    agentLogEnabled: this.settings.agentLogEnabled,
    migrated_v1: true,
  });
  this.settings.nativeAgent.apiKey = "";
  await this.saveSettings();
}
```

**Безопасность**: `apiKey` вычищается из `data.json` после миграции — не попадает в Sync.

`perOperation` и `operations[]` остаются в `data.json` (UX-предпочтения). На mobile `perOperation` форсится `false` — `operations[]` не виден всё равно.

### 5. Ingest silent-fail fix

**Часть A: убрать динамические `node:*` импорты.** Esbuild оставляет статические external-импорты как `require()`. Динамические превращаются в URL fetch.

Замены:

| Файл:line | Было | Стало |
|---|---|---|
| `controller.ts:222` | `const { existsSync } = await import("node:fs");` | `const { existsSync } = require("node:fs") as typeof import("node:fs");` |
| `controller.ts:252-253` | dyn `node:path`/`node:fs` | sync `require` |
| `controller.ts:429` | dyn `node:path` | sync `require` |
| `agent-runner.ts:38-50` (writeDevLog) | dyn fs/path | заменить на vault adapter (см. часть C) |
| `agent-runner.ts:144-159` (updateDevLogEval) | dyn fs/path | заменить на vault adapter |

`require()` в TypeScript: добавить в начале файла где нужно
```ts
declare const require: NodeJS.Require;
```
если TS жалуется. Esbuild оставляет `require("node:fs")` неизменным благодаря `external` в config.

**Часть B: try/catch вокруг buildAgentRunner.** В `dispatch` (line 319) и `dispatchChat` (line 85):

```ts
let agentRunner: AgentRunner;
try {
  agentRunner = await this.buildAgentRunner(vaultRoot);
} catch (e) {
  new Notice(i18n().ctrl.errorPrefix((e as Error).message));
  console.error("[llm-wiki] buildAgentRunner failed", e);
  return;
}
```

**Часть C: console.error в dispatch catch.** `dispatch:365`:
```ts
} catch (err) {
  status = "error";
  console.error("[llm-wiki] dispatch failed", err);
  finalText = i18n().ctrl.errorPrefix((err as Error).message);
  ...
}
```

### 6. Mobile logs via vault adapter

`controller.logEvent`:

```ts
private async logEvent(
  vaultRoot: string,
  sessionId: string,
  op: WikiOperation,
  domainId: string | undefined,
  ev: RunEvent,
): Promise<void> {
  if (!this.plugin.settings.agentLogEnabled) return;
  void vaultRoot;
  const adapter = this.plugin.app.vault.adapter;
  const dir = "!Logs";
  const path = `${dir}/agent.jsonl`;
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session: sessionId, op, domainId, event: ev,
    }) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* не блокируем операцию */ }
}
```

Дропнуть `if (Platform.isMobile) return;` — теперь работает везде.

`agent-runner.writeDevLog`:

```ts
private async writeDevLog(_vaultRoot: string, entry: { ... }): Promise<void> {
  if (!this.settings.devMode?.enabled) return;
  const adapter = this.vaultTools.adapter;
  const dir = "!Logs";
  const path = `${dir}/dev.jsonl`;
  try {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, eval: null }) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* не блокируем */ }
}
```

(Требует expose `adapter` из `VaultTools` — добавить геттер.)

`agent-runner.updateDevLogEval` — аналогично через `adapter.read` + `adapter.write`.

На mobile dev-mode форсится `false` (issue 3) — `writeDevLog` не вызывается. Но код корректен и для будущего.

## Architecture impact

```
┌─────────────────────────┐    ┌─────────────────────────┐
│ data.json (Synced)      │    │ local.json (Per-device) │
├─────────────────────────┤    ├─────────────────────────┤
│ systemPrompt            │    │ iclaudePath             │
│ maxTokens               │    │ backend                 │
│ timeouts                │    │ agentLogEnabled         │
│ historyLimit            │    │ nativeAgent.{           │
│ history[]               │    │   baseUrl, apiKey,      │
│ domains (legacy)        │    │   model, temperature,   │
│ {claude,native}Agent.{  │    │   topP, numCtx          │
│   perOperation,         │    │ }                       │
│   operations[]          │    │ claudeAgent.{           │
│ }                       │    │   model, allowedTools   │
│ devMode.{enabled,       │    │ }                       │
│   evaluatorModel}       │    │ migrated_v1             │
└─────────────────────────┘    └─────────────────────────┘
              │                              │
              └──────────┬───────────────────┘
                         ▼
              resolveEffective(s, l)
                         │
                         ▼
            controller.buildAgentRunner
            agent-runner.buildOptsFor
            settings.ts UI
```

## Test plan

1. **CORS fix**: на mobile с `https://ollama.com/v1` + валидным API key — query завершается с ответом.
2. **Mobile UI**: при `Platform.isMobile=true` (через тест-helper `__setPlatformMobile`) — в settings нет per-operation toggle и Dev mode block.
3. **Per-device migration**: запустить на свежем data.json с заполненным `nativeAgent.apiKey` → проверить, что после `onload` `local.json.nativeAgent.apiKey` содержит ключ, а `data.json.nativeAgent.apiKey === ""`. Повторный запуск — `migrated_v1` не повторяет миграцию.
4. **Effective resolver**: `resolveEffective({ ..., backend: "claude-agent" }, { backend: "native-agent" })` → `.backend === "native-agent"`.
5. **Ingest desktop fix**: с claude-agent backend и валидным `iclaudePath` клик Ingest → Run → процесс запускается, в панели появляются tool_use события.
6. **Vault-adapter logs**: с `agentLogEnabled: true` после ingest — `<vault>/!Logs/agent.jsonl` содержит JSONL-записи. Тестировать как desktop, так и mobile (через mock adapter).
7. **Регрессия**: existing test suite (`tests/` все проходят).

## Out of scope

- Шифрование apiKey в local.json (plain JSON остаётся).
- UI для миграции settings обратно в data.json (manually edit local.json).
- Streaming через SSE на mobile (требует поддержку chunked response в `requestUrl` — отсутствует в API).
