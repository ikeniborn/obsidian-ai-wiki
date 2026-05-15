---
wiki_status: developing
wiki_sources:
  - docs/superpowers/plans/2026-05-15-structured-output-resilience.md
  - docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [компонент, validation, retry, zod, structured-output]
---

# parseWithRetry

Orchestrator-функция (`src/phases/parse-with-retry.ts`) для безопасного получения структурированного LLM-ответа: streaming LLM call → `parseStructured` → zod `safeParse` → retry на failure → throw на исчерпании.

## Назначение

Заменяет unsafe-паттерн `parseStructured(...) as Type` в 4 call-sites (`init.bootstrap`, `init.delta`, `lint.patch`, `query.seeds`). Все обращения к LLM, ожидающие JSON-структуру, проходят через `parseWithRetry`.

## Сигнатура

```ts
async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<T>

interface ParseWithRetryArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  schema: ZodSchema<T>;
  callSite: CallSite;
  maxRetries: number;
  signal: AbortSignal;
  onEvent: (e: RunEvent) => void;
}

type CallSite = "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
```

## Поток выполнения

```
attempt = 0
loop:
  messages = baseMessages + accumulated feedback
  text = await stream LLM(messages)
  parsed = parseStructured(text)                       // throws on JSON.parse fail
  result = schema.safeParse(parsed)
  if result.success:
    counter.record(true, attempt) → emit structural_error{succeeded:true}
    return result.data
  else:
    emit structural_error{succeeded:null, retryAttempt:attempt, errorType:"schema_validate"}
    if attempt >= maxRetries:
      counter.record(false, attempt) → emit structural_error{succeeded:false}
      throw new StructuredValidationError(...)
    feedback = formatZodFeedback(result.error)
    baseMessages.push({role:"user", content: feedback})
    attempt++
```

JSON-parse-ошибки обрабатываются аналогично с `errorType: "json_parse"`.

## Связанные экспорты

- `formatZodFeedback(error: ZodError): string` — формирует читаемое сообщение «такие-то поля не прошли валидацию, исправь и верни JSON».
- `StructuredValidationError extends Error` — бросается при исчерпании retry. Содержит `callSite`, `attempts`, `lastErrors`.

## Telemetry

Каждая попытка эмитит `RunEvent.structural_error` через `onEvent`. Глобальный счётчик `structuralErrorCounter.record(succeeded, retryAttempt)` обновляется один раз на финальном исходе (success / final failure).

## Связанные страницы

- [[structured-output-retry]] — паттерн
- [[structural-error-counter]] — telemetry-singleton
- [[structured-output-resilience-plan]] — implementation plan
- [[reasoning-first-json]] — конвенция, обязывающая поле `reasoning` в схеме
- [[init-operation]], [[lint-operation]], [[query-operation]] — call-sites
