---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-15-structured-output-resilience.md
  - docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [plan, structured-output, zod, validation, retry, telemetry]
---

# Structured Output Resilience Plan

Реализационный план: замена 5 unsafe `parseStructured(...) as Type` call-sites на zod-валидированный `parseWithRetry()`-оркестратор с автоматическим retry, telemetry-событиями и статус-баром.

## Цель

Все вызовы LLM, ожидающие структурированный JSON, проходят через единый orchestrator: парсинг → `safeParse` против zod-схемы → при провале retry с feedback-сообщением → исчерпание попыток бросает `StructuredValidationError`. Каждая фаза эмитит `structural_error` RunEvent; синглтон-counter обновляет статус-бар.

## Архитектура

```
LLM stream → parseStructured → safeParse(zod) → ok? → return value
                                                  ↓ fail
                              formatZodFeedback → retry message → LLM (n attempts)
                                                  ↓ exhausted
                              throw StructuredValidationError
                                                  ↓
                              call-site emits "error" RunEvent
```

Параллельно `structuralErrorCounter.record(succeeded, attempt)` → `subscribe`-listener в `main.ts` обновляет `addStatusBarItem`.

## Затрагиваемые файлы

| Категория | Файлы |
|---|---|
| **Created** | `src/phases/zod-schemas.ts`, `src/phases/parse-with-retry.ts`, `src/structural-error-counter.ts`, `tests/phases/zod-schemas.test.ts`, `tests/phases/parse-with-retry.test.ts`, `tests/structural-error-counter.test.ts`, `tests/fixtures/structured/` (8 JSON) |
| **Modified** | `src/phases/schemas.ts` (re-export), `src/phases/init.ts` (3 call-sites), `src/phases/lint.ts` (1 + inline prompt example), `src/phases/query.ts` (1 + inline prompt example), `src/types.ts` (`RunEvent.structural_error`, `LlmCallOptions.structuredRetries`, settings), `src/agent-runner.ts` (plumb opts), `src/main.ts` (статус-бар), `src/settings.ts` (UI), `src/i18n.ts`, `prompts/init.md`, `prompts/init-incremental.md`, `package.json` (zod dep) |

## Задачи

| # | Задача | Ключевые артефакты |
|---|---|---|
| 1 | Добавить `zod@^3.23.0` + 3 схемы + 11 тестов | `DomainEntrySchema`, `EntityTypesDeltaSchema`, `SeedsSchema` |
| 2 | Singleton `structuralErrorCounter` + 9 тестов | `record(succeeded, attempt)`, `subscribe(fn)`, `reset()`, `get()` |
| 3 | `types.ts`: новый `RunEvent` variant + `LlmCallOptions.structuredRetries` + `nativeAgent.structuredRetries` (default 1) | — |
| 4 | `parse-with-retry.ts`: orchestrator + `formatZodFeedback` + `StructuredValidationError` + ~20 тестов | `CallSite`, `ParseWithRetryArgs` |
| 5 | `schemas.ts` re-export для back-compat | — |
| 6 | `agent-runner.buildOptsFor` плюс `structuredRetries` в opts | — |
| 7 | `init.ts` bootstrap (no sources) — replace call-site | `runInitBootstrap` block (lines 100-147) |
| 8 | `init.ts` withSources file-0 bootstrap — replace call-site | `runInitWithSources` file-0 (lines 262-307) |
| 9 | `init.ts` withSources file-1+ delta — replace call-site | + prune unused imports |
| 10 | `lint.ts` patch call-site + inline JSON example | `lint.ts:311-327` |
| 11 | `query.ts` seeds call-site + inline JSON example | `llmSelectSeeds` (`query.ts:173-178`) |
| 12 | Append `## Output JSON Example` в `prompts/init.md` и `prompts/init-incremental.md` | — |
| 13 | Settings UI: number input для `structuredRetries` + i18n | — |
| 14 | `main.ts`: `addStatusBarItem` + `subscribe` + `register(unsub)` | — |
| 15 | Integration test failing-JSON case в `agent-runner.integration.test.ts` | — |
| 16 | Full test + build + patch-bump | — |

## CallSite-таблица (4 точки)

| CallSite | Файл | Schema |
|---|---|---|
| `init.bootstrap` | `init.ts` (2 места: no-sources + withSources file 0) | `DomainEntrySchema` |
| `init.delta` | `init.ts` (withSources file 1+) | `EntityTypesDeltaSchema` |
| `lint.patch` | `lint.ts` patch-LLM | `EntityTypesDeltaSchema` |
| `query.seeds` | `query.ts` `llmSelectSeeds` | `SeedsSchema` |

## Spec-отклонения (зафиксированы в плане)

- Спека предписывает JSON-примеры в `prompts/lint.md` / `prompts/query.md`. Реальные call-sites используют **inline** промпты — примеры идут inline, не в `.md`. `prompts/init.md` и `prompts/init-incremental.md` — реальные файлы; примеры туда.
- Спека упоминает `init.ts:126` и `init.ts:291` как два разных call-site. Это `runInitBootstrap`-блок (100-147) и file-0 bootstrap в `runInitWithSources` (262-307); заменяются индивидуально (Tasks 7 + 8).

## Telemetry-формат

```ts
| { kind: "structural_error";
    callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
    errorType: "json_parse" | "schema_validate";
    retryAttempt: number;
    succeeded: boolean | null;
    message: string;
  }
```

`structuralErrorCounter.record(succeeded, retryAttempt)`:
- `succeeded === null` → noop
- `!succeeded` → `failed++`
- `succeeded && retryAttempt > 0` → `retried++`
- `succeeded && retryAttempt === 0` → `ok++`

## Связанные страницы

- [[structured-output-retry]] — паттерн оркестрации
- [[parse-with-retry]] — компонент orchestrator
- [[structural-error-counter]] — singleton-counter
- [[init-operation]], [[lint-operation]], [[query-operation]] — операции с structured output
- [[reasoning-first-json]] — конвенция полей `reasoning` (зависит от JSON-schema)
- [[agent-runner]] — plumbing `structuredRetries`
- [[backend-strategy]] — native vs claude-agent
