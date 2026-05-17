---
title: Thinking budget + availability check
date: 2026-05-17
status: approved
---

# Thinking budget & availability check

Два независимых улучшения настроек плагина:

1. **Thinking budget** — управление "размышлением" моделей для обоих бэкендов (effort для claude-agent, budget_tokens для native-agent), глобально и per-operation.
2. **Кнопка проверки доступности** — проверка работоспособности бэкенда прямо из настроек с прогресс-индикатором и Notice-уведомлением.

---

## Фича 1: Thinking budget

### Изменения в `src/types.ts`

```typescript
// ClaudeOperationConfig — добавить effort
export interface ClaudeOperationConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

// NativeOperationConfig — добавить thinkingBudgetTokens
export interface NativeOperationConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  thinkingBudgetTokens?: number;  // 0 или undefined = отключено
}

// LlmCallOptions — добавить поле
export interface LlmCallOptions {
  // ... existing fields ...
  thinkingBudgetTokens?: number;
}

// LlmWikiPluginSettings.claudeAgent — глобальный effort
claudeAgent: {
  model: string;
  allowedTools: string;
  perOperation: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";  // new
  operations: OpMap<ClaudeOperationConfig>;
};

// LlmWikiPluginSettings.nativeAgent — глобальный budget
nativeAgent: {
  // ... existing fields ...
  thinkingBudgetTokens?: number;  // new
};
```

`DEFAULT_SETTINGS`: оба поля `undefined` (thinking отключено по умолчанию).

### Изменения в `src/phases/llm-utils.ts`

В `buildChatParams()` добавить после блока `jsonMode`:

```typescript
if (opts.thinkingBudgetTokens && opts.thinkingBudgetTokens > 0) {
  params.thinking = { type: "enabled", budget_tokens: opts.thinkingBudgetTokens };
}
```

### Изменения в `src/claude-cli-client.ts`

```typescript
// ClaudeCliConfig — новое поле
export interface ClaudeCliConfig {
  // ... existing fields ...
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

// В _create(), после args.push("--model", model):
if (this.cfg.effort) args.push("--effort", this.cfg.effort);
```

### Изменения в `src/agent-runner.ts`

`buildOptsFor()` достаёт значения из per-op или глобала:

```typescript
// claude-agent
const c = s.claudeAgent.perOperation ? s.claudeAgent.operations[key] : undefined;
const model = c?.model ?? s.claudeAgent.model;
const effort = c?.effort ?? s.claudeAgent.effort;
return { model, effort, opts: { systemPrompt: s.systemPrompt, structuredRetries } };

// native-agent
const c = na.perOperation ? na.operations[key] : undefined;
const budgetTokens = c?.thinkingBudgetTokens ?? na.thinkingBudgetTokens;
if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
```

Сигнатура `buildOptsFor()` возвращает `{ model: string; effort?: string; opts: LlmCallOptions }`.

### Изменения в `src/controller.ts`

При создании `ClaudeCliClient` добавить поле `effort` из результата `buildOptsFor()`:

```typescript
const { model, effort, opts } = runner.buildOptsFor(operation);
const client = new ClaudeCliClient({ ..., effort });
```

> Примечание: `buildOptsFor()` сейчас приватный метод. Нужно вынести логику построения `ClaudeCliConfig` в `controller.ts`, либо сделать метод внутренне доступным через рефактор. Предпочтительно: `AgentRunner` получает `effort` при создании `ClaudeCliClient` в `controller.ts` до передачи в `AgentRunner`, либо `controller.ts` сам читает effort из settings при построении `ClaudeCliConfig`.

**Конкретно:** `controller.ts` уже читает `eff.backend` и строит `ClaudeCliConfig` напрямую. Добавить туда же:

```typescript
const claudeEff = s.claudeAgent;
const effort = claudeEff.perOperation
  ? claudeEff.operations[currentOpKey]?.effort ?? claudeEff.effort
  : claudeEff.effort;
// затем передать в ClaudeCliConfig
```

### UI в `src/settings.ts`

**Claude-agent — глобальный effort (dropdown, только если `!perOperation`):**

```typescript
new Setting(containerEl)
  .setName("Effort level")
  .setDesc("Уровень размышления Claude (--effort). Пусто = без thinking.")
  .addDropdown(d => {
    d.addOption("", "Отключено");
    for (const lv of ["low", "medium", "high", "xhigh", "max"]) d.addOption(lv, lv);
    d.setValue(eff.claudeAgent.effort ?? "");
    d.onChange(async v => {
      await this.patchLocalClaude({ effort: v || undefined });
    });
  });
```

**Claude-agent per-operation — effort в каждой операции:**

```typescript
new Setting(containerEl)
  .setName("Effort level")
  .addDropdown(d => {
    d.addOption("", "Унаследовать");
    for (const lv of ["low", "medium", "high", "xhigh", "max"]) d.addOption(lv, lv);
    d.setValue(s.claudeAgent.operations[key].effort ?? "");
    d.onChange(async v => {
      s.claudeAgent.operations[key].effort = v || undefined;
      await this.plugin.saveSettings();
    });
  });
```

**Native-agent — глобальный thinkingBudgetTokens (только если `!perOperation`):**

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

**Native-agent per-operation — аналогично с `s.nativeAgent.operations[key].thinkingBudgetTokens`.**

### `LocalConfig` в `src/local-config.ts`

`effort` для claude-agent — device-specific настройка, поэтому добавить в `LocalConfig.claudeAgent`:

```typescript
claudeAgent?: {
  model: string;
  allowedTools: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";  // new
};
```

`thinkingBudgetTokens` для native-agent — не device-specific, хранится в `settings.json` (как `maxTokens`). Без изменений в `LocalConfig`.

---

## Фича 2: Кнопка проверки доступности

### Функции проверки в `src/settings.ts`

**Claude-agent:**

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

**Native-agent:**

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

### UI в `src/settings.ts`

**Claude-agent — кнопка добавляется к setting iclaudePath (`.addButton()`):**

```typescript
new Setting(containerEl)
  .setName(T.settings.iclaudePath_name)
  .setDesc(T.settings.iclaudePath_desc)
  .addText(t => t.setPlaceholder("...").setValue(this.localCache.iclaudePath)
    .onChange(async v => { await this.patchLocal({ iclaudePath: v.trim() }); }))
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

**Native-agent — отдельная строка "Проверить соединение" после apiKey:**

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

Кнопка для claude-agent рендерится только `if (!Platform.isMobile)` (claude-agent desktop-only).

---

## Затронутые файлы

| Файл | Изменения |
|---|---|
| `src/types.ts` | `ClaudeOperationConfig.effort`, `NativeOperationConfig.thinkingBudgetTokens`, `LlmCallOptions.thinkingBudgetTokens`, `LlmWikiPluginSettings.claudeAgent.effort`, `LlmWikiPluginSettings.nativeAgent.thinkingBudgetTokens` |
| `src/local-config.ts` | `LocalConfig.claudeAgent.effort` |
| `src/phases/llm-utils.ts` | `buildChatParams()` — добавить `thinking` поле |
| `src/claude-cli-client.ts` | `ClaudeCliConfig.effort`, `_create()` — `--effort` arg |
| `src/agent-runner.ts` | `buildOptsFor()` — извлечение effort и thinkingBudgetTokens |
| `src/controller.ts` | Передача `effort` в `ClaudeCliConfig` при построении клиента |
| `src/settings.ts` | Dropdown effort (claude), text thinkingBudgetTokens (native), кнопки проверки |

---

## Ограничения и решения

- `--effort` работает только с моделями Claude, поддерживающими extended thinking (claude-sonnet-4-5+ и выше). При неподдерживаемой модели Claude CLI вернёт ошибку — пользователь увидит её в view.
- `thinking.budget_tokens` будет проигнорирован моделью если та не поддерживает thinking. Нет fallback-логики — pass-through.
- Кнопка проверки не кешируется: каждый клик = новый запрос.
- `child_process` в native Obsidian недоступен на mobile → `checkClaudeAvailability` guarded by `!Platform.isMobile`.
