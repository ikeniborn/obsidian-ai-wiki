---
wiki_status: developing
wiki_sources:
  - docs/superpowers/plans/2026-05-15-structured-output-resilience.md
  - docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md
  - prompts/init.md
  - prompts/init-incremental.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [паттерн, zod, validation, retry, llm, structured-output]
---

# Structured Output Retry

Паттерн обеспечения резильентности структурированных LLM-ответов: каждый вызов, требующий JSON по контракту, валидируется zod-схемой; на провале — retry с feedback; на исчерпании — typed error и telemetry.

## Контекст

Native OpenAI-совместимые backend'ы (Ollama, vLLM) даже в `json_object`-режиме иногда возвращают:
- markdown fences вокруг JSON,
- лишние поля или пропущенные обязательные,
- неверные типы (`"not-an-array"` вместо массива),
- `<think>…</think>`-блоки перед телом.

`parseStructured(...) as Type` молча приводит результат к типу — runtime-баги обнаруживаются позже в коде потребителя.

## Решение

Единый orchestrator [[parse-with-retry]]:

1. **Schema-first.** Все ожидаемые формы — zod-схемы (`src/phases/zod-schemas.ts`): `DomainEntrySchema`, `EntityTypesDeltaSchema`, `SeedsSchema`.
2. **safeParse, не cast.** Возвращаемый JSON прогоняется через `safeParse`; на провал возвращается ошибка с `zod.ZodIssue[]`.
3. **Retry с feedback.** `formatZodFeedback` превращает ошибки в human-readable сообщение, добавляется как `role: "user"`-сообщение в следующую попытку.
4. **Strict policy.** Исчерпание `structuredRetries` (default 1) → `throw StructuredValidationError` → call-site эмитит `error` RunEvent (операция падает, не «продолжаем с broken value»).
5. **Telemetry.** Каждая попытка эмитит `RunEvent.structural_error`; [[structural-error-counter]] агрегирует исходы для статус-бара.

## CallSites

| CallSite | Schema | Контракт |
|---|---|---|
| `init.bootstrap` | `DomainEntrySchema` | Создание домена из пустого корпуса/первого файла |
| `init.delta` | `EntityTypesDeltaSchema` | Инкрементальное обновление `entity_types` по новому файлу |
| `lint.patch` | `EntityTypesDeltaSchema` | Lint-патч `entity_types` |
| `query.seeds` | `SeedsSchema` | Выбор seed-страниц для query |

## Конфигурация

`nativeAgent.structuredRetries: number` (default `1`) в `LlmWikiPluginSettings`. Прокидывается через `agent-runner.buildOptsFor` → `LlmCallOptions.structuredRetries` → `parseWithRetry`.

## Зависимости

- [[reasoning-first-json]] — каждая схема обязывает поле `reasoning` первым (CoT-улучшение качества).
- `zod@^3.23.0` — runtime-валидатор, бандлится esbuild'ом в `main.js`.
- [[parse-with-retry]] — реализация.
- [[structural-error-counter]] — telemetry-приёмник.

## Примеры в промптах

`## Output JSON Example`-блоки в конце `prompts/init.md` и `prompts/init-incremental.md` дают LLM эталон формы — снижает частоту retry. Для `lint`/`query` примеры **inline** в коде (`lint.ts:311-327`, `query.ts:173-178`), не в `.md`-файлах.

## Связанные страницы

- [[parse-with-retry]] — orchestrator
- [[structural-error-counter]] — telemetry
- [[structured-output-resilience-plan]] — implementation plan
- [[reasoning-first-json]] — обязательное поле `reasoning`
- [[backend-strategy]] — native backend требует этот паттерн (claude-agent — нет)
