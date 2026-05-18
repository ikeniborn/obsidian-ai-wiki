---
review:
  spec_hash: 2b94558aab9d2a75
  last_run: 2026-05-15
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings: []
---

# max_tokens перенос + numCtx удаление

Schema v3: `maxTokens` becomes native-only field under `nativeAgent.maxTokens`. Top-level `s.maxTokens` removed. `numCtx` removed entirely (Ollama-specific param ignored by OpenAI-compat route).

## Motivation

- `s.maxTokens` исторически был top-level (шарился между claude/native). После v0.1.66 claude его не использует — iclaude.sh читает env `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. Поле должно быть native-only.
- `numCtx` (Ollama `num_ctx`) — нестандартный OpenAI параметр. Через OpenAI-совместимый endpoint Ollama его игнорирует. UI вводит пользователя в заблуждение.
- UI-расположение: `maxTokens` сейчас в General секции, отделён от модели. Логичнее — под полем "Model" в Backend-блоке.

## Verified facts

| Параметр | Backend | Передаётся? | Источник |
|---|---|---|---|
| `max_tokens` | native-agent | Да | `agent-runner.ts:40-41` → `llm-utils.ts:62` → `params.max_tokens` |
| `max_tokens` | claude-agent | Нет | `agent-runner.ts:30-35` (omitted); env `CLAUDE_CODE_MAX_OUTPUT_TOKENS` в iclaude.sh |
| `num_ctx` | native-agent | Передаётся, но игнорируется | `llm-utils.ts:64` → `params.num_ctx`; Ollama OpenAI-route игнорирует |
| `num_ctx` | claude-agent | Нет | Не передаётся |

## Changes

### `src/types.ts`

```ts
// LlmCallOptions — drop numCtx
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
}

// LlmWikiPluginSettings — drop top-level maxTokens, drop nativeAgent.numCtx,
// add nativeAgent.maxTokens
export interface LlmWikiPluginSettings {
  backend: "claude-agent" | "native-agent";
  systemPrompt: string;
  agentLogEnabled: boolean;
  historyLimit: number;
  graphDepth: number;
  hubThreshold: number;
  timeouts: { ingest: number; query: number; lint: number; init: number; format: number };
  history: RunHistoryEntry[];
  claudeAgent: { ... };  // без изменений
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens: number;        // NEW
    temperature: number;
    topP: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
  };
  devMode: { ... };
}

// DEFAULT_SETTINGS.nativeAgent
nativeAgent: {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  model: "llama3.2",
  maxTokens: 4096,    // NEW (был s.maxTokens)
  temperature: 0.2,
  topP: null,
  // numCtx: null — удалено
  perOperation: false,
  operations: { ... },
  structuredRetries: 1,
}
```

### `src/main.ts` (migration)

Расширить блок миграции `loadSettings`:

```ts
// Schema v3: top-level maxTokens → nativeAgent.maxTokens; drop numCtx
const naRaw = (data?.nativeAgent ?? {}) as Record<string, unknown>;
const legacyTopMax = typeof data?.maxTokens === "number" ? data.maxTokens
  : (typeof caData?.maxTokens === "number" ? caData.maxTokens
  : (typeof naData?.maxTokens === "number" ? naData.maxTokens : undefined));

if (legacyTopMax !== undefined && this.settings.nativeAgent.maxTokens === DEFAULTS.nativeAgent.maxTokens) {
  this.settings.nativeAgent.maxTokens = legacyTopMax;
  dirty = true;
}

// Drop numCtx from data.json
const naDirty = "numCtx" in naRaw;
if (naDirty) dirty = true;

if (dirty) await this.saveData(this.settings);
```

Старый блок v2 (строки 173-176) — удалить (заменён новой логикой).

### `src/local-config.ts`

```ts
nativeAgent?: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number | null;
  // numCtx удалено
};
```

`load()` дополнительно: при загрузке local.json удалять `numCtx` из nativeAgent если есть (silent cleanup).

### `src/main.ts:migrateToLocalV1`

Убрать `numCtx: s.nativeAgent.numCtx` из создаваемого LocalConfig.

### `src/agent-runner.ts:buildOptsFor`

```ts
// native branch
const na = s.nativeAgent;
const c = na.perOperation ? na.operations[key] : undefined;
if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
```

### `src/phases/llm-utils.ts:buildChatParams`

Удалить строку:
```ts
if (opts.numCtx != null) params.num_ctx = opts.numCtx;
```

### `src/settings.ts`

1. Удалить блок General `maxTokens` (строки 100-112).
2. Удалить блок `numCtx` UI (строки 307-319).
3. Убрать `numCtx` из `patchLocalNative` fallback (строка 53).
4. Добавить новый Setting в native ветке после "Model" (после строки 305) — показ только при `!s.nativeAgent.perOperation`:

```ts
new Setting(containerEl)
  .setName(T.settings.maxTokens_name)
  .setDesc(T.settings.maxTokens_desc)
  .addText((t) =>
    t.setPlaceholder("4096")
      .setValue(String(s.nativeAgent.maxTokens))
      .onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          s.nativeAgent.maxTokens = Math.floor(n);
          await this.plugin.saveSettings();
        }
      }),
  );
```

### `src/i18n.ts`

Удалить `numCtx_name` и `numCtx_desc` ключи во всех локалях (ru/en/es + остальные). `maxTokens_name`/`maxTokens_desc` сохраняются.

### Тесты

- `tests/settings.test.ts` и прочие: убрать ожидания на `s.maxTokens` top-level и `nativeAgent.numCtx`.
- Новый тест миграции: data.json со старой схемой → после load `nativeAgent.maxTokens` правильное значение, нет `numCtx`.

### Version

`0.1.99 → 0.1.100` (patch). Build после правок.

## Risks

- **Settings reset:** Пользователи с кастомным `maxTokens` (top-level) получат default 4096 если миграция не сработает. Mitigation: миграция явно ищет legacy ключи в `data`, `claudeAgent.maxTokens`, `nativeAgent.maxTokens`.
- **Local.json stale numCtx:** Не критично — поле просто игнорируется. Silent drop в `load()`.
- **i18n missing keys:** TypeScript падает при использовании удалённых ключей — гарантирует, что UI не сломается.

## Testing checklist

- [ ] Build green
- [ ] Vitest green
- [ ] data.json с `maxTokens: 8192` top-level → после load: `nativeAgent.maxTokens === 8192`, top-level отсутствует
- [ ] data.json с `nativeAgent.numCtx: 16384` → после load: поле удалено
- [ ] UI: при backend=native, !perOperation → "Max tokens" под "Model"
- [ ] UI: при backend=claude → нет "Max tokens"
- [ ] UI: numCtx нигде нет
- [ ] Runtime: native запрос с `params.max_tokens` присутствует; `params.num_ctx` отсутствует
