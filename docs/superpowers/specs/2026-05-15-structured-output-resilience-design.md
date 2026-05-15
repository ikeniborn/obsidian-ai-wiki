---
title: Structured Output Resilience (zod + retry + telemetry)
date: 2026-05-15
status: draft
---

# Structured Output Resilience

## Контекст

Серия рефакторингов 2026-05-15 (`94a3083`, `e8462c3`, `75d6e52`, `bd760d2`) удалила
`StructuredOutputSchema`-инфраструктуру и `json_schema` mode. Остались три
unsafe call-site, кастующие результат `parseStructured()` в TS-интерфейс без
runtime-проверки:

- `src/phases/init.ts:126` — `DomainEntryResponse` (bootstrap)
- `src/phases/init.ts:291` — `DomainEntryResponse` (init с sources, файл 0)
- `src/phases/init.ts:380` — `EntityTypesDeltaResponse` (init delta, файл 1+)
- `src/phases/lint.ts:361` — `EntityTypesDeltaResponse`
- `src/phases/query.ts:192` — `SeedsResponse`

Если LLM вернёт сломанный JSON — UB: undefined-поля попадают в downstream
(`mergeEntityTypes`, `entry.id`, `seeds[]`), создавая молчаливые ошибки.

`wrapWithJsonFallback` решает совместимость провайдеров (json_object → no-format)
но не валидирует содержимое. Сетевая защита есть — структурной нет.

## Цель

Вернуть структурную безопасность на уровень pre-removal через runtime-валидацию
zod-схемами, без возврата к `json_schema`-mode (несовместим с рядом провайдеров).
Добавить retry-with-feedback, JSON-примеры в промптах и telemetry.

Scope (5 фич):

1. zod runtime-валидаторы (3 схемы)
2. Контрактные тесты на фикстурах
3. Retry-with-feedback (configurable, default 1)
4. JSON-пример в промптах (4 промпта)
5. Telemetry структурных ошибок (agent.jsonl + status bar)

Out of scope: partial-tolerant merge (strict policy выбрана), возврат
json_schema-mode, доменная content-валидация (остаётся в call-sites как сейчас).

## Архитектура

```
parseStructured(text)            existing JSON-extractor
  ↓ unknown
schema.safeParse(raw)            zod runtime-валидация
  ↓ ok? → typed value
  ↓ fail? → ZodError
       ↓
parseWithRetry orchestrator      retry с feedback на zod-fail
  ↓ retries исчерпаны → throw StructuredValidationError
       ↓
call-site: emit structural_error RunEvent → strict abort/skip
       ↓
controller.logEvent → !Logs/agent.jsonl
structuralErrorCounter → status bar
```

### Новые модули

- `src/phases/zod-schemas.ts` — 3 zod-схемы + `z.infer<>` экспорты
- `src/phases/parse-with-retry.ts` — orchestrator + `formatZodFeedback()`
  + `StructuredValidationError`
- `src/structural-error-counter.ts` — singleton counter + subscribe API

### Изменённые модули

- `src/phases/schemas.ts` — становится `export * from "./zod-schemas"` (compat)
- `src/phases/init.ts`, `lint.ts`, `query.ts` — заменить `parseStructured(...) as Type`
  на `parseWithRetry(...)`. Streaming + non-stream fallback логика поглощается
  внутрь orchestrator (~30 строк дублирования в init.ts → один await).
- `src/types.ts` — `RunEvent` variant `structural_error`,
  `nativeAgent.structuredRetries: number`
- `src/main.ts` — `addStatusBarItem()` + subscribe на counter
- `src/settings.ts` — number input для `structuredRetries`
- `prompts/init.md`, `prompts/init-incremental.md`, `prompts/lint.md`,
  `prompts/query.md` — `## Output JSON Example` блок
- `package.json` — `zod` в dependencies

## Компоненты

### zod-схемы

`src/phases/zod-schemas.ts`:

```ts
import { z } from "zod";

const EntityTypeSchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  extraction_cues: z.array(z.string()),
  min_mentions_for_page: z.number().optional(),
  wiki_subfolder: z.string().optional(),
});

export const DomainEntrySchema = z.object({
  reasoning: z.string(),
  id: z.string().min(1),
  name: z.string(),
  wiki_folder: z.string().min(1),
  entity_types: z.array(EntityTypeSchema),
  language_notes: z.string(),
});

export const EntityTypesDeltaSchema = z.object({
  reasoning: z.string(),
  entity_types: z.array(EntityTypeSchema).optional(),
  language_notes: z.string().optional(),
});

export const SeedsSchema = z.object({
  reasoning: z.string().optional(),
  seeds: z.array(z.string()),
});

export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
```

Решения:
- `EntityTypeSchema.wiki_subfolder` optional (соответствует `domain.ts:9`).
- `min(1)` на критичные поля (`id`, `wiki_folder`, `type`) — пустая строка
  blocking.
- `reasoning` обязателен в DomainEntry/Delta (CoT-промпт всегда требует),
  optional в Seeds (legacy совместимость).
- Без `.strict()` — лишние поля от LLM игнорируются (forward compat).
- Только форма: `validateDomainId`, prefix-strip `wiki_folder`,
  `mergeEntityTypes` остаются в call-sites без изменений.

### parseWithRetry orchestrator

`src/phases/parse-with-retry.ts`:

```ts
import type { z } from "zod";
import type OpenAI from "openai";
import type { LlmClient, LlmCallOptions, RunEvent } from "../types";
import {
  parseStructured, buildChatParams, extractStreamDeltas, extractUsage,
} from "./llm-utils";
import { structuralErrorCounter } from "../structural-error-counter";

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: string,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempts: ${lastError.message}`);
  }
}

export type CallSite =
  | "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";

export interface ParseWithRetryArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  schema: z.ZodSchema<T>;
  maxRetries: number;       // 0 = без retry (1 вызов всего)
  callSite: CallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export interface ParseWithRetryResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;         // последний raw-ответ для debug-логов
}

export async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<ParseWithRetryResult<T>>;

export function formatZodFeedback(err: z.ZodError, raw: string): string;
```

Поведение:

1. На каждой попытке: streaming-вызов через `buildChatParams` + retry на
   non-stream fallback (existing pattern из init.ts:100-120).
2. По завершении стрима: `parseStructured(fullText)` → `unknown`.
   - Throw → errorType `"json_parse"`.
3. `schema.safeParse(raw)` — fail → errorType `"schema_validate"`.
4. На fail с `attempt < maxRetries`:
   - emit `{kind: "structural_error", succeeded: null, retryAttempt: attempt, ...}`
   - append к `baseMessages`: `{role: "assistant", content: fullText}` +
     `{role: "user", content: formatZodFeedback(err, fullText)}`.
   - Recurse на новый attempt.
5. На success после retry (attempt > 0): emit
   `{succeeded: true, retryAttempt: attempt}`.
6. На исчерпание: emit `{succeeded: false, retryAttempt: maxRetries}` + throw
   `StructuredValidationError`.
7. `signal.aborted` mid-stream — throw AbortError, no event, no counter.
8. На каждый emit — синхронно `structuralErrorCounter.record(succeeded, attempt)`.

Counter правила (см. ниже): `succeeded=null` → noop, `true` → `retried++`,
`false` → `failed++`, success без retries (attempt=0) → `ok++`.

`formatZodFeedback`:

```
Previous response failed validation:
- entity_types[2].extraction_cues: expected array, got string
- missing required: wiki_folder
Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.
```

### Call-site замена

`init.ts:124-147` (bootstrap) сворачивается до:

```ts
let parsed: DomainEntryResponse;
try {
  const r = await parseWithRetry({
    llm, model, baseMessages: messages, opts,
    schema: DomainEntrySchema,
    maxRetries: opts.structuredRetries ?? 1,
    callSite: "init.bootstrap",
    signal,
    onEvent: (e) => { /* yield via collector */ },
  });
  parsed = r.value;
  outputTokens += r.outputTokens;
} catch (e) {
  yield { kind: "error", message: `Failed to parse domain entry: ${(e as Error).message}` };
  return;
}
// existing wiki_folder strip + content checks остаются:
const entry: DomainEntry = { id: parsed.id, name: parsed.name, ... };
if (entry.wiki_folder?.startsWith(`vaults/${vaultName}/`)) ...
```

Aналогично для init.ts:289 (init.bootstrap), init.ts:378 (init.delta),
lint.ts:359 (lint.patch), query.ts:190 (query.seeds).

Note: orchestrator принимает callback `onEvent`, но генераторы должны
yield-ить события. Решение: orchestrator возвращает накопленный массив событий
в результате, либо принимает async generator. Финальный API уточняется в plan
при первой реализации (init.bootstrap), затем тиражируется.

### Telemetry — RunEvent

`src/types.ts` добавить вариант:

```ts
| { kind: "structural_error";
    callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
    errorType: "json_parse" | "schema_validate";
    retryAttempt: number;        // 0 = первая попытка, 1+ = retry
    succeeded: boolean | null;   // null = mid-flight (будет retry),
                                 // true = retry помог,
                                 // false = исчерпано
    message: string;             // formatted feedback (zod path/expected/got)
  }
```

`controller.ts:478` фильтрует только `assistant_text`, `structural_error`
проходит через существующий `logEvent` без изменений (verify в plan).

### Telemetry — structural-error-counter

`src/structural-error-counter.ts`:

```ts
export interface StructuralErrorStats {
  failed: number;    // exhausted retries
  retried: number;   // succeeded after >=1 retry
  ok: number;        // succeeded on first attempt (без retry)
}

class Counter {
  private stats: StructuralErrorStats = { failed: 0, retried: 0, ok: 0 };
  private listeners = new Set<(s: StructuralErrorStats) => void>();

  record(succeeded: boolean | null, retryAttempt: number): void {
    if (succeeded === null) return;
    if (!succeeded) this.stats.failed++;
    else if (retryAttempt > 0) this.stats.retried++;
    else this.stats.ok++;
    for (const fn of this.listeners) fn({ ...this.stats });
  }

  subscribe(fn: (s: StructuralErrorStats) => void): () => void;
  get(): StructuralErrorStats;
  reset(): void;
}

export const structuralErrorCounter = new Counter();
```

Note: `ok` инкрементируется на каждом успешном вызове (даже первом), чтобы
status bar показывал ratio failures/total. `parseWithRetry` всегда вызывает
`record()` при финальном исходе (success или throw).

### Telemetry — status bar

`src/main.ts` в `onload()`:

```ts
const statusBar = this.addStatusBarItem();
statusBar.setText("schema: 0/0");
const unsub = structuralErrorCounter.subscribe((s) => {
  const total = s.failed + s.retried + s.ok;
  statusBar.setText(`schema: ${s.failed}/${total}`);
  statusBar.setAttribute(
    "aria-label",
    `validation: ${s.ok} ok, ${s.retried} retried, ${s.failed} failed`,
  );
});
this.register(() => unsub());
```

Формат: `schema: <failed>/<total>`. Tooltip раскрывает breakdown.
При `total=0` показ `schema: 0/0` (informational, не скрываем).

### Settings

`src/types.ts`:

```ts
nativeAgent: {
  ...,
  structuredRetries: number;  // default 1, range 0-3
}
```

`src/settings.ts` — number input в существующей nativeAgent-секции:
- label: "Structured output retries"
- desc: "Retries on schema validation failure (0-3, default 1). Higher
  values improve success rate on weaker models at cost of latency/tokens."
- min 0, max 3, default 1

Migration: при отсутствии поля → 1 (читать через `?? 1`).

### Prompts — JSON example

В каждый из 4 промптов добавить блок перед существующей секцией формата:

`prompts/init.md` (bootstrap):

```markdown
## Output JSON Example

{
  "reasoning": "Analysed source files. Identified entities: Process, ServiceContract...",
  "id": "telecom",
  "name": "Telecom Operations",
  "wiki_folder": "telecom",
  "entity_types": [
    {
      "type": "Process",
      "description": "Business process step",
      "extraction_cues": ["BPMN", "workflow"],
      "wiki_subfolder": "processes"
    }
  ],
  "language_notes": "Mix of Russian/English; preserve original casing for product names."
}
```

`prompts/init-incremental.md` — EntityTypesDelta example.
`prompts/lint.md` — EntityTypesDelta example (для lint patch JSON output, lint.ts:361).
`prompts/query.md` — Seeds example (для llmSelectSeeds, query.ts:192).

Solid example снижает % битых ответов на слабых моделях больше, чем
текстовое описание схемы.

## Тестирование

### Контрактные тесты на фикстурах

`tests/fixtures/structured/`:

```
domain-entry-valid.json          полный валидный
domain-entry-missing-id.json     отсутствует required поле
domain-entry-wrong-type.json     entity_types не array
delta-valid.json
delta-empty-arrays.json          entity_types: []
delta-extra-fields.json          лишние поля (forward-compat)
seeds-valid.json
seeds-non-string-elem.json       seeds: ["ok", 42, "ok2"]
```

`tests/phases/zod-schemas.test.ts`:
- каждая схема: `parse(valid)` → ok
- каждая схема: `parse(invalid)` → fail с конкретным path в ZodError
- forward-compat: extra fields игнорируются, parse → ok

### parse-with-retry tests

`tests/phases/parse-with-retry.test.ts` (mock LlmClient):

- `maxRetries=0`, valid → ok за 1 вызов
- `maxRetries=0`, invalid → throw `StructuredValidationError`, 1 вызов
- `maxRetries=1`, fail+ok → ok за 2 вызова, второй msg содержит "failed validation"
- `maxRetries=1`, fail+fail → throw, 2 вызова
- `parseStructured` throw (не-JSON) → errorType `"json_parse"` в event
- zod fail → errorType `"schema_validate"` в event
- `signal.aborted` mid-stream → пробрасывает AbortError, no event
- emit `succeeded=true` после успешного retry
- emit `succeeded=false` после исчерпания

### structural-error-counter tests

`tests/structural-error-counter.test.ts`:
- record/get базовый
- subscribe → callback на каждый record
- unsubscribe работает
- reset обнуляет
- `succeeded=null` → noop

### Integration

`tests/agent-runner.integration.test.ts` — кейс: mock LLM возвращает
невалидный JSON для init → AgentRunner emit `structural_error` + `error`
event, не падает (single-flight остаётся consistent).

### Existing tests

- `tests/llm-utils.test.ts` — без изменений (parseStructured неизменён).
- `tests/phases/init-thinking.test.ts`, `lint-thinking.test.ts`,
  `query-thinking.test.ts` — функционально остаются (thinking → parseStructured
  → zod). Если call-site signature сменится — обновить mocks.

## Применимость к backends

Плагин поддерживает 2 backend (`src/types.ts: backend = "native-agent" | "claude-agent"`).
Оба роутятся через одни и те же phases (init/lint/query), поэтому zod-валидация
+ parseWithRetry применяются к обоим. Различия:

### native-agent (OpenAI-совместимые провайдеры)

- `buildOptsFor` выставляет `jsonMode: "json_object"` (agent-runner.ts:39-40).
- `wrapWithJsonFallback` страхует от провайдеров без `response_format`.
- Multi-turn retry: orchestrator передаёт полный `[...base, assistant, user-feedback]`
  в один HTTP-запрос — стандартный OpenAI multi-turn.
- **Полная функциональность retry-with-feedback работает as designed.**

### claude-agent (`ClaudeCliClient` через `iclaude.sh`)

- `buildOptsFor` НЕ выставляет `jsonMode` (agent-runner.ts:33-34) — Claude Code
  сам форматирует через CLI; `response_format` не применим.
- `wrapWithJsonFallback` для claude-agent — pass-through (нет
  `response_format` в params, ранний return в llm-utils.ts:134).
- **Особенность multi-turn**: `ClaudeCliClient._create` (claude-cli-client.ts:49)
  берёт ТОЛЬКО last user message; assistant-история игнорируется. При resume
  через `--resume <sessionId>` Claude помнит prior context из своей сессии.
- Retry для claude-agent: orchestrator должен либо
  (a) встроить `fullText` (raw bad output) прямо в текст user-feedback message,
  чтобы Claude увидел "previous output: <bad>; errors: <list>; retry"
  единым сообщением, либо
  (b) опираться на `lastSessionId` + resume (но первый retry в рамках одной
  операции происходит до сохранения sessionId в settings).

  Принимаем (a): `formatZodFeedback(err, fullText)` уже включает raw в
  выход. Для claude-agent assistant-msg в массиве messages дропается,
  но user-msg содержит и feedback, и raw — функциональность сохраняется.

- **JSON example в промптах** работает одинаково (промпт идёт в
  `--append-system-prompt-file` или system content).
- **Telemetry** (RunEvent + counter + status bar) работает идентично — это
  plugin-side, не backend-side.

### Проверка избыточности для claude-agent

Гипотеза пользователя: для claude-agent zod может быть избыточен (Claude Code
сам структурирует JSON качественно). Контр-аргументы:

1. Текущий код уже падает с `parseStructured(...) as Type` без runtime-проверки
   — даже Claude может вернуть JSON с пропущенным `wiki_folder` (наблюдалось
   в `init.ts:143` ручная проверка `if (!entry.id || !entry.wiki_folder)`).
2. zod-валидация per-call дёшева (микросекунды), не влияет на performance.
3. Telemetry даст эмпирические данные: после 1-2 недель — если
   `failed/total` для claude-agent ≈ 0, можно обсудить отключение retry
   через `structuredRetries: 0` в claude-agent ветке `buildOptsFor`.

**Решение**: включаем zod + retry для обоих backends по умолчанию. Если
телеметрия покажет нулевые failures у claude-agent — отключим retry для
него отдельной правкой (тривиально: `structuredRetries: backend === "claude-agent" ? 0 : (settings ?? 1)`).

## Совместимость и миграция

- `nativeAgent.structuredRetries` отсутствует у существующих пользователей →
  default 1 через `?? 1`. Не требует миграции settings.
- `prompts/*.md` — изменение текста промптов меняет fingerprint для
  prompt-caching провайдеров. Один cache-miss на пользователя — приемлемо.
- `src/phases/schemas.ts` сохраняет старые экспорты (`DomainEntryResponse` etc.)
  через re-export — внешние импорты не ломаются.
- `zod` добавляется в `dependencies`. Bundle размер +~12 KB minified+gzipped.

## Риски и решения

| Риск | Митигация |
|---|---|
| zod-error по-русски нечитаем для LLM | `formatZodFeedback` форматирует в плоский английский bullet-list; LLM понимает structured English лучше, чем JSON-pointer |
| Retry replay reasoning chunks в стриме | Уже учтено в `wrapWithJsonFallback` (комментарий llm-utils.ts:127); `parseStructured` глотает `<think>` |
| Бесконечный retry-loop при стабильно битом ответе | Жёсткий cap `maxRetries`, после throw → strict abort |
| Status bar шум при простое | Формат `schema: 0/0` informational, не блокирует view |
| Конфликт со streaming `wrapWithJsonFallback` | parseWithRetry использует тот же `buildChatParams`, fallback применяется на каждом attempt прозрачно |
| Counter утечка listeners при reload плагина | `this.register(() => unsub())` в main.ts |

## Файлы изменения (summary)

Новые:
- `src/phases/zod-schemas.ts`
- `src/phases/parse-with-retry.ts`
- `src/structural-error-counter.ts`
- `tests/phases/zod-schemas.test.ts`
- `tests/phases/parse-with-retry.test.ts`
- `tests/structural-error-counter.test.ts`
- `tests/fixtures/structured/*.json` (8 фикстур)

Изменённые:
- `src/phases/schemas.ts` (re-export)
- `src/phases/init.ts` (3 call-sites)
- `src/phases/lint.ts` (1 call-site)
- `src/phases/query.ts` (1 call-site)
- `src/types.ts` (RunEvent variant + settings field)
- `src/main.ts` (status bar)
- `src/settings.ts` (number input)
- `prompts/init.md`, `prompts/init-incremental.md`,
  `prompts/lint.md`, `prompts/query.md`
- `package.json` (zod dep)
- `tests/agent-runner.integration.test.ts` (новый кейс)
