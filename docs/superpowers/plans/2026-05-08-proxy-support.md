# Proxy support for native-agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить HTTP/HTTPS-прокси (с опциональным basic-auth и `noProxy`) для `native-agent` backend на десктопе; на мобильном — Notice-предупреждение.

**Architecture:** Конфигурация прокси хранится в `local.json` через расширение `LocalConfig`. Утилиты прокси изолированы в новом модуле `src/proxy.ts`. Интеграция — одна точка в `controller.buildAgentRunner` для `native-agent` ветки: создаём `HttpsProxyAgent` и пробрасываем через опцию `httpAgent` OpenAI SDK. Для `claude-agent` ничего не меняем (out of scope).

**Tech Stack:** TypeScript, Obsidian Plugin API, OpenAI SDK, `https-proxy-agent`, vitest.

**Spec:** `docs/superpowers/specs/2026-05-08-proxy-support-design.md`

---

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `package.json` | Modify | Добавить `https-proxy-agent` в `dependencies` |
| `src/local-config.ts` | Modify | Добавить `ProxyConfig` и поле `proxy?` в `LocalConfig` |
| `src/proxy.ts` | Create | Чистые утилиты: `buildProxyUrl`, `parseNoProxy`, `shouldBypass`, `createProxyAgent`, `maskProxyUrl` |
| `src/effective-settings.ts` | Modify | Возвращать `proxy` (default `{enabled:false,url:""}`) |
| `src/types.ts` | Modify | Расширить return-type `resolveEffective` через `proxy: ProxyConfig` |
| `src/i18n.ts` | Modify | Строки `proxy_*` для en/ru/es |
| `src/settings.ts` | Modify | UI секция Proxy (только для `native-agent`) |
| `src/controller.ts` | Modify | В `buildAgentRunner`/native-agent ветке создать агент и передать в `OpenAI` |
| `tests/proxy.test.ts` | Create | Unit-тесты utility-функций |
| `tests/effective-settings.test.ts` | Modify | Проверить, что `proxy` приходит из local |

---

## Task 1: Добавить зависимость `https-proxy-agent`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Добавить пакет**

```bash
npm install --save https-proxy-agent@^7.0.0
```

- [ ] **Step 2: Проверить, что `package.json` содержит зависимость**

Run: `grep https-proxy-agent package.json`
Expected: строка `"https-proxy-agent": "^7.0.0"` в `dependencies`.

- [ ] **Step 3: Проверить, что есbuild не упадёт**

Run: `npm run build`
Expected: успешная сборка `main.js`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add https-proxy-agent"
```

---

## Task 2: Расширить `LocalConfig`

**Files:**
- Modify: `src/local-config.ts`

- [ ] **Step 1: Добавить экспорт `ProxyConfig` и поле `proxy?` в `LocalConfig`**

Заменить блок интерфейсов (строки 3–20) на:

```ts
export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
  noProxy?: string;
}

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
  proxy?: ProxyConfig;
  migrated_v1?: boolean;
}
```

- [ ] **Step 2: Проверить компиляцию**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Прогнать существующие тесты `local-config`**

Run: `npx vitest run tests/local-config.test.ts`
Expected: PASS — поведение не изменилось (новое поле опционально).

- [ ] **Step 4: Commit**

```bash
git add src/local-config.ts
git commit -m "feat(local-config): add ProxyConfig schema"
```

---

## Task 3: Утилита `maskProxyUrl` (TDD)

**Files:**
- Create: `src/proxy.ts`
- Create: `tests/proxy.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/proxy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { maskProxyUrl } from "../src/proxy";

describe("maskProxyUrl", () => {
  it("masks user:pass to user:****", () => {
    expect(maskProxyUrl("http://alice:secret@proxy.example.com:8080"))
      .toBe("http://alice:****@proxy.example.com:8080");
  });
  it("returns url unchanged when no creds", () => {
    expect(maskProxyUrl("http://proxy.example.com:8080"))
      .toBe("http://proxy.example.com:8080");
  });
  it("handles malformed url by returning original", () => {
    expect(maskProxyUrl("not a url")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL — `Cannot find module '../src/proxy'`.

- [ ] **Step 3: Минимальная реализация**

Создать `src/proxy.ts`:

```ts
export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.password) return url;
    u.password = "****";
    return u.toString();
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Тесты должны пройти**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat(proxy): maskProxyUrl util"
```

---

## Task 4: `parseNoProxy` (TDD)

**Files:**
- Modify: `src/proxy.ts`
- Modify: `tests/proxy.test.ts`

- [ ] **Step 1: Добавить падающие тесты**

Дописать в `tests/proxy.test.ts`:

```ts
import { parseNoProxy } from "../src/proxy";

describe("parseNoProxy", () => {
  it("splits CSV and trims", () => {
    expect(parseNoProxy("localhost, 127.0.0.1 ,*.internal"))
      .toEqual(["localhost", "127.0.0.1", "*.internal"]);
  });
  it("drops empty entries", () => {
    expect(parseNoProxy("a,,b,")).toEqual(["a", "b"]);
  });
  it("returns [] for undefined", () => {
    expect(parseNoProxy(undefined)).toEqual([]);
  });
  it("returns [] for empty string", () => {
    expect(parseNoProxy("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL — `parseNoProxy is not a function`.

- [ ] **Step 3: Реализовать**

Дописать в `src/proxy.ts`:

```ts
export function parseNoProxy(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Тесты должны пройти**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat(proxy): parseNoProxy util"
```

---

## Task 5: `shouldBypass` (TDD)

**Files:**
- Modify: `src/proxy.ts`
- Modify: `tests/proxy.test.ts`

- [ ] **Step 1: Падающие тесты**

```ts
import { shouldBypass } from "../src/proxy";

describe("shouldBypass", () => {
  it("exact match (case-insensitive)", () => {
    expect(shouldBypass("Localhost", ["localhost"])).toBe(true);
    expect(shouldBypass("api.example.com", ["other.com"])).toBe(false);
  });
  it("suffix glob *.domain", () => {
    expect(shouldBypass("api.internal", ["*.internal"])).toBe(true);
    expect(shouldBypass("internal", ["*.internal"])).toBe(false);
    expect(shouldBypass("a.b.internal", ["*.internal"])).toBe(true);
  });
  it("IP literal exact", () => {
    expect(shouldBypass("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(shouldBypass("127.0.0.2", ["127.0.0.1"])).toBe(false);
  });
  it("empty list never bypasses", () => {
    expect(shouldBypass("anything", [])).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — fail**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL — `shouldBypass is not a function`.

- [ ] **Step 3: Реализация**

```ts
export function shouldBypass(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of list) {
    const entry = raw.toLowerCase();
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".internal"
      if (h.endsWith(suffix)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Тесты PASS**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat(proxy): shouldBypass util"
```

---

## Task 6: `buildProxyUrl` (TDD)

**Files:**
- Modify: `src/proxy.ts`
- Modify: `tests/proxy.test.ts`

- [ ] **Step 1: Падающие тесты**

```ts
import { buildProxyUrl } from "../src/proxy";

describe("buildProxyUrl", () => {
  it("returns url unchanged when no creds", () => {
    expect(buildProxyUrl({ enabled: true, url: "http://proxy:8080" }))
      .toBe("http://proxy:8080/");
  });
  it("embeds and url-encodes user/pass", () => {
    const out = buildProxyUrl({
      enabled: true,
      url: "http://proxy:8080",
      username: "alice@corp",
      password: "p@ss:word/!",
    });
    // verify creds are URL-encoded
    expect(out).toContain("alice%40corp:p%40ss%3Aword%2F!@proxy:8080");
  });
  it("throws on malformed url", () => {
    expect(() => buildProxyUrl({ enabled: true, url: "::not a url" }))
      .toThrow();
  });
  it("encodes spaces in password", () => {
    const out = buildProxyUrl({
      enabled: true,
      url: "http://h:1",
      username: "u",
      password: "a b",
    });
    expect(out).toContain("u:a%20b@h:1");
  });
});
```

- [ ] **Step 2: Запустить — fail**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

Добавить в `src/proxy.ts`:

```ts
import type { ProxyConfig } from "./local-config";

export function buildProxyUrl(cfg: ProxyConfig): string {
  const u = new URL(cfg.url);
  if (cfg.username) u.username = encodeURIComponent(cfg.username);
  if (cfg.password) u.password = encodeURIComponent(cfg.password);
  return u.toString();
}
```

- [ ] **Step 4: PASS**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat(proxy): buildProxyUrl util"
```

---

## Task 7: `createProxyAgent` с mobile-mock (TDD)

**Files:**
- Modify: `src/proxy.ts`
- Modify: `tests/proxy.test.ts`

- [ ] **Step 1: Падающие тесты**

В начало `tests/proxy.test.ts` добавить mock и тесты:

```ts
import { vi } from "vitest";

vi.mock("obsidian", () => ({
  Platform: { isMobile: false },
}));

// ...existing tests...

import { createProxyAgent } from "../src/proxy";
import { Platform } from "obsidian";

describe("createProxyAgent", () => {
  it("returns null when disabled", () => {
    expect(createProxyAgent({ enabled: false, url: "http://p:1" })).toBeNull();
  });
  it("returns null on mobile", () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    expect(createProxyAgent({ enabled: true, url: "http://p:1" })).toBeNull();
    (Platform as { isMobile: boolean }).isMobile = false;
  });
  it("returns an agent object on desktop when enabled", () => {
    const a = createProxyAgent({ enabled: true, url: "http://p:1" });
    expect(a).not.toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — fail**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL — `createProxyAgent is not a function`.

- [ ] **Step 3: Реализация**

Дописать в `src/proxy.ts`:

```ts
import { Platform } from "obsidian";

declare const require: NodeJS.Require;

export function createProxyAgent(cfg: ProxyConfig): unknown | null {
  if (!cfg.enabled) return null;
  if (Platform.isMobile) return null;
  const { HttpsProxyAgent } = require("https-proxy-agent") as typeof import("https-proxy-agent");
  return new HttpsProxyAgent(buildProxyUrl(cfg));
}
```

- [ ] **Step 4: PASS**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS — все 5 групп.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat(proxy): createProxyAgent (desktop only)"
```

---

## Task 8: `resolveEffective` отдаёт `proxy`

**Files:**
- Modify: `src/effective-settings.ts`
- Modify: `tests/effective-settings.test.ts`

- [ ] **Step 1: Падающий тест**

Дописать в `tests/effective-settings.test.ts`:

```ts
import type { ProxyConfig } from "../src/local-config";

it("returns proxy from local when present", () => {
  const proxy: ProxyConfig = { enabled: true, url: "http://p:1" };
  const eff = resolveEffective(BASE_SETTINGS, { iclaudePath: "", proxy });
  expect(eff.proxy).toEqual(proxy);
});

it("returns disabled default proxy when missing in local", () => {
  const eff = resolveEffective(BASE_SETTINGS, { iclaudePath: "" });
  expect(eff.proxy).toEqual({ enabled: false, url: "" });
});
```

(используй существующий `BASE_SETTINGS` из файла; если его нет — собери минимальный объект `LlmWikiPluginSettings` через `DEFAULT_SETTINGS` из `../src/types`)

- [ ] **Step 2: Запустить — fail**

Run: `npx vitest run tests/effective-settings.test.ts`
Expected: FAIL — `eff.proxy` is undefined.

- [ ] **Step 3: Расширить `resolveEffective`**

Заменить содержимое `src/effective-settings.ts`:

```ts
import type { LlmWikiPluginSettings } from "./types";
import type { LocalConfig, ProxyConfig } from "./local-config";

export type EffectiveSettings = LlmWikiPluginSettings & { proxy: ProxyConfig };

export function resolveEffective(
  s: LlmWikiPluginSettings,
  l: LocalConfig,
): EffectiveSettings {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...(l.claudeAgent ?? {}) },
    nativeAgent: { ...s.nativeAgent, ...(l.nativeAgent ?? {}) },
    proxy: l.proxy ?? { enabled: false, url: "" },
  };
}
```

- [ ] **Step 4: PASS + общая компиляция**

Run: `npx tsc --noEmit && npx vitest run tests/effective-settings.test.ts`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/effective-settings.ts tests/effective-settings.test.ts
git commit -m "feat(effective-settings): expose proxy"
```

---

## Task 9: i18n строки для Proxy секции

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Добавить ключи в `en` (объект `settings`)**

Найти блок `const en = { settings: { ... } }` и добавить:

```ts
proxy_h3: "Proxy",
proxy_enabled_name: "Use proxy",
proxy_enabled_desc: "Route native-agent traffic through HTTP/HTTPS proxy.",
proxy_url_name: "Proxy URL",
proxy_url_desc: "http://proxy.example.com:8080 or https://...",
proxy_username_name: "Username",
proxy_username_desc: "Optional. For basic-auth proxies.",
proxy_password_name: "Password",
proxy_password_desc: "Optional. Stored locally in local.json.",
proxy_noProxy_name: "No-proxy hosts",
proxy_noProxy_desc: "CSV. Supports exact host and *.suffix. Example: localhost,127.0.0.1,*.internal",
proxy_hint: "Proxy applies to native-agent only. claude-agent uses its own configuration. On mobile, proxy is currently not supported.",
proxy_mobile_warning: "Proxy is not supported on mobile in this version.",
proxy_invalid: (m: string) => `Proxy config invalid: ${m}`,
```

- [ ] **Step 2: Добавить те же ключи в `ru`**

```ts
proxy_h3: "Прокси",
proxy_enabled_name: "Использовать прокси",
proxy_enabled_desc: "Маршрутизировать трафик native-agent через HTTP/HTTPS-прокси.",
proxy_url_name: "URL прокси",
proxy_url_desc: "http://proxy.example.com:8080 или https://...",
proxy_username_name: "Логин",
proxy_username_desc: "Опционально. Для прокси с basic-auth.",
proxy_password_name: "Пароль",
proxy_password_desc: "Опционально. Хранится локально в local.json.",
proxy_noProxy_name: "Хосты без прокси",
proxy_noProxy_desc: "CSV. Точное имя или *.суффикс. Пример: localhost,127.0.0.1,*.internal",
proxy_hint: "Прокси применяется только к native-agent. claude-agent использует свою конфигурацию. На мобильном прокси пока не поддерживается.",
proxy_mobile_warning: "Прокси на мобильном пока не поддерживается.",
proxy_invalid: (m: string) => `Некорректная конфигурация прокси: ${m}`,
```

- [ ] **Step 3: Добавить ключи в `es`** (зеркальный перевод; если нет уверенности в формулировках — продублировать `en` строки, главное чтобы все ключи присутствовали и `I18n` тип компилировался).

- [ ] **Step 4: Проверить компиляцию (структурное соответствие `I18n`)**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "i18n: proxy settings strings (en/ru/es)"
```

---

## Task 10: UI секция Proxy в settings.ts

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Добавить helper `patchLocalProxy`**

Около `patchLocalNative` (после строки ~47) добавить метод класса:

```ts
private async patchLocalProxy(patch: Partial<NonNullable<LocalConfig["proxy"]>>): Promise<void> {
  const cur = this.localCache.proxy ?? { enabled: false, url: "" };
  await this.patchLocal({ proxy: { ...cur, ...patch } });
}
```

- [ ] **Step 2: Импортировать `ProxyConfig` если нужно**

В импортах заменить `import type { LocalConfig } from "./local-config";` на `import type { LocalConfig, ProxyConfig } from "./local-config";` (если `ProxyConfig` понадобится — иначе пропустить).

- [ ] **Step 3: Добавить рендер секции Proxy**

После всех настроек `native-agent` (после `if (s.nativeAgent.perOperation) { ... }`-блока) и до секции domains, добавить:

```ts
if (eff.backend === "native-agent") {
  const proxy = eff.proxy;
  new Setting(containerEl).setName(T.settings.proxy_h3).setHeading();

  new Setting(containerEl)
    .setName(T.settings.proxy_enabled_name)
    .setDesc(T.settings.proxy_enabled_desc)
    .addToggle((t) =>
      t.setValue(proxy.enabled)
        .onChange(async (v) => { await this.patchLocalProxy({ enabled: v }); this.display(); }),
    );

  const setDisabled = (s: Setting) => {
    if (!proxy.enabled) s.settingEl.style.opacity = "0.5";
  };

  setDisabled(
    new Setting(containerEl)
      .setName(T.settings.proxy_url_name)
      .setDesc(T.settings.proxy_url_desc)
      .addText((t) =>
        t.setPlaceholder("http://proxy.example.com:8080")
          .setValue(proxy.url)
          .setDisabled(!proxy.enabled)
          .onChange(async (v) => { await this.patchLocalProxy({ url: v.trim() }); }),
      ),
  );

  setDisabled(
    new Setting(containerEl)
      .setName(T.settings.proxy_username_name)
      .setDesc(T.settings.proxy_username_desc)
      .addText((t) =>
        t.setValue(proxy.username ?? "")
          .setDisabled(!proxy.enabled)
          .onChange(async (v) => { await this.patchLocalProxy({ username: v }); }),
      ),
  );

  setDisabled(
    new Setting(containerEl)
      .setName(T.settings.proxy_password_name)
      .setDesc(T.settings.proxy_password_desc)
      .addText((t) => {
        t.setValue(proxy.password ?? "")
          .setDisabled(!proxy.enabled)
          .onChange(async (v) => { await this.patchLocalProxy({ password: v }); });
        t.inputEl.type = "password";
      }),
  );

  setDisabled(
    new Setting(containerEl)
      .setName(T.settings.proxy_noProxy_name)
      .setDesc(T.settings.proxy_noProxy_desc)
      .addText((t) =>
        t.setPlaceholder("localhost,127.0.0.1")
          .setValue(proxy.noProxy ?? "")
          .setDisabled(!proxy.enabled)
          .onChange(async (v) => { await this.patchLocalProxy({ noProxy: v.trim() }); }),
      ),
  );

  containerEl.createEl("p", { text: T.settings.proxy_hint, cls: "setting-item-description" });
}
```

(если место для блока неоднозначно — поместить сразу после последнего `new Setting(containerEl)` для native-agent и до начала следующей секции)

- [ ] **Step 4: Проверить компиляцию + сборка**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors, `main.js` собран.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): Proxy UI section for native-agent"
```

---

## Task 11: Интеграция в `controller.buildAgentRunner`

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Импорт**

В верх файла добавить:

```ts
import { createProxyAgent, parseNoProxy, shouldBypass, maskProxyUrl } from "./proxy";
```

- [ ] **Step 2: Заменить native-agent ветку**

Заменить `else { ... new OpenAI(...) ... }` (строки ~374–383) на:

```ts
} else {
  this._currentClaudeClient = null;

  const proxyCfg = s.proxy;
  let httpAgent: unknown | undefined;
  if (proxyCfg.enabled) {
    if (Platform.isMobile) {
      new Notice(i18n().settings.proxy_mobile_warning);
    } else {
      try {
        const baseHost = new URL(s.nativeAgent.baseUrl).hostname;
        const noProxyList = parseNoProxy(proxyCfg.noProxy);
        if (!shouldBypass(baseHost, noProxyList)) {
          httpAgent = createProxyAgent(proxyCfg) ?? undefined;
          if (httpAgent) {
            console.info(`[llm-wiki] using proxy ${maskProxyUrl(proxyCfg.url)}`);
          }
        }
      } catch (e) {
        new Notice(i18n().settings.proxy_invalid((e as Error).message));
      }
    }
  }

  llm = new OpenAI({
    baseURL: s.nativeAgent.baseUrl,
    apiKey: s.nativeAgent.apiKey,
    timeout: maxTimeoutSec * 1000,
    dangerouslyAllowBrowser: true,
    fetch: Platform.isMobile ? mobileFetch : undefined,
    httpAgent,
  });
}
```

Примечание: если у TS-типа `OpenAI` параметры конструктора не содержат `httpAgent` напрямую — добавить cast `as ConstructorParameters<typeof OpenAI>[0]`. Поле принимается рантаймом — необходима проверка через `npx tsc --noEmit`; при ошибке: оборачивать опции в `as unknown as ConstructorParameters<typeof OpenAI>[0]`.

- [ ] **Step 3: Компиляция и существующие тесты**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 errors; все тесты PASS.

- [ ] **Step 4: Commit**

```bash
git add src/controller.ts
git commit -m "feat(controller): apply proxy to native-agent OpenAI client"
```

---

## Task 12: Bump patch-версии и production-build

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Прочитать текущую версию**

Run: `node -p "require('./package.json').version"`
Expected: например `0.1.62`.

- [ ] **Step 2: Поднять patch (X.Y.Z → X.Y.(Z+1))**

Отредактировать `package.json` и `src/manifest.json`, выставить новую версию (например `0.1.63`).

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: успешная сборка, `main.js` обновлён.

- [ ] **Step 4: Полный прогон тестов**

Run: `npx vitest run`
Expected: все тесты PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump patch — proxy support for native-agent"
```

---

## Manual Smoke Test (после всех задач)

- [ ] На десктопе включить `Use proxy`, ввести URL Squid-прокси с basic-auth, выставить корректные `nativeAgent.baseUrl` (Ollama).
- [ ] Запустить любую `query`-операцию.
- [ ] В access-логе Squid убедиться: запрос пришёл, `User-Agent` присутствует, целевой URL = `nativeAgent.baseUrl`.
- [ ] Проверить, что пароль НЕ появляется в `agent.jsonl`/`dev.jsonl` и в консоли (только маска `****`).
- [ ] Добавить хост `nativeAgent.baseUrl` в `noProxy` — убедиться, что прокси пропускается (нет записей в access-логе).
- [ ] На мобильном (если доступно): включить proxy → запустить query → ожидать Notice "Прокси на мобильном пока не поддерживается" и работу без прокси.

---

## Self-Review Checklist (после реализации)

- [ ] Все секции спецификации покрыты задачами:
  - Storage (ProxyConfig в LocalConfig) → Task 2
  - UI секция Proxy → Task 10
  - Модуль `src/proxy.ts` (5 функций) → Tasks 3–7
  - Интеграция controller → Task 11
  - effective-settings.proxy → Task 8
  - Dependency `https-proxy-agent` → Task 1
  - Security (mask, no-leak в логах) → Task 11 (использование `maskProxyUrl`)
  - Тесты → Tasks 3–8
- [ ] Нет TODO/TBD в коде.
- [ ] Имена функций/полей идентичны во всех задачах: `buildProxyUrl`, `parseNoProxy`, `shouldBypass`, `createProxyAgent`, `maskProxyUrl`, `ProxyConfig.enabled/url/username/password/noProxy`.
- [ ] `ProxyConfig.password` не пишется в `data.json` (плагин всегда сохраняет в `local.json` через `LocalConfigStore`).
