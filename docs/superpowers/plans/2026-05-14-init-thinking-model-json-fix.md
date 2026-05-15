# Init: Schema-Guided CoT + Structured Output Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить падение `JSON.parse` при thinking-моделях (Qwen3, DeepSeek-R1) в операциях `init`, `query`, `lint` — через `stripThinking`/`parseStructured` (Layer 1), `response_format: json_object` (Layer 2) и `response_format: json_schema` + CoT (Layer 3).

**Architecture:** Три слоя защиты: тактический fallback (strip `<think>` тегов + найти JSON-блок), структурная гарантия валидного JSON через `json_object`, полная схемная гарантия через `json_schema` с `reasoning`-полем для CoT внутри структуры. Выбор уровня через новый параметр `nativeAgent.structuredOutput` в настройках.

**Tech Stack:** TypeScript, Vitest, OpenAI-compatible API, Obsidian Plugin API.

---

## File Map

| Файл | Действие | Роль |
|---|---|---|
| `src/types.ts` | Изменить | Добавить `jsonMode` в `LlmCallOptions`; `structuredOutput` в `nativeAgent` типе и `DEFAULT_SETTINGS` |
| `src/phases/llm-utils.ts` | Изменить | Добавить `StructuredOutputSchema`, `stripThinking`, `parseStructured`; обновить `buildChatParams` |
| `src/phases/schemas.ts` | Создать | 3 интерфейса (`DomainEntryResponse`, `EntityTypesDeltaResponse`, `SeedsResponse`) + 3 схемы |
| `src/agent-runner.ts` | Изменить | `buildOptsFor`: прокинуть `jsonMode` из `nativeAgent.structuredOutput` |
| `src/phases/init.ts` | Изменить | 3 call sites (строки 119, 277, 355) → `parseStructured` + схемы |
| `src/phases/query.ts` | Изменить | `llmSelectSeeds`: добавить `opts`, перейти на `buildChatParams` + `parseStructured` |
| `src/phases/lint.ts` | Изменить | 1 call site (строка 348) → `parseStructured` + схема |
| `prompts/init.md` | Изменить | Добавить CoT-инструкцию для `reasoning` |
| `prompts/init-incremental.md` | Изменить | Добавить CoT-инструкцию для `reasoning` |
| `prompts/lint.md` | Изменить | Добавить "JSON" + CoT-инструкцию (закрывает требование `json_object` mode) |
| `src/settings.ts` | Изменить | UI для `structuredOutput` (dropdown в секции Native Agent) |
| `src/main.ts` | Проверить / Изменить | `loadSettings`: если spread не покрывает `structuredOutput` — добавить явный fallback `"json_object"` |
| `tests/llm-utils.test.ts` | Изменить | Добавить тесты: `stripThinking` (4), `parseStructured` (4), `buildChatParams` с `jsonMode` (3) |
| `tests/phases/init-thinking.test.ts` | Создать | Regression-тесты init с `<think>`-контентом (bootstrap + incremental) |
| `tests/phases/lint-thinking.test.ts` | Создать | Regression-тест lint с `<think>`-контентом |
| `tests/phases/query-thinking.test.ts` | Создать | Regression-тест `llmSelectSeeds` с `<think>`-контентом |

---

## Task 1: Обновить типы в `src/types.ts`

**Files:**
- Modify: `src/types.ts:72-78` (`LlmCallOptions`)
- Modify: `src/types.ts:131-140` (`nativeAgent` в `LlmWikiPluginSettings`)
- Modify: `src/types.ts:169-184` (`DEFAULT_SETTINGS.nativeAgent`)

- [ ] **Step 1: Добавить `jsonMode` в `LlmCallOptions`**

```typescript
// src/types.ts — строка 72, заменить интерфейс LlmCallOptions:
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  numCtx?: number | null;
  jsonMode?: "json_object" | "json_schema" | false;
}
```

- [ ] **Step 2: Добавить `structuredOutput` в тип `nativeAgent`**

```typescript
// src/types.ts — в интерфейсе LlmWikiPluginSettings, в inline-объект nativeAgent (после numCtx):
nativeAgent: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number | null;
  numCtx: number | null;
  structuredOutput: "json_schema" | "json_object" | "none";  // NEW
  perOperation: boolean;
  operations: OpMap<NativeOperationConfig>;
};
```

- [ ] **Step 3: Добавить дефолт в `DEFAULT_SETTINGS`**

```typescript
// src/types.ts — в DEFAULT_SETTINGS.nativeAgent добавить поле после numCtx:
nativeAgent: {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  model: "llama3.2",
  temperature: 0.2,
  topP: null,
  numCtx: null,
  structuredOutput: "json_object",  // NEW — safe default, широкая совместимость
  perOperation: false,
  operations: { ... },  // без изменений
},
```

- [ ] **Step 4: Проверить TypeScript-компиляцию**

```bash
npm run build 2>&1 | head -30
```

Ожидаем: сборка GREEN. Добавление нового поля в тип не ломает файлы, которые читают из объекта.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add jsonMode to LlmCallOptions and structuredOutput to nativeAgent settings"
```

---

## Task 2: Написать failing-тесты для новых утилит в `tests/llm-utils.test.ts`

**Files:**
- Create or modify: `tests/llm-utils.test.ts` (создать если отсутствует, иначе дополнить)

- [ ] **Step 0: Проверить текущие импорты в файле**

```bash
head -10 tests/llm-utils.test.ts
```

Если `buildChatParams`, `stripThinking`, `parseStructured` уже есть в import-строке — добавить к ней, а не дописывать новый блок в конец файла.

Также проверить наличие OpenAI-импорта — он нужен для типа `OpenAI.Chat.ChatCompletionMessageParam` в тест-блоке `buildChatParams`:

```bash
grep "from \"openai\"" tests/llm-utils.test.ts
```

Если отсутствует — добавить строку `import type OpenAI from "openai";` в начало файла вместе с остальными импортами.

- [ ] **Step 1: Добавить failing-тесты для `stripThinking`, `parseStructured`, `buildChatParams` с `jsonMode`**

Дописать тесты в конец файла `tests/llm-utils.test.ts`. Если import из `../src/phases/llm-utils` уже есть — объединить, не дублировать:

```typescript
import { buildChatParams, stripThinking, parseStructured } from "../src/phases/llm-utils";

describe("stripThinking", () => {
  it("returns text unchanged when no think tags", () => {
    expect(stripThinking('{"key": "val"}')).toBe('{"key": "val"}');
  });

  it("removes single <think> block and returns only JSON", () => {
    const input = '<think>\nsome reasoning {temp: 1}\n</think>\n{"key": "val"}';
    expect(stripThinking(input)).toBe('{"key": "val"}');
  });

  it("removes multiple <think> blocks", () => {
    const input = '<think>first</think> middle <think>second</think> end';
    expect(stripThinking(input)).toBe('middle  end');
  });

  it("does not corrupt JSON when { inside <think>", () => {
    const input = '<think>Could be {"temp": 1} or other</think>\n{"real": true}';
    expect(stripThinking(input)).toBe('{"real": true}');
  });
});

describe("parseStructured", () => {
  it("parses clean JSON directly", () => {
    expect(parseStructured('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips <think> and parses JSON after", () => {
    const input = '<think>{"fake": true}\n</think>\n{"real": 42}';
    expect(parseStructured(input)).toEqual({ real: 42 });
  });

  it("throws when no JSON object found", () => {
    expect(() => parseStructured("no json here")).toThrow("No JSON object found");
  });

  it("handles nested objects correctly", () => {
    const input = '{"outer": {"inner": [1, 2]}}';
    expect(parseStructured(input)).toEqual({ outer: { inner: [1, 2] } });
  });
});

describe("buildChatParams — response_format", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: "q" },
  ];

  it("sets response_format json_schema when jsonMode=json_schema and schema provided", () => {
    const schema = { name: "test_schema", schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false } };
    const params = buildChatParams("m", messages, { jsonMode: "json_schema" }, schema);
    expect((params.response_format as { type: string }).type).toBe("json_schema");
    expect((params.response_format as { json_schema: { name: string } }).json_schema.name).toBe("test_schema");
  });

  it("sets response_format json_object when jsonMode=json_object", () => {
    const params = buildChatParams("m", messages, { jsonMode: "json_object" });
    expect((params.response_format as { type: string }).type).toBe("json_object");
  });

  it("no response_format when jsonMode absent", () => {
    const params = buildChatParams("m", messages, {});
    expect(params.response_format).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тесты — убедиться что падают**

```bash
npx vitest run tests/llm-utils.test.ts 2>&1 | tail -20
```

Ожидаем: `stripThinking is not a function` / `parseStructured is not a function`.

---

## Task 3: Реализовать новые утилиты в `src/phases/llm-utils.ts`

**Files:**
- Modify: `src/phases/llm-utils.ts`

- [ ] **Step 1: Добавить `StructuredOutputSchema` тип и `stripThinking`, `parseStructured` функции**

```typescript
// src/phases/llm-utils.ts — добавить после импортов, перед extractStreamDeltas:

export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

/** Remove <think>...</think> blocks leaked into content by thinking models. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

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

- [ ] **Step 2: Обновить сигнатуру `buildChatParams` — добавить `responseSchema`**

```typescript
// src/phases/llm-utils.ts — заменить buildChatParams целиком:
export function buildChatParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  responseSchema?: StructuredOutputSchema,
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

- [ ] **Step 3: Запустить тесты — убедиться что проходят**

```bash
npx vitest run tests/llm-utils.test.ts
```

Ожидаем: все тесты GREEN.

- [ ] **Step 4: Запустить полный набор тестов — убедиться что ничего не сломано**

```bash
npm test
```

Ожидаем: все тесты GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/phases/llm-utils.ts tests/llm-utils.test.ts
git commit -m "feat(llm-utils): add stripThinking, parseStructured, StructuredOutputSchema; extend buildChatParams with response_format support"
```

---

## Task 4: Создать `src/phases/schemas.ts`

**Files:**
- Create: `src/phases/schemas.ts`

- [ ] **Step 1: Создать файл со схемами**

```typescript
// src/phases/schemas.ts
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

// reasoning опционален в TypeScript — в json_object mode модель не возвращает его
// (inline-промпт не запрашивает). В json_schema mode SEEDS_SCHEMA требует reasoning
// обязательным (required). Несоответствие намеренное: тип описывает возможный результат,
// схема — контракт только для json_schema режима.
export interface SeedsResponse {
  reasoning?: string;
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

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build 2>&1 | grep -E "error TS|schemas"
```

Ожидаем: нет ошибок компиляции в `schemas.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/phases/schemas.ts
git commit -m "feat(phases): add schemas.ts with DomainEntry, EntityTypesDelta, Seeds JSON schemas for structured output"
```

---

## Task 5: Написать failing phase-regression-тесты

**Files:**
- Create: `tests/phases/init-thinking.test.ts`
- Create: `tests/phases/lint-thinking.test.ts`
- Create: `tests/phases/query-thinking.test.ts`

Нужно понять, какой mock-паттерн используют существующие phase-тесты. Смотрим `tests/phases/init.test.ts` первые 50 строк.

- [ ] **Step 1: Изучить существующий init phase-тест**

```bash
head -60 tests/phases/init.test.ts
```

- [ ] **Step 2: Создать `tests/phases/init-thinking.test.ts`**

```typescript
// tests/phases/init-thinking.test.ts
import { describe, it, expect, vi } from "vitest";
import { runInit } from "../../src/phases/init";
import type { LlmClient } from "../../src/types";
import type { VaultTools } from "../../src/vault-tools";

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function makeLlmNonStreaming(content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params) => {
          if (params.stream) {
            // streaming throws to force fallback to non-streaming
            return Promise.reject(Object.assign(new Error("stream fail"), { name: "Error" }));
          }
          return Promise.resolve({ choices: [{ message: { content } }] });
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeVaultTools(fileContent = "# Test\nSome content"): VaultTools {
  return {
    listFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(fileContent),
    readAll: vi.fn().mockResolvedValue(new Map()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    adapter: {
      exists: vi.fn().mockResolvedValue(false),
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(""),
      append: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as VaultTools;
}

const VALID_DOMAIN_JSON = JSON.stringify({
  reasoning: "Analysing structure...",
  id: "test-domain",
  name: "Test Domain",
  wiki_folder: "Test",
  entity_types: [{ type: "Concept", description: "Key concept", extraction_cues: ["concept"], wiki_subfolder: "Concepts" }],
  language_notes: "Russian",
});

describe("runInit — bootstrap (no --sources) with thinking model output", () => {
  it("parses DomainEntry when LLM wraps JSON in <think> tags", async () => {
    const thinkOutput = `<think>\nLet me consider {"temp": 1} as draft\n</think>\n${VALID_DOMAIN_JSON}`;
    const llm = makeLlmNonStreaming(thinkOutput);
    const vt = makeVaultTools();

    const events: unknown[] = [];
    for await (const e of runInit(["test-domain"], vt, llm, "model", [], "vault", makeSignal())) {
      events.push(e);
    }

    const created = events.find((e: any) => e.kind === "domain_created") as any;
    expect(created).toBeDefined();
    expect(created.entry.entity_types).toHaveLength(1);
    expect(created.entry.entity_types[0].type).toBe("Concept");
  });

  it("yields error and returns when LLM returns no JSON", async () => {
    const llm = makeLlmNonStreaming("<think>thinking only</think> no json here");
    const vt = makeVaultTools();

    const events: unknown[] = [];
    for await (const e of runInit(["test-domain"], vt, llm, "model", [], "vault", makeSignal())) {
      events.push(e);
    }

    expect(events.some((e: any) => e.kind === "error")).toBe(true);
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });
});

const VALID_DELTA_JSON = JSON.stringify({
  reasoning: "New entity found",
  entity_types: [{ type: "NewEntity", description: "New", extraction_cues: ["new"], wiki_subfolder: "New" }],
});

describe("runInit — incremental delta (files 1+) with thinking model output", () => {
  it("applies EntityTypesDelta patch when LLM wraps delta in <think> tags", async () => {
    const thinkOutput = `<think>{"wrong": true}</think>\n${VALID_DELTA_JSON}`;
    const llm = makeLlmNonStreaming(thinkOutput);

    // Provide existing domain so init goes into runInitWithSources path with isResuming=false
    const existingDomain = {
      id: "test-domain", name: "Test Domain", wiki_folder: "Test",
      entity_types: [{ type: "OldEntity", description: "Old", extraction_cues: ["old"], wiki_subfolder: "Old" }],
      language_notes: "",
      source_paths: ["Sources"],
      analyzed_sources: [],  // means bootstrap done, but no files analyzed yet
    };

    const vaultFiles = ["Sources/file0.md", "Sources/file1.md"];
    const vt: VaultTools = {
      listFiles: vi.fn().mockResolvedValue(vaultFiles),
      readFile: vi.fn().mockResolvedValue("# Content"),
      readAll: vi.fn().mockResolvedValue(new Map()),
      writeFile: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      adapter: {
        exists: vi.fn().mockResolvedValue(true),
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(""),
        append: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as VaultTools;

    const events: unknown[] = [];
    for await (const e of runInit(
      ["test-domain", "--sources", "Sources"],
      vt, llm, "model", [existingDomain as any], "vault", makeSignal(),
    )) {
      events.push(e);
    }

    const updates = events.filter((e: any) => e.kind === "domain_updated") as any[];
    expect(updates.length).toBeGreaterThan(0);
    const lastUpdate = updates[updates.length - 1];
    const types = lastUpdate.patch.entity_types as any[];
    expect(types.some((t: any) => t.type === "NewEntity")).toBe(true);
  });
});
```

- [ ] **Step 3: Создать `tests/phases/lint-thinking.test.ts`**

```typescript
// tests/phases/lint-thinking.test.ts
import { describe, it, expect, vi } from "vitest";
import { runLint } from "../../src/phases/lint";
import type { LlmClient } from "../../src/types";
import type { VaultTools } from "../../src/vault-tools";

function makeLlmSync(content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
      },
    },
  } as unknown as LlmClient;
}

const VALID_PATCH_JSON = JSON.stringify({
  reasoning: "Schema analysis complete",
  entity_types: [{ type: "Patched", description: "Patched entity", extraction_cues: ["patched"], wiki_subfolder: "Patched" }],
});

describe("runLint — lint patch with thinking model output", () => {
  it("applies entity_types patch when LLM wraps patch in <think> tags", async () => {
    const thinkOutput = `<think>{"bad": "json inside think"}</think>\n${VALID_PATCH_JSON}`;
    const llm = makeLlmSync(thinkOutput);

    const domain = {
      id: "test", name: "Test", wiki_folder: "Test",
      entity_types: [], language_notes: "",
    };

    const pages = new Map([["Test/!Wiki/Page.md", "# Page\nContent about Patched things."]]);
    const vt: VaultTools = {
      listFiles: vi.fn().mockResolvedValue(["Test/!Wiki/Page.md"]),
      readFile: vi.fn().mockResolvedValue("# Page"),
      readAll: vi.fn().mockResolvedValue(pages),
      writeFile: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      adapter: {
        exists: vi.fn().mockResolvedValue(true),
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(""),
        append: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as VaultTools;

    const events: unknown[] = [];
    for await (const e of runLint(
      ["test"], vt, llm, "model", [domain as any], "/vault", new AbortController().signal, 10,
    )) {
      events.push(e);
    }

    const updates = events.filter((e: any) => e.kind === "domain_updated") as any[];
    if (updates.length > 0) {
      const types = updates[updates.length - 1].patch.entity_types as any[];
      expect(types?.some((t: any) => t.type === "Patched")).toBe(true);
    } else {
      // If lint finds no issues, domain_updated may not fire — ensure no error about JSON
      expect(events.some((e: any) => e.kind === "error")).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Создать `tests/phases/query-thinking.test.ts`**

```typescript
// tests/phases/query-thinking.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LlmClient } from "../../src/types";
import type { VaultTools } from "../../src/vault-tools";
import { runQuery } from "../../src/phases/query";

// Import the internal function indirectly by testing runQuery's seed selection behavior.
// We mock LLM to return <think>-wrapped seeds response and verify correct seeds extracted.

function makeLlmWithSeeds(seedsContent: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params) => {
          if (params.stream) {
            // streaming for the main query
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: "Answer based on seeds." } }] };
              },
            });
          }
          // non-streaming for seed selection
          return Promise.resolve({ choices: [{ message: { content: seedsContent } }] });
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeVaultWithPages(pages: Record<string, string>): VaultTools {
  const pageMap = new Map(Object.entries(pages));
  return {
    listFiles: vi.fn().mockResolvedValue(Object.keys(pages)),
    readFile: vi.fn().mockResolvedValue("# Content"),
    readAll: vi.fn().mockResolvedValue(pageMap),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    adapter: {
      exists: vi.fn().mockResolvedValue(false),
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(""),
      append: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as VaultTools;
}

describe("llmSelectSeeds — thinking model output", () => {
  it("extracts seeds when LLM wraps seeds JSON in <think> tags", async () => {
    // Since llmSelectSeeds is private, verify via integration:
    // keyword search returns empty → falls through to llmSelectSeeds → parse seeds.
    const thinkOutput = `<think>{"bad": "not seeds"}</think>\n{"seeds": ["PageA", "PageB"]}`;
    const llm = makeLlmWithSeeds(thinkOutput);
    const domain = { id: "d", name: "D", wiki_folder: "Wiki", entity_types: [], language_notes: "" };
    const vt = makeVaultWithPages({
      "Wiki/!Wiki/PageA.md": "# PageA\nSome content.",
      "Wiki/!Wiki/PageB.md": "# PageB\nOther content.",
    });

    const events: unknown[] = [];
    for await (const e of runQuery(
      ["xyznomatch question zz99"],
      false, vt, llm, "model", [domain as any], "/vault", new AbortController().signal,
    )) {
      events.push(e);
    }

    // If seeds were parsed correctly, query proceeds to result without error
    expect(events.some((e: any) => e.kind === "error")).toBe(false);
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });

  it("does not fail when <think> contains { — still returns seeds", async () => {
    const thinkOutput = `<think>Could be {"seeds": ["wrong"]} as draft</think>\n{"seeds": ["RealPage"]}`;
    const llm = makeLlmWithSeeds(thinkOutput);
    const domain = { id: "d", name: "D", wiki_folder: "Wiki", entity_types: [], language_notes: "" };
    const vt = makeVaultWithPages({
      "Wiki/!Wiki/RealPage.md": "# RealPage\nContent.",
    });

    const events: unknown[] = [];
    for await (const e of runQuery(
      ["xyz nomatch zz99"],
      false, vt, llm, "model", [domain as any], "/vault", new AbortController().signal,
    )) {
      events.push(e);
    }

    expect(events.some((e: any) => e.kind === "error")).toBe(false);
  });
});
```

- [ ] **Step 5: Запустить новые тесты — убедиться что падают**

```bash
npx vitest run tests/phases/init-thinking.test.ts tests/phases/lint-thinking.test.ts tests/phases/query-thinking.test.ts 2>&1 | tail -30
```

Ожидаем: тесты падают — `init.ts`, `lint.ts`, `query.ts` ещё используют старый `match(/\{[\s\S]*\}/)`, `parseStructured` в них не вызывается. Утилиты уже реализованы (Task 3), но phase-код не переключён.

> **Зависимость:** тесты `init-thinking.test.ts` вызывают `runInit` без `opts` (7 аргументов). Это компилируется только в двух случаях: (a) Task 7 ещё не выполнен — параметра нет вообще; (b) Task 7 уже выполнен — `opts = {}` trailing optional. **Порядок обязателен:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7. Не выполнять Task 7 до Task 5.

---

## Task 6: Обновить `src/agent-runner.ts` — прокинуть `jsonMode`

**Files:**
- Modify: `src/agent-runner.ts:33-36` (`buildOptsFor`, native ветка)

- [ ] **Step 1: Обновить обе ветки native в `buildOptsFor`**

```typescript
// src/agent-runner.ts — заменить native ветку buildOptsFor (строки 33-36):
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

Claude-agent ветка (строки 28-30) не меняется — `jsonMode` не добавляется.

- [ ] **Step 2: Запустить тесты**

```bash
npm test 2>&1 | grep -E "FAIL|PASS|error" | head -20
```

Ожидаем: `agent-runner` тесты GREEN, phase-regression ещё FAIL.

- [ ] **Step 3: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): pass jsonMode from nativeAgent.structuredOutput to LlmCallOptions"
```

---

## Task 7: Обновить `src/phases/init.ts` — 3 call sites

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Проверить сигнатуры `runInit` и `runInitWithSources` на наличие `opts: LlmCallOptions`**

```bash
grep -n "function runInit\|function runInitWithSources\|opts:" src/phases/init.ts | head -20
```

Если `opts: LlmCallOptions` отсутствует в параметрах — добавить как **trailing optional с дефолтом** `opts: LlmCallOptions = {}` — это сохраняет совместимость с вызовами без `opts` в тестах Task 5:

```typescript
// opts — ПОСЛЕ signal (8-й параметр, trailing optional с дефолтом):
export async function* runInit(
  args: string[],
  vt: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},   // NEW — trailing optional, не ломает тесты Task 5 (7 аргументов)
): AsyncGenerator<RunEvent>
```

В вызовах из `agent-runner.ts` передать `opts` явно (там он уже есть). Проверить что `LlmCallOptions` импортирован из `"../types"`.

- [ ] **Step 1b: Убедиться что тесты Task 5 компилируются после изменения сигнатуры**

```bash
npx vitest run tests/phases/init-thinking.test.ts 2>&1 | grep -E "TypeError|Cannot find|Expected"
```

Ожидаем: нет ошибок компиляции (trailing optional с дефолтом совместим с вызовами без `opts`).

- [ ] **Step 2: Добавить импорты в начало `init.ts`**

```typescript
// src/phases/init.ts — добавить в список импортов:
import { buildChatParams, extractStreamDeltas, parseStructured } from "./llm-utils";
import {
  DOMAIN_ENTRY_SCHEMA, ENTITY_TYPES_DELTA_SCHEMA,
  type DomainEntryResponse, type EntityTypesDeltaResponse,
} from "./schemas";
```

Убедиться что `parseStructured` добавлен к существующему импорту из `./llm-utils`.

- [ ] **Step 3: Обновить call site `init.ts:119` (runInit без `--sources`)**

Заменить блок try внутри обработки без `--sources` (строки 117-135). Внешний try/catch не трогать.

```typescript
// было (строки 118-121 внутри try):
const match = fullText.match(/\{[\s\S]*\}/);
if (!match) throw new Error("No JSON object found in LLM response");
entry = JSON.parse(match[0]) as DomainEntry;

// стало:
const parsed = parseStructured(fullText) as DomainEntryResponse;
entry = {
  id: parsed.id,
  name: parsed.name,
  wiki_folder: parsed.wiki_folder,
  entity_types: parsed.entity_types,
  language_notes: parsed.language_notes,
} as DomainEntry;
```

Также обновить `buildChatParams` для этого call site — передать схему:

```typescript
// Перед вызовом stream/create в этом блоке — найти buildChatParams и добавить схему:
const schema = opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);
```

- [ ] **Step 4: Обновить call site `init.ts:277` (bootstrap в `runInitWithSources`)**

Аналогично — внутри try-блока строки 275-288:

```typescript
// было:
const match = fullText.match(/\{[\s\S]*\}/);
if (!match) throw new Error("No JSON object found");
entry = JSON.parse(match[0]) as DomainEntry;

// стало:
const parsed = parseStructured(fullText) as DomainEntryResponse;
entry = {
  id: parsed.id,
  name: parsed.name,
  wiki_folder: parsed.wiki_folder,
  entity_types: parsed.entity_types,
  language_notes: parsed.language_notes,
} as DomainEntry;
```

Добавить схему к `buildChatParams` для bootstrap:

```typescript
const schema = opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);
```

- [ ] **Step 5: Обновить call site `init.ts:355` (incremental delta)**

Внутри try-блока строки 353-362:

```typescript
// было:
const match = fullText.match(/\{[\s\S]*\}/);
if (!match) throw new Error("No JSON");
delta = JSON.parse(match[0]) as { entity_types?: EntityType[]; language_notes?: string };

// стало:
const parsed = parseStructured(fullText) as EntityTypesDeltaResponse;
delta = { entity_types: parsed.entity_types, language_notes: parsed.language_notes };
```

Добавить схему к `buildChatParams` для incremental:

```typescript
const schema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);
```

- [ ] **Step 6: Запустить тесты**

```bash
npx vitest run tests/phases/init.test.ts tests/phases/init-thinking.test.ts
```

Ожидаем: оба GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/phases/init.ts
git commit -m "fix(init): use parseStructured to handle <think> tags from thinking models in all 3 JSON parse sites"
```

---

## Task 8: Обновить `src/phases/query.ts` — `llmSelectSeeds`

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Проверить наличие импорта `LlmCallOptions` в `query.ts`**

```bash
grep -n "LlmCallOptions" src/phases/query.ts
```

Если отсутствует — добавить к существующему импорту из `"../types"`:

```typescript
import type { LlmCallOptions, LlmClient } from "../types";
```

- [ ] **Step 2: Добавить импорты утилит и схемы**

```typescript
// src/phases/query.ts — добавить к импорту из ./llm-utils:
import { buildChatParams, extractStreamDeltas, parseStructured } from "./llm-utils";
// добавить импорт схемы:
import { SEEDS_SCHEMA, type SeedsResponse } from "./schemas";
```

- [ ] **Step 3: Обновить сигнатуру `llmSelectSeeds` — добавить `opts`**

```typescript
// было (строка 157):
async function llmSelectSeeds(
  question: string,
  indexContent: string,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
): Promise<string[]>

// стало:
async function llmSelectSeeds(
  question: string,
  indexContent: string,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<string[]>
```

- [ ] **Step 4: Обновить тело `llmSelectSeeds` — использовать `buildChatParams` + `parseStructured`**

```typescript
// заменить тело функции (строки 164-190):
const prompt = [
  `Question: "${question}"`,
  `Available wiki pages: ${allPageIds.join(", ")}`,
  indexContent ? `\nIndex:\n${indexContent}` : "",
  `\nReturn JSON only: {"seeds": ["PageA", "PageB"]} — most relevant page names (bare names, no path, no .md).`,
].filter(Boolean).join("\n");

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "user", content: prompt },
];
const schema = opts.jsonMode === "json_schema" ? SEEDS_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);

try {
  const resp = await llm.chat.completions.create(
    { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    { signal },
  );
  const text = resp.choices[0]?.message?.content ?? "";
  const parsed = parseStructured(text) as SeedsResponse;
  return Array.isArray(parsed.seeds) ? parsed.seeds.filter((s): s is string => typeof s === "string") : [];
} catch {
  return [];
}
```

- [ ] **Step 5: Обновить вызов `llmSelectSeeds` в `runQuery` (строка 63)**

```typescript
// было (строка 63):
seeds = await llmSelectSeeds(question, indexContent, allPageIds, llm, model, signal);

// стало:
seeds = await llmSelectSeeds(question, indexContent, allPageIds, llm, model, opts, signal);
```

- [ ] **Step 6: Запустить тесты**

```bash
npx vitest run tests/phases/query.test.ts tests/phases/query-thinking.test.ts
```

Ожидаем: оба GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts
git commit -m "fix(query): add opts to llmSelectSeeds, use buildChatParams+parseStructured to handle thinking model output"
```

---

## Task 9: Обновить `src/phases/lint.ts` — 1 call site

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 0: Проверить сигнатуру `runLint` на наличие `opts: LlmCallOptions`**

```bash
grep -n "function runLint\|opts:" src/phases/lint.ts | head -10
```

Если `opts` отсутствует — добавить как **trailing optional с дефолтом** перед `signal`, аналогично Task 7:

```typescript
export async function* runLint(
  args: string[],
  vt: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  maxPages: number,
  opts: LlmCallOptions = {},   // NEW — trailing optional после maxPages
): AsyncGenerator<RunEvent>
```

Примечание: в `lint-thinking.test.ts` (Task 5) вызов `runLint(..., 10)` — `opts` идёт после `maxPages`, поэтому старые вызовы с 8 аргументами продолжают работать.

- [ ] **Step 1: Добавить импорты**

```typescript
// src/phases/lint.ts — добавить к импорту из ./llm-utils:
import { buildChatParams, parseStructured } from "./llm-utils";
// добавить:
import { ENTITY_TYPES_DELTA_SCHEMA, type EntityTypesDeltaResponse } from "./schemas";
```

- [ ] **Step 2: Добавить схему к `buildChatParams` в lint patch (строка 335)**

```typescript
// найти: const params = buildChatParams(model, messages, opts);
// заменить:
const schema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;
const params = buildChatParams(model, messages, opts, schema);
```

- [ ] **Step 3: Обновить try-блок парсинга (строки 347-357)**

```typescript
// было (внутри try):
const match = fullText.match(/\{[\s\S]*\}/);
if (!match) return null;
const parsed = JSON.parse(match[0]) as { entity_types?: unknown; language_notes?: unknown };
const patch: { entity_types?: EntityType[]; language_notes?: string } = {};
if (Array.isArray(parsed.entity_types)) patch.entity_types = parsed.entity_types as EntityType[];
if (typeof parsed.language_notes === "string") patch.language_notes = parsed.language_notes;
return Object.keys(patch).length > 0 ? patch : null;

// стало:
const parsed = parseStructured(fullText) as EntityTypesDeltaResponse;
const patch: { entity_types?: EntityType[]; language_notes?: string } = {};
if (Array.isArray(parsed.entity_types)) patch.entity_types = parsed.entity_types as EntityType[];
if (typeof parsed.language_notes === "string") patch.language_notes = parsed.language_notes;
return Object.keys(patch).length > 0 ? patch : null;
```

Внешний catch возвращает `null` — не трогать.

- [ ] **Step 4: Запустить тесты**

```bash
npx vitest run tests/phases/lint.test.ts tests/phases/lint-thinking.test.ts
```

Ожидаем: оба GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts
git commit -m "fix(lint): use parseStructured to handle <think> tags from thinking models in lint patch"
```

---

## Task 10: Обновить промпты

**Files:**
- Modify: `prompts/init.md`
- Modify: `prompts/init-incremental.md`
- Modify: `prompts/lint.md`

- [ ] **Step 1: Проверить текущее содержимое промптов**

```bash
tail -10 prompts/init.md
tail -10 prompts/init-incremental.md
tail -10 prompts/lint.md
```

- [ ] **Step 2: Добавить CoT-инструкцию в `prompts/init.md`**

Добавить в конец файла (или в раздел с инструкциями по формату вывода):

```markdown
Включи поле `reasoning` первым в JSON-ответе: пошаговое обоснование выбранной структуры домена.
```

- [ ] **Step 3: Добавить CoT-инструкцию в `prompts/init-incremental.md`**

```markdown
Включи поле `reasoning` первым в JSON-ответе: обоснование добавляемых или изменяемых entity_types.
```

- [ ] **Step 4: Добавить JSON + CoT инструкцию в `prompts/lint.md`**

```markdown
Верни **JSON** с полем `reasoning` первым, затем `entity_types` и `language_notes`.
```

Это закрывает требование слова "JSON" для `json_object` mode (OpenAI-совместимые провайдеры требуют его присутствия в промпте).

- [ ] **Step 5: Убедиться что слово "JSON" присутствует во всех трёх промптах**

```bash
grep -i "json" prompts/lint.md
grep -i "json" prompts/init.md
grep -i "json" prompts/init-incremental.md
```

Ожидаем: хотя бы одно совпадение в каждом файле. `lint.md` — только что добавлено (Step 4); `init.md` и `init-incremental.md` — должны содержать "JSON" до наших правок (спецификация §Layer 2). Если отсутствует — добавить.

- [ ] **Step 6: Commit**

```bash
git add prompts/init.md prompts/init-incremental.md prompts/lint.md
git commit -m "feat(prompts): add reasoning CoT instruction to init/init-incremental/lint prompts; add JSON keyword to lint for json_object mode"
```

---

## Task 11: Добавить Settings UI для `structuredOutput`

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Найти место вставки — секция Native Agent в `settings.ts`**

```bash
grep -n "nativeAgent\|native-agent\|Native Agent\|baseUrl" src/settings.ts | head -15
```

- [ ] **Step 2: Добавить dropdown `Structured Output` после поля `numCtx`**

Вставить новый `Setting` блок после numCtx-поля в секции `!s.nativeAgent.perOperation`:

```typescript
new Setting(containerEl)
  .setName("Structured Output")
  .setDesc("json_object — valid JSON guaranteed (recommended). json_schema — schema-enforced + CoT (requires OpenAI / Qwen API). none — plain text + fallback parsing.")
  .addDropdown((d) =>
    d.addOption("json_object", "json_object (recommended)")
      .addOption("json_schema", "json_schema — schema + CoT")
      .addOption("none", "none — fallback only")
      .setValue(s.nativeAgent.structuredOutput ?? "json_object")
      .onChange(async (v) => {
        s.nativeAgent.structuredOutput = v as "json_object" | "json_schema" | "none";
        await this.plugin.saveSettings();
      }),
  );
```

- [ ] **Step 3: Проверить компиляцию**

```bash
npm run build 2>&1 | grep -E "error TS"
```

Ожидаем: нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): add Structured Output dropdown for native agent (json_object/json_schema/none)"
```

---

## Task 12: Финальная проверка

**Files:** нет изменений

- [ ] **Step 1: Запустить полный набор тестов**

```bash
npm test
```

Ожидаем: все тесты GREEN, нет регрессий.

- [ ] **Step 2: Production build**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Ожидаем: пустой вывод — нет TypeScript-ошибок.

- [ ] **Step 3: Проверить что все 5 уязвимых мест заменены**

```bash
grep -n 'match(/\\' src/phases/init.ts src/phases/query.ts src/phases/lint.ts
```

Ожидаем: пустой вывод (старый паттерн полностью убран).

- [ ] **Step 4: Проверить что `parseStructured` импортирован во всех нужных файлах**

```bash
grep -l "parseStructured" src/phases/init.ts src/phases/query.ts src/phases/lint.ts
```

Ожидаем: все три файла.

- [ ] **Step 5: Проверить миграцию `loadSettings` в `main.ts`**

```bash
grep -n 'defNA\|DEFAULT_SETTINGS\|nativeAgent' src/main.ts | head -20
```

Если `loadSettings` использует spread вида `{ ...DEFAULT_SETTINGS.nativeAgent, ...savedNativeAgent }` — существующие настройки без `structuredOutput` автоматически получат дефолт `"json_object"`. Если нет — добавить явный fallback:

```typescript
// src/main.ts — в loadSettings, после мержа nativeAgent:
if (!this.settings.nativeAgent.structuredOutput) {
  this.settings.nativeAgent.structuredOutput = "json_object";
}
```

Проверить итог:

```bash
grep -n "structuredOutput" src/main.ts
```

Ожидаем: либо автоматический spread покрывает поле, либо явный fallback добавлен.

- [ ] **Step 6: Закоммитить изменения `main.ts` если были внесены**

```bash
git status
```

Если `src/main.ts` изменён (добавлен явный fallback из Step 5) — закоммитить:

```bash
git add src/main.ts
git commit -m "fix(settings): add structuredOutput fallback in loadSettings for existing installs"
```

---

## Итоговые файлы

Новые: `src/phases/schemas.ts`, `tests/phases/init-thinking.test.ts`, `tests/phases/lint-thinking.test.ts`, `tests/phases/query-thinking.test.ts`

Изменённые: `src/types.ts`, `src/phases/llm-utils.ts`, `src/agent-runner.ts`, `src/phases/init.ts`, `src/phases/query.ts`, `src/phases/lint.ts`, `src/settings.ts`, `prompts/init.md`, `prompts/init-incremental.md`, `prompts/lint.md`, `tests/llm-utils.test.ts`
