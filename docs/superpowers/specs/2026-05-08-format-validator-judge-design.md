# Format Validator: LLM-as-Judge Design

**Дата:** 2026-05-08
**Статус:** Design (pending implementation plan)

## Контекст и проблема

Текущий валидатор форматирования (`src/phases/format-utils.ts`) построен на токен-сверке: `significantTokens` извлекает числа, URL, Latin-имена, идентификаторы из inline/fenced code. `missingTokensWithContext` сравнивает множества токенов оригинала и formatted, возвращает потерянные. UI показывает их в `format_preview`.

Серия recent-коммитов посвящена устранению false-positives (camelCase suffix, plural/singular, inner code-fence, числа из URL). Token-чекер достиг разумной precision на лексическом уровне.

**Главная нерешённая боль:** валидатор не ловит **семантические** потери — удалённые факты, искажённый смысл абзацев, выкинутые важные блоки, при которых все токены формально сохранены, но смысл искажён или утрачен. Также не ловит структурные потери: пропавшие списки/таблицы/code-блоки/ссылки.

## Цель

Добавить дополнительный validator-слой — **LLM-as-Judge**: отдельный LLM-вызов после основной операции, сравнивающий original vs output на семантическую сохранность. Возвращает structured-verdict (verdict + score + список утраченных claim-ов с severity).

Judge **не заменяет** существующий token-checker, а дополняет его. Если judge отключён — старый функционал работает без изменений.

## Решения

| Вопрос | Решение |
|---|---|
| Approach | LLM-as-Judge (отдельный LLM-вызов) |
| Scope операций | `format` + `ingest` |
| Settings location | Новая секция `settings.judge` (рядом с `devMode`) |
| Per-backend | Да — отдельные настройки для `claude-agent` и `native-agent` |
| Master toggle | `settings.judge.enabled` — глобальный switch |
| Per-backend toggle | `judge.<backend>.enabled` — backend может быть выключен независимо |
| Per-operation models | `judge.<backend>.perOperation` + `operations: { format, ingest }` |
| Judge prompt | Отдельный файл `prompts/judge.md` |
| Trigger | Always-on если включён (не on-demand) |
| Judge output | `{ verdict, score, lostClaims[], structuralLosses[] }` |
| UI | Отдельный блок "Judge report" в `LlmWikiView` после результата |
| Fail behavior | Только warning. Apply не блокируется |
| Coexistence | Если judge выключен для format — старый token-checker остаётся |

## Архитектура

### Поток выполнения (format)

```
WikiController.run("format")
  → AgentRunner.run()
  → runFormat()
      ├── вызов LLM (formatter)
      ├── extractJsonObject → parsed.formatted
      ├── vaultTools.write(tempPath, parsed.formatted)
      ├── missingTokensWithContext(original, formatted)        ← старый token-checker (всегда)
      └── yield format_preview { tempPath, report, missingTokens }
  → AgentRunner: if judge.enabled && backend.judge.enabled
      → runJudge("format", original, parsed.formatted, judgeLlm, judgeModel)
          ├── вызов judge-LLM
          ├── extractJsonObject (reuse) → JudgeResult
          └── yield judge_report { operation, verdict, score, lostClaims, structuralLosses }
```

### Поток выполнения (ingest)

```
runIngest → ... → result event
  → AgentRunner: if judge enabled
      → runJudge("ingest", sourceText, ingestedText, judgeLlm, judgeModel)
          → yield judge_report
```

### Изоляция

- `runJudge` — самостоятельная фаза, не знает о formatter/ingest деталях
- Получает на вход: `(operation, original: string, output: string, llm, model, signal, opts?)`
- Возвращает AsyncGenerator<RunEvent>
- Ошибки judge **не валят** основную операцию — `AgentRunner` ловит и yield-ит warning через обычный `error` event с пометкой "[judge]"
- Apply/cancel флоу формата не зависит от judge — Apply работает независимо от verdict

## Компоненты

### 1. Types (`src/types.ts`)

```ts
export type JudgeOpKey = "format" | "ingest";

export interface JudgeOperationConfig {
  model: string;
}

export interface JudgeBackendConfig {
  enabled: boolean;
  model: string;                                // global judge model для backend
  perOperation: boolean;
  operations: Record<JudgeOpKey, JudgeOperationConfig>;
}

export interface JudgeConfig {
  enabled: boolean;                             // master switch
  claudeAgent: JudgeBackendConfig;
  nativeAgent: JudgeBackendConfig;
}

// LlmWikiPluginSettings += judge: JudgeConfig

export type JudgeSeverity = "critical" | "major" | "minor";
export type JudgeVerdict = "pass" | "warn" | "fail";

export interface JudgeLostClaim {
  quote: string;
  severity: JudgeSeverity;
  reason: string;
}

// RunEvent +=
| {
    kind: "judge_report";
    operation: JudgeOpKey;
    verdict: JudgeVerdict;
    score: number;                              // 0-100
    lostClaims: JudgeLostClaim[];
    structuralLosses: string[];
  }
```

### 2. Settings defaults (`src/settings.ts` / `DEFAULT_SETTINGS`)

```ts
judge: {
  enabled: false,
  claudeAgent: {
    enabled: true,
    model: "haiku",
    perOperation: false,
    operations: {
      format: { model: "haiku" },
      ingest: { model: "haiku" },
    },
  },
  nativeAgent: {
    enabled: true,
    model: "llama3.2",
    perOperation: false,
    operations: {
      format: { model: "llama3.2" },
      ingest: { model: "llama3.2" },
    },
  },
}
```

Settings UI (новая секция в SettingsTab):
- Master toggle "Enable LLM Judge validator"
- Collapsable секция per-backend: enabled toggle, default model input, perOperation toggle, per-op model inputs (если perOperation)

### 3. Judge phase (`src/phases/judge.ts`)

```ts
export async function* runJudge(
  operation: JudgeOpKey,
  original: string,
  output: string,
  llm: LlmClient,
  model: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
): AsyncGenerator<RunEvent> {
  // 1. Build messages: system = judgeTemplate, user = `OPERATION: ${op}\n---ORIGINAL---\n${original}\n---OUTPUT---\n${output}`
  // 2. Stream LLM call с response_format: json_object
  // 3. extractJsonObject → JudgeResult (новая схема — переиспользует core JSON extraction)
  // 4. Validate schema (verdict in pass|warn|fail, score 0-100, lostClaims array)
  // 5. yield { kind: "judge_report", operation, ...result }
  // Errors: yield { kind: "error", message: "[judge] ..." } — основная операция уже завершилась успешно
}
```

Reuse: `extractJsonObject` из `format-utils` уже экспортирована — годится.

### 4. Judge prompt (`prompts/judge.md`)

Отдельный системный промпт. Структура:
- Роль: validator семантической сохранности
- Вход: original + output + operation type
- Задача: найти утраченные факты, искажения смысла, удалённые важные блоки
- Игнорировать: legitimate перефраз, удаление дубликатов/мусора, форматирование
- Severity:
  - `critical`: фактическая ошибка или удалённый ключевой блок
  - `major`: значимая деталь утрачена
  - `minor`: второстепенная деталь
- Verdict mapping (рекомендация модели, не строгая логика):
  - `fail`: ≥1 critical
  - `warn`: ≥1 major или ≥3 minor
  - `pass`: иначе
- Score: целое 0-100, корреляция с verdict
- Output: строго JSON `{verdict, score, lostClaims, structuralLosses}` без markdown-обёртки

### 5. Integration (`src/agent-runner.ts`)

После успешного завершения `runFormat` или `runIngest`:

```ts
async function maybeRunJudge(
  operation: JudgeOpKey,
  original: string,
  output: string,
  settings: LlmWikiPluginSettings,
  backend: "claude-agent" | "native-agent",
  llmFactory: ...,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  if (!settings.judge.enabled) return;
  const cfg = backend === "claude-agent" ? settings.judge.claudeAgent : settings.judge.nativeAgent;
  if (!cfg.enabled) return;
  const model = cfg.perOperation ? cfg.operations[operation].model : cfg.model;
  const judgeLlm = buildLlmClient(backend, model, ...);  // переиспользует ту же фабрику
  yield* runJudge(operation, original, output, judgeLlm, model, signal);
}
```

`AgentRunner` после `runFormat`/`runIngest` собирает `original` и `output`, вызывает `maybeRunJudge`:
- **format:** `original` = содержимое исходного файла (читаем единожды до фазы или передаём из runFormat через context-объект); `output` = `parsed.formatted`
- **ingest:** `original` = конкатенация source-файлов, переданных в ingest (тех же, что попали в LLM-промпт); `output` = итоговый wiki-текст, который ingest записал в vault. Если ingest пишет несколько файлов — judge вызывается один раз с конкатенированным output (разделители `\n\n---\n\n`). Судж-события форвардятся в общий поток.

### 6. UI (`src/view.ts`)

`LlmWikiView` обрабатывает новый `judge_report` event:
- Создаёт отдельный блок "Judge report" под основным результатом
- Header: цветной badge со score + verdict
  - `pass` → зелёный
  - `warn` → жёлтый
  - `fail` → красный
- `lostClaims` — список, сгруппирован по severity (critical → major → minor):
  - Каждый item: severity-badge + truncated quote (120ch) + reason
- `structuralLosses` — отдельный bullet-list
- Блок collapsable; default expanded если verdict ≠ pass

История (`history`): новые поля JudgeReport не сохраняются в первой итерации (out of scope).

## Data flow

```
format-фаза → format_preview event ─┐
                                    ├─→ view рендерит preview (как сейчас)
runJudge → judge_report event ──────┘─→ view рендерит judge-блок отдельно
```

Apply-флоу формата (`format_applied`/`format_cancelled`) не зависит от judge.

## Error handling

| Сценарий | Поведение |
|---|---|
| Judge JSON invalid | `error` event "[judge] невалидный JSON" → основная операция уже завершилась успешно |
| Judge timeout | То же — warning, не валит format/ingest |
| Judge abort (signal) | Тихо завершается |
| Judge LLM ошибка сети | Warning, основная операция не страдает |
| `judge.enabled === false` | judge не вызывается, поведение как до фичи |
| `backend.enabled === false` | judge не вызывается для этого backend |

## Testing

| Файл | Что проверяется |
|---|---|
| `tests/phases/judge.test.ts` | runJudge: парсинг judge-output, schema-валидация, severity ordering, JSON-recovery, abort |
| `tests/phases/judge-prompt.test.ts` | Снапшот рендера judgeTemplate с разными operation |
| `tests/agent-runner.integration.test.ts` | judge.enabled=false → не вызывается; enabled=true + backend.enabled=true → вызывается; backend.enabled=false → пропуск; ошибка judge не валит основную операцию |
| `tests/settings.test.ts` | Default judge config, миграция старых settings (отсутствующая секция → default) |

Mock-judge через mock LlmClient как в `claude-cli-client.test.ts`.

## Files to touch

| File | Change |
|---|---|
| `src/types.ts` | +JudgeConfig, JudgeBackendConfig, JudgeOperationConfig, JudgeOpKey, JudgeSeverity, JudgeVerdict, JudgeLostClaim; +`judge_report` RunEvent |
| `src/settings.ts` | +DEFAULT_SETTINGS.judge; миграция старых settings (judge:undefined → defaults); +UI секция в SettingsTab |
| `src/phases/judge.ts` | Новый — runJudge generator |
| `prompts/judge.md` | Новый — judge system prompt |
| `src/agent-runner.ts` | maybeRunJudge helper; вызов после format/ingest |
| `src/view.ts` | Render judge_report block |
| `tests/phases/judge.test.ts` | Новый — unit-тесты runJudge |
| `tests/phases/judge-prompt.test.ts` | Новый — снапшот промпта |
| `tests/agent-runner.integration.test.ts` | +scenarios judge enabled/disabled, ошибка judge |
| `tests/settings.test.ts` | +миграция, defaults |

## Out of scope

- Сохранение JudgeReport в `history` (отдельный спец)
- Judge для query/chat/lint/fix/init
- Auto-retry формата на основе judge-verdict (только warning)
- Блокировка Apply на verdict=fail (только warning)
- LLM cost tracking для judge-вызовов (общий механизм через RunEvent.usdCost остаётся)
- Suggested fix (`fragmentToInsert`) — не возвращается judge-ом в первой итерации
