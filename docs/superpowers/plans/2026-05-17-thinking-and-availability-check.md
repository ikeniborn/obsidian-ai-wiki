---
review:
  plan_hash: 651060669fab174a
  spec_hash: 1fc3e9a9009b7bf3
  last_run: 2026-05-17
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Task 6: Controller — effort читается из settings и передаётся в ClaudeCliConfig"
      section_hash: "463e1a176b1d3cfe"
      text: "Task 6 деферирует per-op effort в controller.ts («для MVP — достаточно глобального»), но спека §Изменения в `src/controller.ts` явно требует per-op resolution: `claudeEff.operations[currentOpKey]?.effort ?? claudeEff.effort`"
      verdict: fixed
      verdict_at: 2026-05-17
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "## Task 6: Controller — effort читается из settings и передаётся в ClaudeCliConfig"
      section_hash: "463e1a176b1d3cfe"
      text: "Step 2 — DoD сформулирован как «проверяем через типы и код-ревью», команда запуска теста отсутствует. Критерий готовности не измерим."
      verdict: fixed
      verdict_at: 2026-05-17
---

# Thinking Budget & Availability Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить управление thinking budget для обоих бэкендов и кнопки проверки доступности в настройках.

**Architecture:** Два независимых изменения: (1) новые поля `effort`/`thinkingBudgetTokens` в типах, local-config, agent-runner, claude-cli-client и settings UI; (2) функции `checkClaudeAvailability`/`checkNativeAvailability` с кнопками в settings UI.

**Tech Stack:** TypeScript, Obsidian Plugin API, child_process (Node.js), fetch API.

---

## File Structure

| Файл | Изменение |
|---|---|
| `src/types.ts` | `ClaudeOperationConfig.effort`, `NativeOperationConfig.thinkingBudgetTokens`, `LlmCallOptions.thinkingBudgetTokens`, `LlmWikiPluginSettings.claudeAgent.effort`, `LlmWikiPluginSettings.nativeAgent.thinkingBudgetTokens` |
| `src/local-config.ts` | `LocalConfig.claudeAgent.effort` |
| `src/phases/llm-utils.ts` | `buildChatParams()` — добавить `thinking` поле |
| `src/claude-cli-client.ts` | `ClaudeCliConfig.effort`, `_create()` — `--effort` arg |
| `src/agent-runner.ts` | `buildOptsFor()` — извлечение `thinkingBudgetTokens` |
| `src/controller.ts` | Чтение `effort` из settings → `ClaudeCliConfig` |
| `src/settings.ts` | Dropdown effort (claude), text thinkingBudgetTokens (native), кнопки проверки |

---

## Task 1: Типы — effort и thinkingBudgetTokens

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Написать failing тест**

```typescript
// tests/types.test.ts (создать)
import { DEFAULT_SETTINGS } from "../src/types";
import type { ClaudeOperationConfig, NativeOperationConfig, LlmCallOptions } from "../src/types";

it("ClaudeOperationConfig accepts effort field", () => {
  const c: ClaudeOperationConfig = { model: "sonnet", effort: "high" };
  expect(c.effort).toBe("high");
});

it("ClaudeOperationConfig effort is optional", () => {
  const c: ClaudeOperationConfig = { model: "sonnet" };
  expect(c.effort).toBeUndefined();
});

it("NativeOperationConfig accepts thinkingBudgetTokens", () => {
  const c: NativeOperationConfig = { model: "llama3.2", maxTokens: 4096, temperature: 0.2, thinkingBudgetTokens: 8000 };
  expect(c.thinkingBudgetTokens).toBe(8000);
});

it("LlmCallOptions accepts thinkingBudgetTokens", () => {
  const o: LlmCallOptions = { thinkingBudgetTokens: 8000 };
  expect(o.thinkingBudgetTokens).toBe(8000);
});

it("DEFAULT_SETTINGS has no effort or thinkingBudgetTokens", () => {
  expect(DEFAULT_SETTINGS.claudeAgent.effort).toBeUndefined();
  expect(DEFAULT_SETTINGS.nativeAgent.thinkingBudgetTokens).toBeUndefined();
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/types.test.ts
```

Ожидание: TypeScript compile errors — поля не существуют.

- [ ] **Step 3: Добавить поля в `src/types.ts`**

В `ClaudeOperationConfig` добавить `effort`:
```typescript
export interface ClaudeOperationConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}
```

В `NativeOperationConfig` добавить `thinkingBudgetTokens`:
```typescript
export interface NativeOperationConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  thinkingBudgetTokens?: number;
}
```

В `LlmCallOptions` добавить `thinkingBudgetTokens`:
```typescript
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
  thinkingBudgetTokens?: number;
}
```

В `LlmWikiPluginSettings.claudeAgent` добавить `effort`:
```typescript
claudeAgent: {
  model: string;
  allowedTools: string;
  perOperation: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  operations: OpMap<ClaudeOperationConfig>;
};
```

В `LlmWikiPluginSettings.nativeAgent` добавить `thinkingBudgetTokens`:
```typescript
nativeAgent: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number | null;
  perOperation: boolean;
  operations: OpMap<NativeOperationConfig>;
  structuredRetries: number;
  thinkingBudgetTokens?: number;
};
```

`DEFAULT_SETTINGS` — оба новых поля не добавлять (остаются `undefined`).

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
npx vitest run tests/types.test.ts
```

Ожидание: PASS, 5 tests.

- [ ] **Step 5: Коммит**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): add effort to ClaudeOperationConfig and thinkingBudgetTokens to NativeOperationConfig/LlmCallOptions"
```

---

## Task 2: LocalConfig — effort для claude-agent

**Files:**
- Modify: `src/local-config.ts`

- [ ] **Step 1: Написать failing тест**

```typescript
// tests/local-config.test.ts (создать)
import type { LocalConfig } from "../src/local-config";

it("LocalConfig.claudeAgent accepts effort field", () => {
  const lc: LocalConfig = {
    iclaudePath: "/usr/bin/claude",
    claudeAgent: { model: "sonnet", allowedTools: "", effort: "high" },
  };
  expect(lc.claudeAgent?.effort).toBe("high");
});

it("LocalConfig.claudeAgent effort is optional", () => {
  const lc: LocalConfig = {
    iclaudePath: "/usr/bin/claude",
    claudeAgent: { model: "sonnet", allowedTools: "" },
  };
  expect(lc.claudeAgent?.effort).toBeUndefined();
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/local-config.test.ts
```

Ожидание: TypeScript compile error — `effort` не существует.

- [ ] **Step 3: Добавить `effort` в `LocalConfig.claudeAgent`**

В `src/local-config.ts`, в интерфейсе `LocalConfig`:
```typescript
claudeAgent?: {
  model: string;
  allowedTools: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};
```

- [ ] **Step 4: Запустить тест**

```bash
npx vitest run tests/local-config.test.ts
```

Ожидание: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/local-config.ts tests/local-config.test.ts
git commit -m "feat(local-config): add effort field to LocalConfig.claudeAgent"
```

---

## Task 3: llm-utils — thinking поле в buildChatParams

**Files:**
- Modify: `src/phases/llm-utils.ts`
- Modify: `tests/phases/llm-utils.test.ts` (если существует) или создать

- [ ] **Step 1: Найти или создать тест-файл**

```bash
npx vitest run tests/phases/llm-utils.test.ts 2>&1 | head -5
```

Если файл не существует — создать `tests/phases/llm-utils.test.ts`.

- [ ] **Step 2: Написать failing тест**

Добавить в тест-файл:
```typescript
import { buildChatParams } from "../../src/phases/llm-utils";

it("buildChatParams adds thinking when thinkingBudgetTokens > 0", () => {
  const params = buildChatParams("claude-sonnet", [], { thinkingBudgetTokens: 8000 });
  expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
});

it("buildChatParams does not add thinking when thinkingBudgetTokens is 0", () => {
  const params = buildChatParams("claude-sonnet", [], { thinkingBudgetTokens: 0 });
  expect(params.thinking).toBeUndefined();
});

it("buildChatParams does not add thinking when thinkingBudgetTokens is undefined", () => {
  const params = buildChatParams("claude-sonnet", [], {});
  expect(params.thinking).toBeUndefined();
});
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/phases/llm-utils.test.ts
```

Ожидание: FAIL — `params.thinking` undefined.

- [ ] **Step 4: Добавить thinking в `buildChatParams`**

В `src/phases/llm-utils.ts`, в `buildChatParams()` после блока `jsonMode`:
```typescript
if (opts.thinkingBudgetTokens && opts.thinkingBudgetTokens > 0) {
  params.thinking = { type: "enabled", budget_tokens: opts.thinkingBudgetTokens };
}
```

- [ ] **Step 5: Запустить тест**

```bash
npx vitest run tests/phases/llm-utils.test.ts
```

Ожидание: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/phases/llm-utils.ts tests/phases/llm-utils.test.ts
git commit -m "feat(llm-utils): pass thinkingBudgetTokens as thinking field in buildChatParams"
```

---

## Task 4: ClaudeCliClient — --effort флаг

**Files:**
- Modify: `src/claude-cli-client.ts`
- Modify: `tests/claude-cli-client.test.ts`

- [ ] **Step 1: Написать failing тест**

В `tests/claude-cli-client.test.ts` найти место с тестами spawn аргументов и добавить:
```typescript
it("passes --effort flag when cfg.effort is set", async () => {
  // Создать ClaudeCliClient с effort: "high"
  const spawnedArgs: string[] = [];
  // (mock spawn и проверить что "--effort", "high" присутствует в args)
  // Точная реализация зависит от существующей mock-инфраструктуры теста
});
```

Если тесты на spawn сложно замокать — написать тест на `ClaudeCliConfig` тип:
```typescript
import type { ClaudeCliConfig } from "../src/claude-cli-client";

it("ClaudeCliConfig accepts effort field", () => {
  const cfg: ClaudeCliConfig = {
    iclaudePath: "/usr/bin/claude",
    model: "sonnet",
    requestTimeoutSec: 300,
    tmpDir: "/tmp",
    tmpWrite: async () => {},
    tmpRemove: () => {},
    effort: "high",
  };
  expect(cfg.effort).toBe("high");
});

it("ClaudeCliConfig effort is optional", () => {
  const cfg: ClaudeCliConfig = {
    iclaudePath: "/usr/bin/claude",
    model: "sonnet",
    requestTimeoutSec: 300,
    tmpDir: "/tmp",
    tmpWrite: async () => {},
    tmpRemove: () => {},
  };
  expect(cfg.effort).toBeUndefined();
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Ожидание: TypeScript error — `effort` не существует в `ClaudeCliConfig`.

- [ ] **Step 3: Добавить `effort` в `ClaudeCliConfig` и `_create()`**

В `src/claude-cli-client.ts`, в `ClaudeCliConfig`:
```typescript
export interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
  tmpDir: string;
  resumeSessionId?: string;
  tmpWrite: (absPath: string, content: string) => Promise<void>;
  tmpRemove: (absPath: string) => void;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}
```

В `_create()`, после строки `if (model) args.push("--model", model);`:
```typescript
if (this.cfg.effort) args.push("--effort", this.cfg.effort);
```

- [ ] **Step 4: Запустить тест**

```bash
npx vitest run tests/claude-cli-client.test.ts
```

Ожидание: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/claude-cli-client.ts tests/claude-cli-client.test.ts
git commit -m "feat(claude-cli-client): add effort field to ClaudeCliConfig and pass --effort arg"
```

---

## Task 5: AgentRunner — thinkingBudgetTokens в buildOptsFor

**Files:**
- Modify: `src/agent-runner.ts`
- Modify: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Написать failing тест**

В `tests/agent-runner.integration.test.ts` добавить тест (или найти где `buildOptsFor` тестируется через `run`):
```typescript
it("passes thinkingBudgetTokens from global nativeAgent settings to opts", async () => {
  const settings = { ...DEFAULT_SETTINGS };
  settings.backend = "native-agent";
  settings.nativeAgent = { ...settings.nativeAgent, thinkingBudgetTokens: 8000, perOperation: false };
  
  // Создать AgentRunner с mock llm, выполнить операцию и проверить что opts.thinkingBudgetTokens === 8000
  // (точная реализация зависит от существующего mock-паттерна в файле)
});

it("passes per-op thinkingBudgetTokens, falling back to global", async () => {
  const settings = { ...DEFAULT_SETTINGS };
  settings.backend = "native-agent";
  settings.nativeAgent = {
    ...settings.nativeAgent,
    thinkingBudgetTokens: 8000,
    perOperation: true,
    operations: {
      ...settings.nativeAgent.operations,
      query: { model: "llama3.2", maxTokens: 4096, temperature: 0.2, thinkingBudgetTokens: 16000 },
    },
  };
  // query op должна получать 16000, ingest — 8000 (fallback к global)
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```

Ожидание: FAIL — `thinkingBudgetTokens` не передаётся в opts.

- [ ] **Step 3: Обновить `buildOptsFor` в `src/agent-runner.ts`**

Заменить блок `native-agent` в `buildOptsFor`:
```typescript
const na = s.nativeAgent;
const c = na.perOperation ? na.operations[key] : undefined;
const budgetTokens = c?.thinkingBudgetTokens ?? na.thinkingBudgetTokens;
if (c) return {
  model: c.model,
  opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries },
};
return {
  model: na.model,
  opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries },
};
```

- [ ] **Step 4: Запустить тест**

```bash
npx vitest run tests/agent-runner.integration.test.ts
```

Ожидание: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/agent-runner.ts tests/agent-runner.integration.test.ts
git commit -m "feat(agent-runner): extract thinkingBudgetTokens from settings in buildOptsFor"
```

---

## Task 6: Controller — effort читается из settings и передаётся в ClaudeCliConfig

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Найти место вставки**

В `src/controller.ts` найти `buildAgentRunner()` — строку где создаётся `ClaudeCliClient`:
```typescript
const client = new ClaudeCliClient({
  ...s.claudeAgent,
  iclaudePath: local.iclaudePath,
  ...
```

`...s.claudeAgent` уже спредит `model`, `allowedTools`, `perOperation`, `operations`. После добавления `effort` в `LlmWikiPluginSettings.claudeAgent` этот спред автоматически включит `effort` — дополнительная логика нужна только для per-operation разрешения.

- [ ] **Step 2: Проверить TypeScript compile**

Controller сложно юнит-тестировать (Obsidian App). Верификация — TypeScript compile без ошибок:

```bash
npx tsc --noEmit 2>&1 | head -20
```

Ожидание: нет ошибок, связанных с `effort` или `buildAgentRunner`.

- [ ] **Step 3: Обновить `buildAgentRunner` и call sites в `src/controller.ts`**

**3a. Изменить сигнатуру `buildAgentRunner`** (строка ~398) — добавить `opKey`:

```typescript
private async buildAgentRunner(
  vaultRoot: string,
  resumeSessionId?: string,
  opKey?: import("./types").OpKey,
): Promise<AgentRunner>
```

**3b. Добавить per-op effort resolution** внутри блока `if (s.backend === "claude-agent")`, до `new ClaudeCliClient(...)`:

```typescript
const claudeEff = s.claudeAgent;
const effort = claudeEff.perOperation && opKey
  ? claudeEff.operations[opKey]?.effort ?? claudeEff.effort
  : claudeEff.effort;
```

**3c. Заменить `...s.claudeAgent` spread** на явные поля (spread включает `perOperation`/`operations`, которых нет в `ClaudeCliConfig`):

```typescript
const client = new ClaudeCliClient({
  iclaudePath: local.iclaudePath,
  model: claudeEff.model,
  allowedTools: claudeEff.allowedTools,
  effort,
  requestTimeoutSec: maxTimeoutSec,
  cwd: vaultRoot,
  tmpDir,
  resumeSessionId,
  tmpWrite: async (absPath: string, content: string) => {
    if (base && !absPath.startsWith(base)) {
      throw new Error(`tmpDir path outside vault: ${absPath}`);
    }
    const vaultPath = base ? absPath.slice(base.length).replace(/^\//, "") : absPath;
    await adapter.write(vaultPath, content);
  },
  tmpRemove: (absPath: string) => {
    if (base && absPath.startsWith(base)) {
      const vaultPath = absPath.slice(base.length).replace(/^\//, "");
      fullAdapter.remove(vaultPath).catch(() => { /* ignore if already gone */ });
    }
  },
});
```

**3d. Обновить call sites** — передать `opKey`:

В `dispatch()` (строка ~547), `opKey` уже вычислен строкой выше:
```typescript
agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey);
```

В `dispatchChat()` (строка ~237), chat-операция использует фиксированный ключ:
```typescript
agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId, "chat");
```

- [ ] **Step 4: Запустить все тесты**

```bash
npm test
```

Ожидание: PASS (TypeScript compile + vitest).

- [ ] **Step 5: Коммит**

```bash
git add src/controller.ts
git commit -m "feat(controller): resolve per-op effort and pass to ClaudeCliClient"
```

---

## Task 7: Settings UI — Thinking budget controls

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Добавить глобальный effort dropdown для claude-agent**

В `src/settings.ts`, в блоке `if (eff.backend === "claude-agent" && !Platform.isMobile)`, после блока `!s.claudeAgent.perOperation` (т.е. после setting model\_name для claude-agent, строка ~222), добавить:

```typescript
if (!s.claudeAgent.perOperation) {
  new Setting(containerEl)
    .setName("Effort level")
    .setDesc("Уровень размышления Claude (--effort). Пусто = без thinking.")
    .addDropdown(d => {
      d.addOption("", "Отключено");
      for (const lv of ["low", "medium", "high", "xhigh", "max"] as const) d.addOption(lv, lv);
      d.setValue(eff.claudeAgent.effort ?? "");
      d.onChange(async v => {
        await this.patchLocalClaude({ effort: (v || undefined) as typeof eff.claudeAgent.effort });
      });
      return d;
    });
}
```

Но этот блок уже внутри `if (!s.claudeAgent.perOperation)` — вставить сразу после allowedTools setting.

Точное место: после строки с `allowedTools_name` setting (строка ~231), перед `perOperation_name` setting (строка ~233).

- [ ] **Step 2: Добавить per-op effort dropdown для claude-agent**

В блоке `if (s.claudeAgent.perOperation)` (строка ~241), внутри цикла `for (const { key, label } of ops)`, после `opModel_name` setting добавить:

```typescript
new Setting(containerEl)
  .setName("Effort level")
  .addDropdown(d => {
    d.addOption("", "Унаследовать");
    for (const lv of ["low", "medium", "high", "xhigh", "max"] as const) d.addOption(lv, lv);
    d.setValue(s.claudeAgent.operations[key].effort ?? "");
    d.onChange(async v => {
      s.claudeAgent.operations[key].effort = (v || undefined) as typeof s.claudeAgent.operations[key].effort;
      await this.plugin.saveSettings();
    });
    return d;
  });
```

- [ ] **Step 3: Добавить глобальный thinkingBudgetTokens text для native-agent**

В блоке `else` (native-agent), внутри `if (!s.nativeAgent.perOperation)` (строка ~279), после `maxTokens_name` setting добавить:

```typescript
new Setting(containerEl)
  .setName("Thinking budget tokens")
  .setDesc("Макс. токены для размышления. 0 или пусто = отключено.")
  .addText(t =>
    t.setPlaceholder("0")
      .setValue(String(s.nativeAgent.thinkingBudgetTokens ?? 0))
      .onChange(async v => {
        const n = Number(v);
        s.nativeAgent.thinkingBudgetTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
        await this.plugin.saveSettings();
      })
  );
```

- [ ] **Step 4: Добавить per-op thinkingBudgetTokens для native-agent**

В блоке `if (s.nativeAgent.perOperation)` (строка ~327), внутри цикла `for (const { key, label } of ops)`, после `opMaxTokens_name` setting добавить:

```typescript
new Setting(containerEl)
  .setName("Thinking budget tokens")
  .addText(t =>
    t.setPlaceholder("0")
      .setValue(String(s.nativeAgent.operations[key].thinkingBudgetTokens ?? 0))
      .onChange(async v => {
        const n = Number(v);
        s.nativeAgent.operations[key].thinkingBudgetTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
        await this.plugin.saveSettings();
      })
  );
```

- [ ] **Step 5: Запустить тесты**

```bash
npm test
```

Ожидание: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/settings.ts
git commit -m "feat(settings): add effort dropdown for claude-agent and thinkingBudgetTokens for native-agent"
```

---

## Task 8: Settings UI — Availability check buttons

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Добавить функцию `checkClaudeAvailability`**

В начало `src/settings.ts` (после импортов), добавить:

```typescript
async function checkClaudeAvailability(iclaudePath: string): Promise<void> {
  const { spawn } = await import("child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(iclaudePath, [
      "--", "-p", "Привет, AI Wiki! Поработаем?",
      "--output-format", "stream-json", "--verbose",
      "--disable-slash-commands", "--dangerously-skip-permissions",
      "--model", "haiku",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const timeout = window.setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timeout 30s"));
    }, 30_000);

    child.on("error", err => { clearTimeout(timeout); reject(err); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}`));
    });
  });
}
```

- [ ] **Step 2: Добавить функцию `checkNativeAvailability`**

Сразу после `checkClaudeAvailability` добавить:

```typescript
async function checkNativeAvailability(baseUrl: string, apiKey: string, model: string): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Привет, AI Wiki! Поработаем?" }],
        max_tokens: 50,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 3: Добавить кнопку проверки в claude-agent iclaudePath setting**

В `src/settings.ts`, в блоке `if (eff.backend === "claude-agent" && !Platform.isMobile)`, найти setting `iclaudePath_name` (строка ~202). Заменить его на вариант с `.addButton()`:

```typescript
new Setting(containerEl)
  .setName(T.settings.iclaudePath_name)
  .setDesc(T.settings.iclaudePath_desc)
  .addText(t =>
    t.setPlaceholder("/home/user/Documents/Project/iclaude/iclaude.sh")
      .setValue(this.localCache.iclaudePath)
      .onChange(async v => {
        await this.patchLocal({ iclaudePath: v.trim() });
      })
  )
  .addButton(b => {
    b.setButtonText("Проверить").onClick(async () => {
      b.setButtonText("Проверка…").setDisabled(true);
      try {
        await checkClaudeAvailability(this.localCache.iclaudePath);
        new Notice("✅ Claude доступен");
      } catch (e) {
        new Notice(`❌ ${(e as Error).message}`);
      } finally {
        b.setButtonText("Проверить").setDisabled(false);
      }
    });
  });
```

- [ ] **Step 4: Добавить кнопку проверки для native-agent**

В блоке `else` (native-agent), после setting `apiKey_name` (строка ~277), добавить:

```typescript
new Setting(containerEl)
  .setName("Проверить соединение")
  .setDesc("Отправляет тестовый промпт к endpoint для проверки доступности.")
  .addButton(b => {
    b.setButtonText("Проверить").onClick(async () => {
      b.setButtonText("Проверка…").setDisabled(true);
      const na = eff.nativeAgent;
      try {
        await checkNativeAvailability(na.baseUrl, na.apiKey, na.model);
        new Notice("✅ Модель отвечает");
      } catch (e) {
        new Notice(`❌ ${(e as Error).message}`);
      } finally {
        b.setButtonText("Проверить").setDisabled(false);
      }
    });
  });
```

- [ ] **Step 5: Запустить тесты**

```bash
npm test
```

Ожидание: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/settings.ts
git commit -m "feat(settings): add availability check buttons for claude-agent and native-agent"
```

---

## Task 9: Bump version и сборка

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Прочитать текущую версию**

```bash
node -p "require('./package.json').version"
```

- [ ] **Step 2: Инкрементировать patch и обновить оба файла**

Если текущая версия `X.Y.Z`, записать `X.Y.(Z+1)` в `package.json` поле `version` и в `src/manifest.json` поле `version`.

- [ ] **Step 3: Собрать**

```bash
npm run build
```

Ожидание: успешная сборка без ошибок.

- [ ] **Step 4: Финальный коммит**

```bash
git add package.json src/manifest.json main.js
git commit -m "build: bump version and rebuild for thinking budget and availability check"
```

---

## Self-Review

### Spec coverage
- ✅ `ClaudeOperationConfig.effort` — Task 1
- ✅ `NativeOperationConfig.thinkingBudgetTokens` — Task 1
- ✅ `LlmCallOptions.thinkingBudgetTokens` — Task 1
- ✅ `LlmWikiPluginSettings.claudeAgent.effort` — Task 1
- ✅ `LlmWikiPluginSettings.nativeAgent.thinkingBudgetTokens` — Task 1
- ✅ `DEFAULT_SETTINGS` без новых полей (undefined) — Task 1
- ✅ `LocalConfig.claudeAgent.effort` — Task 2
- ✅ `buildChatParams()` thinking поле — Task 3
- ✅ `ClaudeCliConfig.effort` + `--effort` arg — Task 4
- ✅ `buildOptsFor()` thinkingBudgetTokens — Task 5
- ✅ controller reads effort, passes to ClaudeCliClient — Task 6
- ✅ UI: effort dropdown claude-agent (global + per-op) — Task 7
- ✅ UI: thinkingBudgetTokens text native-agent (global + per-op) — Task 7
- ✅ `checkClaudeAvailability` + кнопка, guarded by `!Platform.isMobile` — Task 8
- ✅ `checkNativeAvailability` + кнопка — Task 8
- ✅ version bump + build — Task 9

### Type consistency
- `effort` тип `"low" | "medium" | "high" | "xhigh" | "max"` — одинаков во всех местах
- `thinkingBudgetTokens?: number` — одинаков в `LlmCallOptions`, `NativeOperationConfig`, `LlmWikiPluginSettings.nativeAgent`
- Функции `checkClaudeAvailability` и `checkNativeAvailability` — standalone, не экспортируются

### Важный нюанс: effective-settings.ts
`resolveEffective` спредит `{ ...s.claudeAgent, ...(l.claudeAgent ?? {}) }`. После добавления `effort` в `LocalConfig.claudeAgent` — локальный effort будет перекрывать глобальный. Это корректное поведение (device-specific).
