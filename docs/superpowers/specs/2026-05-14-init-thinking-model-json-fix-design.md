# Init: Schema-Guided CoT + Structured Output Fix

**Date:** 2026-05-14  
**Goal:** Системно решить "LLM вернул невалидный JSON" при использовании thinking-моделей (Qwen3, DeepSeek-R1, и др.) в операциях `init`, `query`, `lint`.

---

## Root Cause

Thinking-модели возвращают рассуждения внутри `<think>...</think>` тегов **в поле `content`**, а не в `delta.reasoning`. `extractStreamDeltas` (`llm-utils.ts:10`) читает только нестандартное поле `delta.reasoning` — поэтому `<think>`-контент попадает в `fullText`.

Жадный регекс `/\{[\s\S]*\}/` захватывает **от первой `{` внутри `<think>`** до **последней `}` финального JSON** → невалидный фрагмент → `JSON.parse` падает.

Пример `fullText`:
```
<think>
  Рассмотрим структуру. Можно { "temp": 1 } или другой вариант...
</think>
{
  "entity_types": [...],
  "language_notes": "..."
}
```

Регекс матчит `{ "temp": 1 } или другой вариант...\n</think>\n{\n  "entity_types"` → invalid JSON.

### Уязвимые места (все 5)

| Файл | Строка | Контекст |
|---|---|---|
| `src/phases/init.ts` | 119 | init без `--sources` (parse DomainEntry) |
| `src/phases/init.ts` | 277 | bootstrap (parse DomainEntry) |
| `src/phases/init.ts` | 355 | incremental delta (parse entity_types patch) |
| `src/phases/query.ts` | 182 | seed extraction — в `llmSelectSeeds`, без `buildChatParams` |
| `src/phases/lint.ts` | 348 | lint patch (parse entity_types patch) |

---

## Solution Architecture

Три слоя защиты — каждый следующий даёт более сильную гарантию:

```
Layer 1: stripThinking + parseStructured     ← тактический fallback (все провайдеры)
Layer 2: response_format: json_object        ← структурная гарантия валидного JSON
Layer 3: response_format: json_schema + CoT  ← полная схемная гарантия + thinking внутри структуры
```

- **claude-agent**: Layer 1 только (`jsonMode` не выставляется → `undefined`, Claude управляет форматом сам)
- **native-agent (default)**: Layer 1 + 2 (`json_object` — максимальная совместимость)
- **native-agent (OpenAI / qwen:api)**: Layer 1 + 2 + 3 (`json_schema` — максимальная надёжность)

Настройка через `nativeAgent.structuredOutput` (новое поле settings).

---

## Layer 1: `parseStructured` + `stripThinking`

Заменяет внутренности всех 5 try-блоков с `fullText.match(/\{[\s\S]*\}/)`. **Внешние try/catch-блоки с `continue`/предупреждениями сохраняются без изменений.**

### `stripThinking` в `llm-utils.ts`

```typescript
/** Remove <think>...</think> blocks leaked into content by thinking models. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
```

### `parseStructured` в `llm-utils.ts`

```typescript
/**
 * Parse structured JSON from LLM output.
 * Fast path: direct parse (works for json_schema / json_object mode).
 * Fallback: strip <think> tags, then find JSON block.
 * Throws if no valid JSON found.
 */
export function parseStructured(fullText: string): unknown {
  const text = fullText.trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const stripped = stripThinking(text);
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  return JSON.parse(match[0]);
}
```

### Применение в call sites — точный паттерн

Внешний try/catch **не меняется**. Меняются только строки внутри try:

```typescript
// init.ts:277 — было:
try {
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  entry = JSON.parse(match[0]) as DomainEntry;
  // ...validation...
} catch {
  yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap\n` };
  yield { kind: "file_done", file, phase: "analysis" };
  continue;
}

// стало:
try {
  const parsed = parseStructured(fullText) as DomainEntryResponse;
  entry = { id: parsed.id, name: parsed.name, wiki_folder: parsed.wiki_folder,
            entity_types: parsed.entity_types, language_notes: parsed.language_notes } as DomainEntry;
  // ...validation unchanged...
} catch {
  yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap\n` };
  yield { kind: "file_done", file, phase: "analysis" };
  continue;  // ← поведение при ошибке не изменяется
}
```

Аналогично для `init.ts:119` (тип `DomainEntryResponse`, тот же `DOMAIN_ENTRY_SCHEMA`). Для `init.ts:355` — паттерн тот же, но тип `EntityTypesDeltaResponse` и схема `ENTITY_TYPES_DELTA_SCHEMA` (incremental delta). Для `lint.ts:348` — тип `EntityTypesDeltaResponse`, схема `ENTITY_TYPES_DELTA_SCHEMA`; catch возвращает `null` (не `continue`), структура та же.

### `query.ts:182` — особый случай

`llmSelectSeeds` сейчас не использует `buildChatParams` и не принимает `opts`. Чтобы подключить `jsonMode`, нужно:

1. Добавить параметр `opts: LlmCallOptions` в сигнатуру функции.
2. Передать `opts` из `runQuery` (у неё `opts` есть).
3. Построить params через `buildChatParams` вместо inline-объекта.

```typescript
// было:
async function llmSelectSeeds(question, indexContent, allPageIds, llm, model, signal)

// стало:
async function llmSelectSeeds(question, indexContent, allPageIds, llm, model, opts: LlmCallOptions, signal)
```

Вызов в `runQuery:63`: добавить `opts` в вызов.

Inline-промпт в `llmSelectSeeds:169` уже содержит слово "JSON": `"Return JSON only: {"seeds": [...]}"`  — требование OpenAI `json_object` mode (слово "JSON" в промпте) выполнено. Промпт `query.md` не затрагивается (он для другой части функции).

---

## Layer 2: `response_format: json_object`

Гарантирует валидный JSON на уровне протокола. Модель физически не может вернуть `<think>` теги — они нарушали бы синтаксис JSON.

**Требование к промптам:** OpenAI-совместимые провайдеры требуют наличие слова "JSON" в промпте при `json_object` mode. Статус по операциям:
- `init.md`: содержит "JSON" ✓
- `init-incremental.md`: содержит "JSON" ✓
- `llmSelectSeeds` inline prompt: содержит "JSON" ✓
- `lint.md`: **не содержит "JSON"** → нужно добавить инструкцию (см. Layer 3 / Изменения промптов)

### `StructuredOutputSchema` — новый тип в `llm-utils.ts`

```typescript
export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}
```

### Изменение `LlmCallOptions` в `types.ts`

```typescript
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  numCtx?: number | null;
  jsonMode?: "json_object" | "json_schema" | false;  // NEW
}
```

### Изменение `buildChatParams` в `llm-utils.ts`

```typescript
export function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  responseSchema?: StructuredOutputSchema,  // NEW — optional, Layer 3
): Record<string, unknown> {
  let msgs = prependBaseContract(messages);
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
  const params: Record<string, unknown> = { model, messages: msgs };
  if (opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.maxTokens != null) params.max_tokens = opts.maxTokens;
  if (opts.topP != null) params.top_p = opts.topP;
  if (opts.numCtx != null) params.num_ctx = opts.numCtx;

  if (responseSchema && opts.jsonMode === "json_schema") {
    params.response_format = {
      type: "json_schema",
      json_schema: { name: responseSchema.name, schema: responseSchema.schema, strict: true },
    };
  } else if (opts.jsonMode === "json_object") {
    params.response_format = { type: "json_object" };
  }

  return params;
}
```

### Новое поле `nativeAgent.structuredOutput` в settings (`types.ts`)

```typescript
// Поле добавляется в inline-объект nativeAgent внутри LlmWikiPluginSettings:
structuredOutput: "json_schema" | "json_object" | "none";

// DEFAULT_SETTINGS:
nativeAgent: {
  ...
  structuredOutput: "json_object",  // safe default — широкая совместимость
}
```

### Прокидывание через `buildOptsFor` в `agent-runner.ts`

Обе ветки (`perOperation: true` и `false`) получают `jsonMode` — `structuredOutput` это настройка уровня backend, не операции:

```typescript
const na = s.nativeAgent;
const jsonMode = na.structuredOutput === "none" ? (false as const) : na.structuredOutput;
const c = na.perOperation ? na.operations[key] : undefined;
if (c) return {
  model: c.model,
  opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode },
};
return {
  model: na.model,
  opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode },
};
```

`claude-agent` ветка не изменяется — `jsonMode` отсутствует → `undefined` → `buildChatParams` не добавляет `response_format`.

---

## Layer 3: `response_format: json_schema` + CoT в схеме

Полная схемная гарантия. Включается при `nativeAgent.structuredOutput: "json_schema"`.

### Ключевая идея: CoT внутри структуры

Каждая схема содержит `reasoning: string` как **первое обязательное поле**. При `strict: true` OpenAI-совместимые модели генерируют поля в порядке объявления → рассуждение происходит **внутри JSON-объекта**, до заполнения выходных полей.

```
{
  "reasoning": "Файл содержит данные о RWA. Нужно выделить asset_class...",  ← думает здесь
  "entity_types": [...],       ← заполняет после рассуждения
  "language_notes": "..."
}
```

### Новый файл `src/phases/schemas.ts`

TypeScript-типы + JSON Schema константы. Типизация: `const X: StructuredOutputSchema = {...}` — без `as const`, TypeScript проверяет совместимость с `Record<string, unknown>` на этапе компиляции.

```typescript
import type { EntityType } from "../domain";
import type { StructuredOutputSchema } from "./llm-utils";

// ─── Shared sub-schema ───────────────────────────────────────────────────────

const ENTITY_TYPE_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    type:                  { type: "string" },
    description:           { type: "string" },
    extraction_cues:       { type: "array", items: { type: "string" } },
    min_mentions_for_page: { type: "number" },
    wiki_subfolder:        { type: "string" },
  },
  required: ["type", "description", "extraction_cues", "wiki_subfolder"],
  additionalProperties: false,
};

// ─── Bootstrap (init file 0, init без --sources) ─────────────────────────────

export interface DomainEntryResponse {
  reasoning: string;
  id: string;
  name: string;
  wiki_folder: string;
  entity_types: EntityType[];
  language_notes: string;
}

export const DOMAIN_ENTRY_SCHEMA: StructuredOutputSchema = {
  name: "domain_entry",
  schema: {
    type: "object",
    properties: {
      reasoning:      { type: "string" },
      id:             { type: "string" },
      name:           { type: "string" },
      wiki_folder:    { type: "string" },
      entity_types:   { type: "array", items: ENTITY_TYPE_ITEM_SCHEMA },
      language_notes: { type: "string" },
    },
    required: ["reasoning", "id", "name", "wiki_folder", "entity_types", "language_notes"],
    additionalProperties: false,
  },
};

// ─── Incremental delta (init files 1+, lint patch) ───────────────────────────

export interface EntityTypesDeltaResponse {
  reasoning: string;
  entity_types?: EntityType[];
  language_notes?: string;
}

export const ENTITY_TYPES_DELTA_SCHEMA: StructuredOutputSchema = {
  name: "entity_types_delta",
  schema: {
    type: "object",
    properties: {
      reasoning:      { type: "string" },
      entity_types:   { type: "array", items: ENTITY_TYPE_ITEM_SCHEMA },
      language_notes: { type: "string" },
    },
    required: ["reasoning"],
    additionalProperties: false,
  },
};

// ─── Seed extraction (query) ─────────────────────────────────────────────────

export interface SeedsResponse {
  reasoning?: string;  // absent in json_object mode (prompt not updated for seeds)
  seeds: string[];
}

export const SEEDS_SCHEMA: StructuredOutputSchema = {
  name: "seeds",
  schema: {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      seeds:     { type: "array", items: { type: "string" } },
    },
    required: ["reasoning", "seeds"],
    additionalProperties: false,
  },
};
```

**Схем 3, типов 3.** `lint.ts` переиспользует `ENTITY_TYPES_DELTA_SCHEMA` и `EntityTypesDeltaResponse` — отдельная схема не нужна (структура идентична).

### Применение схем в call sites (`json_schema` режим)

```typescript
// init.ts — bootstrap:
const schema = opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);
// ...в try-блоке:
const parsed = parseStructured(fullText) as DomainEntryResponse;
// parsed.reasoning — доступно для devMode логирования

// init.ts — incremental (files 1+):
const schema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);

// lint.ts — patch:
const schema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);

// query.ts — seeds (после рефактора llmSelectSeeds под opts):
const schema = opts.jsonMode === "json_schema" ? SEEDS_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema) as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
// ...в try-блоке:
const parsed = parseStructured(text) as SeedsResponse;
return Array.isArray(parsed.seeds) ? parsed.seeds : [];
```

### Изменения промптов

Добавить `reasoning`-инструкцию в **три** промпта (для CoT в `json_object` режиме, где схема не применяется):

| Файл | Изменение |
|---|---|
| `prompts/init.md` | добавить: "Включи поле `reasoning` первым: пошаговое обоснование структуры домена." |
| `prompts/init-incremental.md` | добавить: "Включи поле `reasoning` первым: обоснование добавляемых entity_types." |
| `prompts/lint.md` | добавить: "Верни **JSON** с полем `reasoning` первым, затем `entity_types` и `language_notes`." — **также закрывает** требование слова "JSON" для `json_object` mode |

`llmSelectSeeds` inline-промпт уже содержит "JSON" и описывает выходную структуру — инструкция `reasoning` добавляется опционально при `json_schema` mode через схему, не через текст промпта.

---

## Что НЕ меняем

- `extractStreamDeltas` — провайдеры с `delta.reasoning` продолжают работать как раньше
- Логику `continue` / `return null` при ошибке парсинга — поведение при ошибке сохраняется
- `claude-agent` backend — `jsonMode` в opts не выставляется → `buildChatParams` не добавляет `response_format`
- Статус `"done"` при отмене — вне scope

---

## Settings UI

Добавить в Obsidian Settings → Native Agent:

```
Structured Output: [ json_object ▾ ]
  json_object — valid JSON guaranteed (recommended, default)
  json_schema — schema-enforced + CoT (requires OpenAI / Qwen API)
  none        — plain text + fallback parsing
```

---

## Testing

1. `npm test` — существующие тесты не ломаются.
2. Новые unit-тесты в `tests/llm-utils.test.ts` (11 тестов):
   - `stripThinking`: без тегов → as-is; с `<think>`+JSON → только JSON; несколько блоков → все удалены; `{}` внутри `<think>` → не ломают результат
   - `parseStructured`: чистый JSON → напрямую; `<think>`+JSON → корректно; нет JSON → throws; вложенные объекты → корректно
   - `buildChatParams` с `responseSchema` + `jsonMode: "json_schema"` → `response_format.type === "json_schema"`
   - `buildChatParams` с `jsonMode: "json_object"` (без схемы) → `response_format.type === "json_object"`
   - `buildChatParams` без `jsonMode` → нет `response_format` в params
3. Новые фазовые тесты (regression для 5 call sites):
   - `tests/phases/init-thinking.test.ts`: mock LLM возвращает `<think>{...}</think>\n{valid DomainEntry}` → `init` корректно парсит, `entry.entity_types` заполнены
   - `tests/phases/init-thinking.test.ts`: `<think>` содержит `{` → не ломает; `fullText` без JSON → `yield` предупреждения + `continue` (поведение при ошибке не меняется)
   - `tests/phases/init-thinking.test.ts`: incremental delta (`:355`) — mock LLM возвращает `<think>...</think>\n{"entity_types":[...]}` → `EntityTypesDeltaResponse` корректно парсится, патч применяется
   - `tests/phases/lint-thinking.test.ts`: mock LLM возвращает `<think>...</think>\n{entity_types patch}` → `lint` применяет патч корректно
   - `tests/phases/query-thinking.test.ts`: mock LLM возвращает `<think>...</think>\n{"seeds":["PageA"]}` → `llmSelectSeeds` возвращает `["PageA"]`; `<think>` содержит `{` → не ломает результат

---

## Files Changed

| Файл | Изменение |
|---|---|
| `src/phases/llm-utils.ts` | `StructuredOutputSchema` тип, `stripThinking`, `parseStructured`, обновить `buildChatParams` |
| `src/phases/schemas.ts` | **НОВЫЙ** — 3 типа + 3 схемы |
| `src/types.ts` | `LlmCallOptions.jsonMode`, `nativeAgent.structuredOutput`, `DEFAULT_SETTINGS` |
| `src/agent-runner.ts` | обе ветки `buildOptsFor` (perOperation + base) получают `jsonMode` |
| `src/phases/init.ts` | импорты, 3 call sites → `parseStructured` + схемы |
| `src/phases/query.ts` | `llmSelectSeeds`: добавить `opts` параметр + `buildChatParams`; call site `runQuery:63` передаёт `opts` |
| `src/phases/lint.ts` | импорт, 1 call site → `parseStructured` + схема |
| `prompts/init.md` | CoT инструкция |
| `prompts/init-incremental.md` | CoT инструкция |
| `prompts/lint.md` | JSON + CoT инструкция |
| `src/settings.ts` | UI для `structuredOutput` |
| `tests/llm-utils.test.ts` | **НОВЫЙ** — unit-тесты (11 тестов) |
| `tests/phases/init-thinking.test.ts` | **НОВЫЙ** — фазовые regression-тесты init с `<think>`-контентом |
| `tests/phases/lint-thinking.test.ts` | **НОВЫЙ** — фазовый regression-тест lint с `<think>`-контентом |
| `tests/phases/query-thinking.test.ts` | **НОВЫЙ** — фазовый regression-тест `llmSelectSeeds` с `<think>`-контентом |

---

## Migration

`structuredOutput` — новое поле с дефолтом `"json_object"`. `loadSettings` в `main.ts` использует spread `{ ...defNA, ...naData }` — существующие установки без `structuredOutput` получают дефолт из `DEFAULT_SETTINGS`. Без UI-изменений со стороны пользователя.
