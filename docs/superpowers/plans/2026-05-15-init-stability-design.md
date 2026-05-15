---
review:
  plan_hash: 72d1664628475492da8104d08086f4d11a42dd6ecb48982c369e33eca2551e9d
  spec_hash: 048522b11667eb85109ed64da0110f9dd7fa5fbddc3ea9a1463a5a6fc4658d7b
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      severity: WARNING
      phase: verifiability
      section: "Task 11 / Step 1"
      text: "Failing-тесты per-file pipeline даны псевдокодом с `// Setup ...`, без конкретных assertion expressions. Уточнить mock-инфраструктуру (MockVaultTools, MockLlmClient) и точные expect() до запуска."
      verdict: open
    - id: F-002
      severity: WARNING
      phase: verifiability
      section: "Task 11 / Step 5"
      text: "Критерий «либо PASS, либо требуют обновления» нечёткий. Команда `vitest ... | head -100` ad-hoc, без фиксированного списка тестов под правку."
      verdict: open
    - id: F-003
      severity: WARNING
      phase: consistency
      section: "Task 10 / Step 4"
      text: "Спека (Block 3) предписывает миграцию в `src/settings.ts:loadSettings`. План переносит в `DomainStore.load()` через `migrateDomainsV2`. Отклонение задокументировано в Self-Review, обосновано (domains хранятся отдельно от settings)."
      verdict: open
---

# Init Stability Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Три независимых фикса для `init` с native OpenAI-совместимым backend: авто-фоллбек structured output, размещение статей в подпапках по entity_type, per-file sequential pipeline (анализ+ingest в одном цикле).

**Architecture:** Block 1 — обёртка `wrapWithJsonFallback` над `LlmClient`, `json_object`-режим всегда, при ошибке backend → retry без `response_format`. Block 2 — `buildEntityTypesBlock` инжектит явные path-шаблоны из `entity_types[i].wiki_subfolder`. Block 3 — `runInitWithSources` переписан как один цикл `for file in toAnalyze: analyze → ingest → file_done`; миграция `analyzed_sources_v2` сбрасывает прогресс старого 2-фазного pipeline.

**Tech Stack:** TypeScript, OpenAI SDK (chat.completions streaming), vitest, esbuild, Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-05-15-init-stability-design.md`

---

## File Structure

Изменяемые файлы (все существующие):

| Файл | Ответственность |
|---|---|
| `src/types.ts` | сужение `LlmCallOptions.jsonMode`; удаление `nativeAgent.structuredOutput`; добавление `analyzed_sources_v2`; `init_start.phase` → optional |
| `src/phases/llm-utils.ts` | `parseStructured` fence-stripping; `wrapWithJsonFallback` + `isJsonModeError`; `buildChatParams` без `json_schema` |
| `src/agent-runner.ts` | всегда `jsonMode: "json_object"` для native; оборачивание `this.llm` через `wrapWithJsonFallback` |
| `src/settings.ts` | удалить UI dropdown `structuredOutput` |
| `src/main.ts` | в `loadSettings` — миграция `analyzed_sources` без `_v2` → `[]` |
| `src/domain.ts` | поле `analyzed_sources_v2?: boolean` в `DomainEntry` |
| `src/phases/init.ts` | rewrite `runInitWithSources` (per-file loop); выставлять `analyzed_sources_v2: true`; удалить ветки `json_schema`; убрать неиспользуемые импорты схем |
| `src/phases/query.ts` | удалить ветку `opts.jsonMode === "json_schema"` строка 183; удалить импорт `SEEDS_SCHEMA` если не нужен |
| `src/phases/lint.ts` | удалить ветку `opts.jsonMode === "json_schema"` строка 345; импорт `ENTITY_TYPES_DELTA_SCHEMA` если не нужен |
| `src/phases/ingest.ts` | `buildEntityTypesBlock(domain, wikiVaultPath)` — path-шаблоны; передать `wikiVaultPath` в call site |
| `prompts/ingest.md` | заменить строку 13 на правило с шаблоном из секции «ТИПЫ СУЩНОСТЕЙ ДОМЕНА» |
| `tests/llm-utils.test.ts` | удалить тест `json_schema`-варианта; добавить тесты `parseStructured` (fences); тесты `isJsonModeError`; тесты `wrapWithJsonFallback` |
| `tests/phases/init.test.ts` (расширение) | integration-тесты per-file pipeline, resume, abort, repeated init |
| `tests/phases/ingest.test.ts` (расширение) | тесты `buildEntityTypesBlock` |

---

## Task 1: Тип `LlmCallOptions.jsonMode` — сузить, убрать `json_schema`

**Files:**
- Modify: `src/types.ts:78`

- [ ] **Step 1: Изменить тип**

`src/types.ts:78`:

```typescript
jsonMode?: "json_object" | false;
```

(Удалить `"json_schema"`.)

- [ ] **Step 2: Проверка компиляции**

Run: `npx tsc --noEmit`
Expected: ошибки в `src/phases/init.ts:99,267,356`, `src/phases/query.ts:183`, `src/phases/lint.ts:345`, `src/phases/llm-utils.ts:67` — все сравнения с `"json_schema"` unreachable. Эти места будут исправлены в Task 2 и Task 5. Можно временно оставить либо пропустить шаг до Task 5.

- [ ] **Step 3: Commit (после Task 5 чтобы tsc был зелёным — НЕ коммитить пока)**

Откладывается. Финальный коммит этого изменения — в Task 5.

---

## Task 2: `buildChatParams` — удалить `json_schema` ветку

**Files:**
- Modify: `src/phases/llm-utils.ts:67-74`

- [ ] **Step 1: Удалить ветку `json_schema`**

`src/phases/llm-utils.ts:67-74`. Было:

```typescript
if (responseSchema && opts.jsonMode === "json_schema") {
  params.response_format = {
    type: "json_schema",
    json_schema: { name: responseSchema.name, schema: responseSchema.schema, strict: true },
  };
} else if (opts.jsonMode === "json_object") {
  params.response_format = { type: "json_object" };
}
```

Стало:

```typescript
if (opts.jsonMode === "json_object") {
  params.response_format = { type: "json_object" };
}
```

Параметр `responseSchema` оставить в сигнатуре функции (нужен для backward-compat вызовов, удаляется в Task 5 вместе с call-sites).

- [ ] **Step 2: Удалить failing-test для `json_schema`**

`tests/llm-utils.test.ts:118-123`. Удалить блок `it("sets response_format json_schema when jsonMode=json_schema and schema provided", ...)`.

- [ ] **Step 3: Запустить тесты**

Run: `npx vitest run tests/llm-utils.test.ts`
Expected: PASS (тест `json_object` и `no response_format when jsonMode absent` остаются зелёными).

- [ ] **Step 4: Commit**

```bash
git add src/phases/llm-utils.ts tests/llm-utils.test.ts
git commit -m "refactor(llm-utils): remove json_schema branch from buildChatParams"
```

---

## Task 3: `parseStructured` — поддержка markdown fences

**Files:**
- Modify: `src/phases/llm-utils.ts:21-28`
- Test: `tests/llm-utils.test.ts` (extend `describe("parseStructured")`)

- [ ] **Step 1: Failing-тесты**

Добавить в `tests/llm-utils.test.ts` в блок `describe("parseStructured", ...)`:

```typescript
it("strips ```json fences and parses", () => {
  const input = "```json\n{\"a\": 1}\n```";
  expect(parseStructured(input)).toEqual({ a: 1 });
});

it("strips plain ``` fences without language and parses", () => {
  const input = "```\n{\"b\": 2}\n```";
  expect(parseStructured(input)).toEqual({ b: 2 });
});

it("strips <think>...</think> followed by fenced JSON", () => {
  const input = "<think>reasoning</think>\n```json\n{\"c\": 3}\n```";
  expect(parseStructured(input)).toEqual({ c: 3 });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/llm-utils.test.ts -t "parseStructured"`
Expected: 3 новых теста FAIL (текущая реализация падает на fenced input).

- [ ] **Step 3: Реализация**

`src/phases/llm-utils.ts:21-28`. Заменить:

```typescript
export function parseStructured(fullText: string): unknown {
  const text = fullText.trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const stripped = stripFences(stripThinking(text));
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found");
  return JSON.parse(match[0]);
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  return fenced ? fenced[1].trim() : text;
}
```

- [ ] **Step 4: Тесты PASS**

Run: `npx vitest run tests/llm-utils.test.ts`
Expected: все тесты `parseStructured` PASS, существующие тесты не сломаны.

- [ ] **Step 5: Commit**

```bash
git add src/phases/llm-utils.ts tests/llm-utils.test.ts
git commit -m "feat(llm-utils): parseStructured strips markdown fences before regex fallback"
```

---

## Task 4: `wrapWithJsonFallback` + `isJsonModeError`

**Files:**
- Modify: `src/phases/llm-utils.ts` (add exports)
- Test: `tests/llm-utils.test.ts`

- [ ] **Step 1: Failing-тесты `isJsonModeError`**

В `tests/llm-utils.test.ts`:

```typescript
import { isJsonModeError, wrapWithJsonFallback } from "../src/phases/llm-utils";

describe("isJsonModeError", () => {
  it("true for status 400 with response_format keyword", () => {
    const e = Object.assign(new Error("response_format not supported"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for status 422 with json_object keyword", () => {
    const e = Object.assign(new Error("Unsupported json_object mode"), { status: 422 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for keyword 'json mode'", () => {
    const e = Object.assign(new Error("provider does not support json mode"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("true for keyword 'unsupported'", () => {
    const e = Object.assign(new Error("Unsupported response format"), { status: 400 });
    expect(isJsonModeError(e)).toBe(true);
  });
  it("false for 401/403/429/500", () => {
    for (const status of [401, 403, 429, 500]) {
      const e = Object.assign(new Error("response_format unsupported"), { status });
      expect(isJsonModeError(e)).toBe(false);
    }
  });
  it("false for 400 without trigger keyword", () => {
    const e = Object.assign(new Error("Invalid prompt token"), { status: 400 });
    expect(isJsonModeError(e)).toBe(false);
  });
  it("false for non-Error values", () => {
    expect(isJsonModeError("string error")).toBe(false);
    expect(isJsonModeError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Запуск — FAIL (символ не экспортирован)**

Run: `npx vitest run tests/llm-utils.test.ts -t "isJsonModeError"`
Expected: FAIL — `isJsonModeError is not a function`.

- [ ] **Step 3: Реализация `isJsonModeError`**

В конец `src/phases/llm-utils.ts`:

```typescript
const JSON_MODE_KEYWORDS = ["response_format", "json_object", "json mode", "unsupported"];

export function isJsonModeError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const status = (e as { status?: unknown }).status;
  if (status !== 400 && status !== 422) return false;
  const msg = String((e as { message?: unknown }).message ?? "").toLowerCase();
  return JSON_MODE_KEYWORDS.some((kw) => msg.includes(kw));
}
```

- [ ] **Step 4: Запуск — PASS**

Run: `npx vitest run tests/llm-utils.test.ts -t "isJsonModeError"`
Expected: 7 тестов PASS.

- [ ] **Step 5: Failing-тесты `wrapWithJsonFallback` non-stream**

```typescript
import type OpenAI from "openai";
import type { LlmClient } from "../src/types";

function makeMockLlm(handler: (params: Record<string, unknown>) => unknown): LlmClient {
  return {
    chat: {
      completions: {
        create: ((params: Record<string, unknown>) => Promise.resolve(handler(params))) as LlmClient["chat"]["completions"]["create"],
      },
    },
  };
}

describe("wrapWithJsonFallback — non-streaming", () => {
  it("retries without response_format on json-mode error", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner = makeMockLlm((params) => {
      calls.push(params);
      if (params.response_format) {
        const e = Object.assign(new Error("response_format unsupported"), { status: 400 });
        throw e;
      }
      return { choices: [{ message: { content: "ok", role: "assistant" }, index: 0, finish_reason: "stop" }] };
    });
    const wrapped = wrapWithJsonFallback(inner);
    const resp = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    expect(calls.length).toBe(2);
    expect(calls[0].response_format).toBeDefined();
    expect(calls[1].response_format).toBeUndefined();
    expect((resp as OpenAI.Chat.ChatCompletion).choices[0].message.content).toBe("ok");
  });

  it("rethrows non-json-mode errors without retry", async () => {
    let count = 0;
    const inner = makeMockLlm(() => {
      count++;
      throw Object.assign(new Error("quota exceeded"), { status: 429 });
    });
    const wrapped = wrapWithJsonFallback(inner);
    await expect(wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)).rejects.toThrow("quota exceeded");
    expect(count).toBe(1);
  });

  it("passes through when no response_format", async () => {
    let count = 0;
    const inner = makeMockLlm(() => {
      count++;
      return { choices: [{ message: { content: "x", role: "assistant" }, index: 0, finish_reason: "stop" }] };
    });
    const wrapped = wrapWithJsonFallback(inner);
    await wrapped.chat.completions.create({
      model: "m", messages: [], stream: false,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 6: Failing-тесты `wrapWithJsonFallback` streaming**

```typescript
describe("wrapWithJsonFallback — streaming", () => {
  it("retries when stream rejects at create()", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.reject(Object.assign(new Error("response_format not supported"), { status: 400 }));
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "hello" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks[0].choices[0].delta.content).toBe("hello");
  });

  it("retries when stream throws before first content chunk", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.resolve((async function* () {
            yield { choices: [{ delta: { role: "assistant" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
            throw Object.assign(new Error("json_object unsupported"), { status: 400 });
          })());
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "fallback ok" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks.some((c) => c.choices[0].delta.content === "fallback ok")).toBe(true);
  });

  it("does NOT retry after first content delta", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "partial" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
          throw Object.assign(new Error("response_format unsupported"), { status: 400 });
        })());
      }) as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    await expect((async () => {
      for await (const _ of stream) { /* drain */ }
    })()).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it("reasoning-only chunks don't count as content (retry still possible)", async () => {
    const calls: Record<string, unknown>[] = [];
    const inner: LlmClient = {
      chat: { completions: { create: ((params: Record<string, unknown>) => {
        calls.push(params);
        if (params.response_format) {
          return Promise.resolve((async function* () {
            yield { choices: [{ delta: { reasoning: "thinking..." }, index: 0, finish_reason: null }] } as unknown as OpenAI.Chat.ChatCompletionChunk;
            throw Object.assign(new Error("json_object not supported"), { status: 400 });
          })());
        }
        return Promise.resolve((async function* () {
          yield { choices: [{ delta: { content: "after-retry" }, index: 0, finish_reason: null }] } as OpenAI.Chat.ChatCompletionChunk;
        })());
      }) as LlmClient["chat"]["completions"]["create"] } },
    };
    const wrapped = wrapWithJsonFallback(inner);
    const stream = await wrapped.chat.completions.create({
      model: "m", messages: [], stream: true,
      response_format: { type: "json_object" },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const c of stream) chunks.push(c);
    expect(calls.length).toBe(2);
    expect(chunks.some((c) => c.choices[0].delta.content === "after-retry")).toBe(true);
  });
});
```

- [ ] **Step 7: Запустить — FAIL**

Run: `npx vitest run tests/llm-utils.test.ts -t "wrapWithJsonFallback"`
Expected: FAIL — `wrapWithJsonFallback is not a function`.

- [ ] **Step 8: Реализация `wrapWithJsonFallback`**

В `src/phases/llm-utils.ts`:

```typescript
import type { LlmClient } from "../types";

function hasContentDelta(chunk: OpenAI.Chat.ChatCompletionChunk): boolean {
  const c = chunk.choices?.[0]?.delta?.content;
  return typeof c === "string" && c.length > 0;
}

function stripResponseFormat(params: Record<string, unknown>): Record<string, unknown> {
  const next = { ...params };
  delete next.response_format;
  return next;
}

export function wrapWithJsonFallback(inner: LlmClient): LlmClient {
  const create = ((params: Record<string, unknown>, callOpts?: { signal?: AbortSignal }) => {
    const hasRf = params.response_format !== undefined;
    const isStream = params.stream === true;

    if (!hasRf) {
      return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
    }

    if (!isStream) {
      return (async () => {
        try {
          return await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(params, callOpts);
        } catch (e) {
          if (!isJsonModeError(e)) throw e;
          return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<unknown>)(stripResponseFormat(params), callOpts);
        }
      })();
    }

    return (async () => {
      let upstream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      try {
        upstream = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(params, callOpts);
      } catch (e) {
        if (!isJsonModeError(e)) throw e;
        return (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(stripResponseFormat(params), callOpts);
      }

      async function* gated(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
        const buffered: OpenAI.Chat.ChatCompletionChunk[] = [];
        let seenContent = false;
        try {
          for await (const chunk of upstream) {
            if (hasContentDelta(chunk)) seenContent = true;
            buffered.push(chunk);
            yield chunk;
          }
        } catch (e) {
          if (seenContent || !isJsonModeError(e)) throw e;
          const retry = await (inner.chat.completions.create as (p: unknown, o?: unknown) => Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>)(stripResponseFormat(params), callOpts);
          for await (const c of retry) yield c;
        }
      }
      return gated();
    })();
  }) as LlmClient["chat"]["completions"]["create"];

  return { chat: { completions: { create } } };
}
```

Замечание: `yield chunk` до проверки error — потребитель получает буферизованные чанки и `seenContent` ставится в `true`. Если ошибка возникает ПОСЛЕ content — `seenContent === true` → rethrow. Если ДО — retry с очищенным `response_format`. Буфер `buffered` оставлен для дебага (не используется в логике).

- [ ] **Step 9: Тесты PASS**

Run: `npx vitest run tests/llm-utils.test.ts`
Expected: все тесты `isJsonModeError` и `wrapWithJsonFallback` PASS.

- [ ] **Step 10: Commit**

```bash
git add src/phases/llm-utils.ts tests/llm-utils.test.ts
git commit -m "feat(llm-utils): add wrapWithJsonFallback + isJsonModeError for native backend json-mode auto-fallback"
```

---

## Task 5: Удалить ветки `json_schema` в фазах init/query/lint

**Files:**
- Modify: `src/phases/init.ts:99,267,356`
- Modify: `src/phases/query.ts:183`
- Modify: `src/phases/lint.ts:345`

- [ ] **Step 1: `init.ts` — убрать локали схем и аргументы**

`src/phases/init.ts:99`:
Было: `const schema = opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined;`
Удалить строку.
В строке 100 (`const params = buildChatParams(model, messages, opts, schema, true);`) — заменить `schema` на `undefined`.

`src/phases/init.ts:267`:
Было: `const bootstrapSchema = opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined;`
Удалить.
В строках 269 и 282 (`buildChatParams(model, messages, opts, bootstrapSchema, true)` и `buildChatParams(model, messages, opts, bootstrapSchema)`) — заменить `bootstrapSchema` на `undefined`.

`src/phases/init.ts:356`:
Было: `const deltaSchema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;`
Удалить.
В строках 358 и 371 — заменить `deltaSchema` на `undefined`.

`src/phases/init.ts:6-9` (импорт schemas):

```typescript
import {
  type DomainEntryResponse, type EntityTypesDeltaResponse,
} from "./schemas";
```

(Удалить `DOMAIN_ENTRY_SCHEMA`, `ENTITY_TYPES_DELTA_SCHEMA` из импорта — оставить только типы.)

- [ ] **Step 2: `query.ts:183`**

Было: `const schema = opts.jsonMode === "json_schema" ? SEEDS_SCHEMA : undefined;`
Удалить строку.
В следующей строке `const params = buildChatParams(model, messages, opts, schema);` — заменить `schema` на `undefined`.

Импорт: `import { SEEDS_SCHEMA, type SeedsResponse } from "./schemas";` → `import { type SeedsResponse } from "./schemas";`.

- [ ] **Step 3: `lint.ts:345`**

Было: `const schema = opts.jsonMode === "json_schema" ? ENTITY_TYPES_DELTA_SCHEMA : undefined;`
Удалить.
В следующей строке заменить `schema` на `undefined`.

Импорт: `import { ENTITY_TYPES_DELTA_SCHEMA, type EntityTypesDeltaResponse } from "./schemas";` → `import { type EntityTypesDeltaResponse } from "./schemas";`.

- [ ] **Step 4: tsc clean**

Run: `npx tsc --noEmit`
Expected: 0 ошибок (Task 1 + Task 5 завершены).

- [ ] **Step 5: Тесты**

Run: `npm test`
Expected: все существующие тесты PASS (за исключением, возможно, init/query/lint тестов, которые завязаны на `json_schema` — если найдутся, удалить такие проверки точечно).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/phases/init.ts src/phases/query.ts src/phases/lint.ts
git commit -m "refactor(phases): remove json_schema branches; narrow LlmCallOptions.jsonMode to json_object|false"
```

---

## Task 6: `agent-runner.ts` — всегда `json_object` + оборачивание

**Files:**
- Modify: `src/agent-runner.ts:1-10` (импорт)
- Modify: `src/agent-runner.ts:33-37` (buildOptsFor native)
- Modify: `src/agent-runner.ts:14` (constructor field)

- [ ] **Step 1: Импорт**

В `src/agent-runner.ts` после существующих импортов добавить:

```typescript
import { wrapWithJsonFallback } from "./phases/llm-utils";
```

- [ ] **Step 2: Обернуть `this.llm` в конструкторе**

Текущая строка 14: `private llm: LlmClient,`

Заменить тело конструктора так, чтобы `this.llm` стал обёрнутым:

```typescript
constructor(
  llm: LlmClient,
  private settings: LlmWikiPluginSettings,
  private vaultTools: VaultTools,
  private vaultName: string,
  private domains: DomainEntry[],
) {
  this.llm = wrapWithJsonFallback(llm);
}

private llm: LlmClient;
```

(Поле объявить отдельно — нельзя одновременно `private llm` и присваивать в теле, либо использовать вариант с явным присваиванием в теле. Конкретная форма:

```typescript
private llm: LlmClient;
constructor(
  llm: LlmClient,
  private settings: LlmWikiPluginSettings,
  private vaultTools: VaultTools,
  private vaultName: string,
  private domains: DomainEntry[],
) {
  this.llm = wrapWithJsonFallback(llm);
}
```
)

- [ ] **Step 3: `buildOptsFor` для native — всегда `json_object`**

`src/agent-runner.ts:33-37`. Заменить:

```typescript
const na = s.nativeAgent;
const jsonMode = na.structuredOutput === "none" ? (false as const) : na.structuredOutput;
const c = na.perOperation ? na.operations[key] : undefined;
if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode } };
return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode } };
```

На:

```typescript
const na = s.nativeAgent;
const c = na.perOperation ? na.operations[key] : undefined;
if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object" } };
return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object" } };
```

- [ ] **Step 4: tsc + тесты**

Run: `npx tsc --noEmit && npm test`
Expected: 0 ошибок tsc; все тесты PASS (включая `agent-runner.integration.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): force jsonMode=json_object for native; wrap llm with wrapWithJsonFallback"
```

---

## Task 7: Удалить `structuredOutput` из `LlmWikiPluginSettings` + DEFAULT_SETTINGS + UI

**Files:**
- Modify: `src/types.ts:139` (поле), `src/types.ts:178` (default)
- Modify: `src/settings.ts:297-309` (UI dropdown)

- [ ] **Step 1: Удалить поле в типе**

`src/types.ts:139`. Удалить строку:

```typescript
structuredOutput: "json_schema" | "json_object" | "none";
```

- [ ] **Step 2: Удалить из DEFAULT_SETTINGS**

`src/types.ts:178`. Удалить строку:

```typescript
structuredOutput: "json_object",
```

- [ ] **Step 3: Удалить UI dropdown**

`src/settings.ts:297-309`. Удалить весь блок:

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

- [ ] **Step 4: tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 ошибок; build успешен.

- [ ] **Step 5: Migration check**

Старые `data.json` с `nativeAgent.structuredOutput` загружаются: TypeScript structural typing игнорирует extra props. При первом `saveSettings()` поле исчезает (т.к. `this.settings.nativeAgent` копируется через spread, а такого поля больше нет в литералах). Активная миграция не требуется.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/settings.ts
git commit -m "refactor(settings): remove structuredOutput field; json_object always-on with auto-fallback"
```

---

## Task 8: `prompts/ingest.md` — explicit path rule

**Files:**
- Modify: `prompts/ingest.md:13`

- [ ] **Step 1: Заменить строку 13**

Было:

```
- Путь страницы должен начинаться с "{{wiki_path}}/"
```

Стало:

```
- Путь статьи определяется типом сущности — используй точный шаблон из секции «ТИПЫ СУЩНОСТЕЙ ДОМЕНА» (выше, до блока ПРАВИЛА), подставив имя сущности вместо <EntityName>
- Если тип сущности не определён или у домена нет entity_types → путь по умолчанию: {{wiki_path}}/<EntityName>.md
```

- [ ] **Step 2: Commit**

```bash
git add prompts/ingest.md
git commit -m "feat(prompts/ingest): explicit per-entity-type path template rule"
```

---

## Task 9: `buildEntityTypesBlock(domain, wikiVaultPath)` — path templates

**Files:**
- Modify: `src/phases/ingest.ts:242-251` (функция)
- Modify: `src/phases/ingest.ts:267` (call site)
- Test: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Failing-тесты**

Добавить в `tests/phases/ingest.test.ts`:

```typescript
import { buildEntityTypesBlock } from "../../src/phases/ingest";
import type { DomainEntry } from "../../src/domain";

describe("buildEntityTypesBlock — path templates", () => {
  it("emits subfolder path for entity with wiki_subfolder", () => {
    const domain: DomainEntry = {
      id: "ии", name: "ИИ", wiki_folder: "ии",
      entity_types: [{ type: "Технология", description: "d", extraction_cues: ["c"], wiki_subfolder: "Технологии" }],
    };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).toContain("Путь для сущностей этого типа: !Wiki/ии/Технологии/<EntityName>.md");
  });

  it("emits root path for entity without wiki_subfolder", () => {
    const domain: DomainEntry = {
      id: "ии", name: "ИИ", wiki_folder: "ии",
      entity_types: [{ type: "Концепция", description: "d", extraction_cues: ["c"] }],
    };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).toContain("Путь для сущностей этого типа: !Wiki/ии/<EntityName>.md");
    expect(block).not.toMatch(/!Wiki\/ии\/\//);
  });

  it("empty entity_types → no path lines", () => {
    const domain: DomainEntry = { id: "ии", name: "ИИ", wiki_folder: "ии", entity_types: [] };
    const block = buildEntityTypesBlock(domain, "!Wiki/ии");
    expect(block).not.toContain("Путь для сущностей этого типа");
  });
});
```

Замечание: `buildEntityTypesBlock` сейчас не экспортирован. Добавить `export` в Step 2.

- [ ] **Step 2: Запуск — FAIL**

Run: `npx vitest run tests/phases/ingest.test.ts -t "buildEntityTypesBlock"`
Expected: FAIL (функция не экспортирована либо не принимает второй аргумент).

- [ ] **Step 3: Изменить сигнатуру и тело**

`src/phases/ingest.ts:242-251`. Заменить:

```typescript
export function buildEntityTypesBlock(domain: DomainEntry, wikiVaultPath: string): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types.map((et) => {
    const pathTemplate = et.wiki_subfolder
      ? `${wikiVaultPath}/${et.wiki_subfolder}/<EntityName>.md`
      : `${wikiVaultPath}/<EntityName>.md`;
    return [
      `### Тип: ${et.type}`,
      `Описание: ${et.description}`,
      `Ключевые слова: ${et.extraction_cues.join(", ")}`,
      et.min_mentions_for_page != null ? `Мин. упоминаний для страницы: ${et.min_mentions_for_page}` : "",
      et.wiki_subfolder ? `Подпапка в wiki: ${et.wiki_subfolder}` : "",
      `Путь для сущностей этого типа: ${pathTemplate}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}
```

- [ ] **Step 4: Обновить call site**

`src/phases/ingest.ts:267`:

Было: `const entityTypesBlock = buildEntityTypesBlock(domain);`
Стало: `const entityTypesBlock = buildEntityTypesBlock(domain, wikiVaultPath);`

(`wikiVaultPath` уже в области видимости `buildIngestMessages`.)

- [ ] **Step 5: Тесты**

Run: `npx vitest run tests/phases/ingest.test.ts`
Expected: 3 новых теста PASS; существующие тесты ingest PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): inject per-entity-type path templates into prompt"
```

---

## Task 10: `DomainEntry.analyzed_sources_v2` + миграция в `loadSettings`

**Files:**
- Modify: `src/domain.ts:12-20`
- Modify: `src/main.ts` (loadSettings — где загружаются domains через DomainStore)
- Modify: `src/types.ts:53` (init_start.phase — необязательное)

- [ ] **Step 1: Добавить поле в `DomainEntry`**

`src/domain.ts:12-20`. Добавить после `analyzed_sources?: string[];`:

```typescript
analyzed_sources_v2?: boolean;
```

- [ ] **Step 2: `init_start.phase` → optional**

`src/types.ts:53`. Поле `phase?: "analysis" | "ingest"` уже optional. Проверить что Task 11 не сетит его в новом коде. (Action: ничего менять не нужно — поле уже опционально.)

- [ ] **Step 3: Найти место загрузки доменов**

Domains хранятся в отдельном `DomainStore`, не в `settings.json`. Спец говорит "loadSettings" но domains грузятся через `plugin.domainStore.load()`. Реальная точка миграции — `DomainStore.load()` либо первая загрузка в `main.ts`.

Run: `grep -n "domainStore\|DomainStore\|domains" /home/UF.RT.RU/i.y.tischenko/Документы/Git/obsidian-llm-wiki/src/main.ts`

Найти где `domainStore.load()` или эквивалент вызывается на старте плагина. Миграция:

```typescript
// после первой загрузки доменов:
const domains = await this.domainStore.load();
let dirty = false;
for (const d of domains) {
  if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
    d.analyzed_sources = [];
    d.analyzed_sources_v2 = true;
    dirty = true;
  }
}
if (dirty) await this.domainStore.save(domains);
```

Точная локация — внутри `onload()` или после `loadSettings()`. Альтернатива: миграция внутри самого `DomainStore.load()` — чище.

- [ ] **Step 4: Реализовать миграцию в `DomainStore`**

Открыть файл `DomainStore` (вероятно `src/domain-store.ts` или подобный). В методе `load()` после парсинга JSON:

```typescript
const domains: DomainEntry[] = parsed;
let migrated = false;
for (const d of domains) {
  if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
    d.analyzed_sources = [];
    d.analyzed_sources_v2 = true;
    migrated = true;
  }
}
if (migrated) await this.save(domains);
return domains;
```

- [ ] **Step 5: Unit-тест миграции**

Создать `tests/domain-store-migration.test.ts` (или расширить существующий):

```typescript
import { describe, it, expect } from "vitest";

// Псевдо-тест: миграцию проще покрыть через unit над чистой функцией.
// Извлечь helper migrateDomains(domains): { domains, migrated }
// и тестировать его независимо от store.
```

Если store не легко тестируется — вынести логику в чистую функцию `migrateDomainsV2(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean }` в `src/domain.ts` и тестировать её:

```typescript
import { migrateDomainsV2 } from "../src/domain";

describe("migrateDomainsV2", () => {
  it("resets analyzed_sources for domain without _v2", () => {
    const input = [{ id: "x", name: "X", wiki_folder: "x", analyzed_sources: ["a","b"] }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(true);
    expect(domains[0].analyzed_sources).toEqual([]);
    expect(domains[0].analyzed_sources_v2).toBe(true);
  });

  it("leaves domain with _v2 untouched", () => {
    const input = [{ id: "x", name: "X", wiki_folder: "x", analyzed_sources: ["a"], analyzed_sources_v2: true }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(false);
    expect(domains[0].analyzed_sources).toEqual(["a"]);
  });

  it("leaves domain without analyzed_sources untouched", () => {
    const input = [{ id: "x", name: "X", wiki_folder: "x" }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(false);
    expect(domains[0].analyzed_sources_v2).toBeUndefined();
  });
});
```

Добавить функцию в `src/domain.ts`:

```typescript
export function migrateDomainsV2(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean } {
  let migrated = false;
  for (const d of domains) {
    if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
      d.analyzed_sources = [];
      d.analyzed_sources_v2 = true;
      migrated = true;
    }
  }
  return { domains, migrated };
}
```

И вызывать в store: `const { domains, migrated } = migrateDomainsV2(parsed); if (migrated) await this.save(domains);`

- [ ] **Step 6: Запуск тестов**

Run: `npx vitest run tests/domain-store-migration.test.ts`
Expected: 3 теста PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain.ts src/<domain-store>.ts tests/domain-store-migration.test.ts
git commit -m "feat(domain): analyzed_sources_v2 marker + one-time migration resets pre-v2 progress"
```

---

## Task 11: `runInitWithSources` — переписать как per-file loop

**Files:**
- Modify: `src/phases/init.ts:179-475` (переписать целиком функцию)

- [ ] **Step 1: Failing integration-тест per-file pipeline**

Создать/расширить `tests/phases/init.test.ts` блок `describe("runInitWithSources — per-file pipeline", ...)`. Сценарий:

```typescript
describe("runInitWithSources — per-file pipeline", () => {
  it("writes articles for file[0] before LLM is called for file[1]", async () => {
    // Setup: mock vaultTools с записью в Map, mock LlmClient счётчиком вызовов.
    // toAnalyze = ["src/a.md", "src/b.md", "src/c.md"]
    // Bootstrap (file[0]): возвращает DomainEntry JSON.
    // Ingest (file[0]): возвращает [{path:"!Wiki/x/A.md", content:"..."}]
    // Проверить: после события file_done для file[0] vaultTools.writes содержит "!Wiki/x/A.md"
    // И mock-llm для file[1] вызван ПОСЛЕ записи file[0].
    // ...
  });

  it("resume: skips files already in analyzed_sources_v2 domain", async () => {
    // existing.analyzed_sources = ["a"], analyzed_sources_v2 = true
    // toAnalyze = ["a","b","c"] → реально обрабатываются только b,c
    // mock LLM проверяет: НЕ вызван для "a"
  });

  it("abort mid-file: analyzed_sources NOT updated for that file", async () => {
    // abort signal после получения domain_updated от Step 1 file[1], до runIngest
    // assert: currentDomain.analyzed_sources содержит file[0], НЕ содержит file[1]
  });

  it("repeated init: no new sources → toAnalyze empty → no LLM calls", async () => {
    // existing.analyzed_sources = ["a","b","c"], analyzed_sources_v2 = true
    // sourceFiles = ["a","b","c"]
    // assert: mock LLM call count === 0; result event emitted with "no new sources"
  });
});
```

(Тестовая инфраструктура: использовать существующие моки `MockVaultTools`, `MockLlmClient` из `tests/phases/init.test.ts` либо создать helpers.)

- [ ] **Step 2: Запуск — FAIL**

Run: `npx vitest run tests/phases/init.test.ts -t "per-file pipeline"`
Expected: тесты FAIL (текущая 2-фазная реализация не записывает в vault до конца Phase 1).

- [ ] **Step 3: Rewrite `runInitWithSources`**

`src/phases/init.ts:179-475`. Заменить тело функции на:

```typescript
async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  dryRun: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let outputTokens = 0;
  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const sourceFileLists = await Promise.all(sourcePaths.map((sp) => vaultTools.listFiles(sp)));
  const sourceFiles = [...new Set(sourceFileLists.flat())].filter((f) => f.endsWith(".md"));

  if (!sourceFiles.length) {
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);
  const isResuming = existing?.analyzed_sources !== undefined;
  const alreadyAnalyzed = new Set(existing?.analyzed_sources ?? []);
  const toAnalyze = isResuming
    ? sourceFiles.filter((f) => !alreadyAnalyzed.has(f))
    : sourceFiles;

  yield { kind: "init_start", totalFiles: toAnalyze.length };

  if (toAnalyze.length === 0) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Domain "${domainId}": no new sources to process.`,
      outputTokens: outputTokens || undefined,
    };
    return;
  }

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
  ]);

  let currentDomain: DomainEntry | null = existing ?? null;

  for (let i = 0; i < toAnalyze.length; i++) {
    if (signal.aborted) return;

    const file = toAnalyze[i];
    yield { kind: "file_start", file, index: i, total: toAnalyze.length };

    let fileContent: string;
    try {
      fileContent = await vaultTools.read(file);
    } catch {
      yield { kind: "assistant_text", delta: `⚠ ${file}: не удалось прочитать файл, пропускаем\n` };
      yield { kind: "file_done", file };
      continue;
    }

    yield { kind: "assistant_text", delta: `ℹ ${file}: ${fileContent.length} chars\n` };

    // --- Step 1: Analyze ---
    if (i === 0 && !isResuming) {
      // Bootstrap
      const systemContent = render(initTemplate, {
        domain_id: domainId,
        vault_name: vaultName,
        schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent}` : "",
        index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent}` : "",
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        { role: "user", content: `Domain ID: ${domainId}\nVault name: ${vaultName}\nSource paths: ${sourcePaths.join(", ")}\n\n${file}:\n${fileContent}` },
      ];

      let fullText = "";
      try {
        const params = buildChatParams(model, messages, opts, undefined, true);
        const stream = await llm.chat.completions.create(
          { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { signal },
        );
        for await (const chunk of stream) {
          const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
          if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
          if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
          if (tok !== undefined) outputTokens += tok;
        }
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        const params = buildChatParams(model, messages, opts, undefined);
        const resp = await llm.chat.completions.create(
          { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        );
        fullText = resp.choices[0]?.message?.content ?? "";
        const tok = extractUsage(resp);
        if (tok !== undefined) outputTokens += tok;
        if (fullText) yield { kind: "assistant_text", delta: fullText };
      }

      if (signal.aborted) return;

      let entry: DomainEntry;
      try {
        const parsed = parseStructured(fullText) as DomainEntryResponse;
        entry = {
          id: parsed.id,
          name: parsed.name,
          wiki_folder: parsed.wiki_folder,
          entity_types: parsed.entity_types,
          language_notes: parsed.language_notes,
        } as DomainEntry;
        const vaultPrefix = `vaults/${vaultName}/`;
        if (entry.wiki_folder?.startsWith(vaultPrefix)) entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
        if (entry.wiki_folder?.startsWith("!Wiki/")) entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
        if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap\n` };
        yield { kind: "file_done", file };
        continue;
      }

      if (dryRun) {
        yield {
          kind: "result",
          durationMs: Date.now() - start,
          text: `Dry run — domain entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``,
          outputTokens: outputTokens || undefined,
        };
        return;
      }

      currentDomain = {
        ...(existing ?? { id: domainId, name: entry.name }),
        wiki_folder: entry.wiki_folder,
        entity_types: entry.entity_types,
        language_notes: entry.language_notes,
        source_paths: sourcePaths,
        analyzed_sources: [],
        analyzed_sources_v2: true,
      };

      yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
      if (existing) {
        yield {
          kind: "domain_updated", domainId,
          patch: {
            entity_types: currentDomain.entity_types,
            language_notes: currentDomain.language_notes,
            wiki_folder: currentDomain.wiki_folder,
            analyzed_sources: [],
          },
        };
      } else {
        yield { kind: "domain_created", entry: currentDomain };
      }
      yield { kind: "tool_result", ok: true };
    } else {
      // Incremental: delta entity_types
      const currentEntityTypes = currentDomain?.entity_types ?? [];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: initIncrementalTemplate },
        { role: "user", content: `Текущие entity_types:\n${JSON.stringify(currentEntityTypes, null, 2)}\n\nФайл: ${file}\n\n${fileContent}` },
      ];

      let fullText = "";
      try {
        const params = buildChatParams(model, messages, opts, undefined, true);
        const stream = await llm.chat.completions.create(
          { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { signal },
        );
        for await (const chunk of stream) {
          const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
          if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
          if (content) { fullText += content; }
          if (tok !== undefined) outputTokens += tok;
        }
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        const params = buildChatParams(model, messages, opts, undefined);
        const resp = await llm.chat.completions.create(
          { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        );
        fullText = resp.choices[0]?.message?.content ?? "";
        const tok = extractUsage(resp);
        if (tok !== undefined) outputTokens += tok;
      }

      if (signal.aborted) return;

      let delta: { entity_types?: EntityType[]; language_notes?: string };
      try {
        const parsed = parseStructured(fullText) as EntityTypesDeltaResponse;
        delta = { entity_types: parsed.entity_types, language_notes: parsed.language_notes };
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем\n` };
        yield { kind: "file_done", file };
        continue;
      }

      if (!currentDomain) {
        yield { kind: "file_done", file };
        continue;
      }

      const mergedTypes = mergeEntityTypes(currentDomain.entity_types ?? [], delta.entity_types ?? []);
      currentDomain = {
        ...currentDomain,
        entity_types: mergedTypes,
        language_notes: delta.language_notes ?? currentDomain.language_notes,
        analyzed_sources_v2: true,
      };

      yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
      yield {
        kind: "domain_updated", domainId,
        patch: {
          entity_types: currentDomain.entity_types,
          language_notes: currentDomain.language_notes,
        },
      };
      yield { kind: "tool_result", ok: true };
    }

    if (signal.aborted) return;
    if (!currentDomain) {
      yield { kind: "file_done", file };
      continue;
    }

    // --- Step 2: Ingest (immediate write) ---
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts)) {
          yield ev;
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e as Error;
      }
      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      }
    }

    if (signal.aborted) return;

    // --- Mark file complete: update analyzed_sources ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: [...(currentDomain.analyzed_sources ?? []), file],
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield {
      kind: "domain_updated", domainId,
      patch: { analyzed_sources: currentDomain.analyzed_sources },
    };
    yield { kind: "tool_result", ok: true };

    yield { kind: "file_done", file };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  await appendLog(vaultTools, wikiRootGuess, domainId);

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${toAnalyze.length} source files.`,
    outputTokens: outputTokens || undefined,
  };
}
```

Замечание: `analyzed_sources` обновляется ПОСЛЕ успешного ingest (порядок гарантирует resume-safety). При abort mid-ingest или mid-analyze запись не происходит — file будет пере-обработан.

- [ ] **Step 4: Запуск тестов**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: новые integration-тесты PASS; существующие тесты init либо PASS, либо требуют обновления (если они проверяли 2-фазный pipeline с `init_start.phase`).

- [ ] **Step 5: Обновить существующие тесты init**

Найти в `tests/phases/init.test.ts` и `tests/phases/init.test.js` проверки `phase: "analysis"` / `phase: "ingest"` в `file_start`/`init_start`/`file_done` событиях. Удалить эти assertions либо обновить под новый формат (без `phase`).

Конкретные проверки определить запуском теста:

Run: `npx vitest run tests/phases/init.test.ts 2>&1 | head -100`

- [ ] **Step 6: Финальный build**

Run: `npm run build && npx tsc --noEmit`
Expected: 0 ошибок.

- [ ] **Step 7: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "feat(init): per-file sequential pipeline (analyze + ingest interleaved); analyzed_sources_v2 marker"
```

---

## Task 12: Финал — полный тест + manual smoke

- [ ] **Step 1: Полный test run**

Run: `npm test`
Expected: все тесты PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `dist/main.js` обновлён.

- [ ] **Step 3: Manual smoke (через Obsidian)**

1. Установить плагин (symlink на `dist/`).
2. Создать тестовый домен с native backend (Ollama / Qwen).
3. Запустить init на 3+ файлах с `entity_types` имеющим `wiki_subfolder`.
4. Проверить: статьи появляются в vault поэтапно (наблюдаемо в файловой системе после каждого `file_done`).
5. Проверить: статьи лежат в `!Wiki/<domain>/<wiki_subfolder>/<Name>.md`, не в корне.
6. Прервать init mid-file → запустить заново → проверить что прерванный файл пере-обработан.
7. Запустить init второй раз с теми же файлами → должен emit "no new sources".
8. Если LLM не поддерживает `json_object` (тест на старой модели/proxy) → проверить в логах что fallback retry произошёл, init завершился успехом.

- [ ] **Step 4: Commit (если manual smoke выявил мелкие правки)**

При наличии финальных правок:

```bash
git add -p
git commit -m "fix: post-smoke corrections"
```

---

## Self-Review Notes

**Spec coverage:**
- Block 1 (auto-fallback): Tasks 2,3,4,6,7 — все DoD пункты покрыты (parseStructured fences, isJsonModeError, wrapWithJsonFallback non-stream + stream, удаление json_schema из типа/UI/buildChatParams/phases).
- Block 2 (subfolder placement): Tasks 8,9 — buildEntityTypesBlock с path templates, prompt fix, тесты с/без wiki_subfolder, пустой entity_types.
- Block 3 (per-file pipeline): Tasks 10,11 — rewrite runInitWithSources, analyzed_sources_v2 marker и миграция, integration-тесты resume/abort/repeated/per-file write order. **Из спеца "manual: статьи появляются в vault инкрементально" → покрыт Task 12 Step 3.**

**Известные расхождения spec ↔ план:**
- Спец говорит миграцию делать в `src/settings.ts` `loadSettings`. Реально `loadSettings` в `src/main.ts`, а domains в `DomainStore`. План корректирует: миграция в `DomainStore.load()` через чистую функцию `migrateDomainsV2` (Task 10).

**Type consistency:** `wrapWithJsonFallback` принимает/возвращает `LlmClient`. `isJsonModeError(e: unknown): boolean`. `buildEntityTypesBlock(domain: DomainEntry, wikiVaultPath: string): string`. `migrateDomainsV2(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean }`. Все имена согласованы между задачами.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-init-stability-design.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, ревью между задачами, быстрая итерация.

**2. Inline Execution** — задачи в текущей сессии через executing-plans, batch-выполнение с checkpoints.

**Какой подход?**
