---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-15-init-stability-design.md
  - docs/superpowers/specs/2026-05-15-init-stability-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [plan, init, native-backend, json-mode, pipeline, migration]
---

# Init Stability Plan

Реализационный план [[init-stability-design]]: три независимых фикса операции [[init-operation]] для native OpenAI-совместимого backend — авто-fallback structured output, размещение статей по подпапкам entity_type, per-file sequential pipeline.

## Цель

| Block | Суть |
|---|---|
| 1 | Обёртка `wrapWithJsonFallback` над `LlmClient`; всегда `json_object`-режим; при ошибке backend → retry без `response_format` |
| 2 | `buildEntityTypesBlock` инжектит явные path-шаблоны из `entity_types[i].wiki_subfolder` |
| 3 | `runInitWithSources` переписан как один цикл `for file in toAnalyze: analyze → ingest → file_done`; миграция `analyzed_sources_v2` сбрасывает прогресс старого 2-фазного pipeline |

## Затрагиваемые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | сужение `LlmCallOptions.jsonMode` до `"json_object" \| false`; удаление `nativeAgent.structuredOutput`; `init_start.phase` → optional |
| `src/phases/llm-utils.ts` | `parseStructured` со stripping markdown fences; `wrapWithJsonFallback` + `isJsonModeError`; `buildChatParams` без ветки `json_schema` |
| `src/agent-runner.ts` | всегда `jsonMode: "json_object"` для native; оборачивание `this.llm` через `wrapWithJsonFallback` в конструкторе |
| `src/settings.ts` | удалить UI dropdown `structuredOutput` |
| `src/main.ts` | в `loadSettings` точка миграции `analyzed_sources` без `_v2` → `[]` |
| `src/domain.ts` | поле `analyzed_sources_v2?: boolean` в `DomainEntry`; чистая функция `migrateDomainsV2` |
| `src/phases/init.ts` | rewrite `runInitWithSources` (per-file loop); выставлять `analyzed_sources_v2: true`; удалить ветки `json_schema`; убрать неиспользуемые импорты схем |
| `src/phases/query.ts` | удалить ветку `opts.jsonMode === "json_schema"` (~строка 183); убрать импорт `SEEDS_SCHEMA` |
| `src/phases/lint.ts` | удалить ветку `opts.jsonMode === "json_schema"` (~строка 345); убрать импорт `ENTITY_TYPES_DELTA_SCHEMA` |
| `src/phases/ingest.ts` | `buildEntityTypesBlock(domain, wikiVaultPath)` с path-шаблонами |
| `prompts/ingest.md` | замена строки 13 на правило c шаблоном из секции «ТИПЫ СУЩНОСТЕЙ ДОМЕНА» |
| `tests/llm-utils.test.ts` | удалить тест `json_schema`-варианта; тесты `parseStructured` fences, `isJsonModeError`, `wrapWithJsonFallback` |
| `tests/phases/init.test.ts` | integration-тесты per-file pipeline, resume, abort, repeated init |
| `tests/phases/ingest.test.ts` | тесты `buildEntityTypesBlock` |

## Задачи

### Task 1: Сузить `LlmCallOptions.jsonMode`

`src/types.ts:78` — заменить тип на `"json_object" | false`. Сравнения с `"json_schema"` в фазах становятся unreachable; правки в Task 2 и Task 5. Коммит откладывается на Task 5 (зелёный tsc).

### Task 2: `buildChatParams` без `json_schema`

`src/phases/llm-utils.ts:67-74` — удалить ветку `json_schema` (через `responseSchema`); оставить только `json_object`. Параметр `responseSchema` сохранён для backward-compat вызовов. Удалить failing-тест `json_schema` (`tests/llm-utils.test.ts:118-123`).

### Task 3: `parseStructured` — markdown fences

`src/phases/llm-utils.ts:21-28` — расширить цепочку: `JSON.parse` → strip `<think>` → `stripFences` → regex `\{[\s\S]*\}`. Регулярка fences: `/```(?:json)?\s*\n?([\s\S]*?)\n?```/i`.

**Failing-тесты:** fenced ` ```json `, fenced ` ``` ` без языка, `<think>…</think>` + fenced JSON.

### Task 4: `wrapWithJsonFallback` + `isJsonModeError`

`src/phases/llm-utils.ts` (новые exports).

- `JSON_MODE_KEYWORDS = ["response_format", "json_object", "json mode", "unsupported"]`.
- `isJsonModeError`: status ∈ {400, 422} И keyword in lowercased message.
- `wrapWithJsonFallback`: proxy `LlmClient`.
  - Non-streaming: try `create()` → on `isJsonModeError` retry без `response_format`.
  - Streaming: catch на `await create()` + catch внутри generator; `hasContentDelta(chunk) = typeof chunk.choices[0].delta.content === "string" && length > 0`; после первого content — rethrow, до — retry.
  - `stripResponseFormat(params)` — копия без `response_format`.
- Тесты non-stream: retry, no-retry на 429, pass-through без `response_format`.
- Тесты stream: retry на reject create(), retry до первого content, no retry после content, reasoning-only chunks → retry разрешён.

### Task 5: Удалить ветки `json_schema` в init/query/lint

- `init.ts:99` (`schema`), `:267` (`bootstrapSchema`), `:356` (`deltaSchema`) → удалить, заменить аргумент `buildChatParams` на `undefined`. Импорт `DOMAIN_ENTRY_SCHEMA`, `ENTITY_TYPES_DELTA_SCHEMA` убрать.
- `query.ts:183` — то же для `SEEDS_SCHEMA`.
- `lint.ts:345` — то же для `ENTITY_TYPES_DELTA_SCHEMA`.

`npx tsc --noEmit` должен стать чистым.

### Task 6: `agent-runner.ts` — обёртка + всегда `json_object`

- Импортировать `wrapWithJsonFallback`.
- Поле `private llm: LlmClient` объявить отдельно; в конструкторе `this.llm = wrapWithJsonFallback(llm)`.
- В `buildOptsFor` native — убрать ветвление `na.structuredOutput`; всегда `jsonMode: "json_object"` и для `na.operations[key]`, и для default-ветки.

### Task 7: Удалить `structuredOutput` из settings

- `src/types.ts:139` — поле в `nativeAgent`.
- `src/types.ts:178` — значение в `DEFAULT_SETTINGS`.
- `src/settings.ts:297-309` — UI dropdown.

Активная миграция `data.json` не нужна (structural typing).

### Task 8: `prompts/ingest.md` — explicit path rule

Строка 13: заменить `- Путь страницы должен начинаться с "{{wiki_path}}/"` на:

```
- Путь статьи определяется типом сущности — используй точный шаблон из секции «ТИПЫ СУЩНОСТЕЙ ДОМЕНА» (выше, до блока ПРАВИЛА), подставив имя сущности вместо <EntityName>
- Если тип сущности не определён или у домена нет entity_types → путь по умолчанию: {{wiki_path}}/<EntityName>.md
```

### Task 9: `buildEntityTypesBlock(domain, wikiVaultPath)`

`src/phases/ingest.ts:242-251` — экспортировать, расширить сигнатуру.

```typescript
const pathTemplate = et.wiki_subfolder
  ? `${wikiVaultPath}/${et.wiki_subfolder}/<EntityName>.md`
  : `${wikiVaultPath}/<EntityName>.md`;
// в массив строк блока: `Путь для сущностей этого типа: ${pathTemplate}`
```

Call site (`src/phases/ingest.ts:267`): `buildEntityTypesBlock(domain, wikiVaultPath)` (`wikiVaultPath` уже в области видимости `buildIngestMessages`).

**Тесты:** с подпапкой, без подпапки (без двойного слэша), пустой `entity_types` — нет path-строк.

### Task 10: `analyzed_sources_v2` + миграция

- `src/domain.ts:12-20` — поле `analyzed_sources_v2?: boolean` в `DomainEntry`.
- Чистая функция `migrateDomainsV2(domains): { domains, migrated }` в `src/domain.ts`:

  ```typescript
  for (const d of domains) {
    if (d.analyzed_sources !== undefined && !d.analyzed_sources_v2) {
      d.analyzed_sources = [];
      d.analyzed_sources_v2 = true;
      migrated = true;
    }
  }
  ```

- Вызов внутри `DomainStore.load()` (не в `loadSettings`, как в спеке — domains хранятся в отдельном store).
- Тесты: domain без `_v2` → reset; с `_v2` → нетронут; без `analyzed_sources` → нетронут.

**Отклонение от спеки:** спека указывает миграцию в `src/settings.ts:loadSettings`; план переносит в `DomainStore.load()` через `migrateDomainsV2` — обосновано в Self-Review.

### Task 11: `runInitWithSources` — per-file loop

`src/phases/init.ts:179-475` — переписать целиком.

**Логика resume / новых файлов:**

```
isResuming = existing?.analyzed_sources !== undefined
alreadyAnalyzed = new Set(existing?.analyzed_sources ?? [])
toAnalyze = isResuming
  ? sourceFiles.filter(f => !alreadyAnalyzed.has(f))
  : sourceFiles
if (toAnalyze.length === 0) → yield result "no new sources" → return
```

**Loop:**

```
for i = 0..toAnalyze.length:
  if signal.aborted → return
  yield file_start
  read file (на ошибке — file_done и continue)
  if i === 0 && !isResuming:
    bootstrap (initTemplate) → currentDomain = {... analyzed_sources: [], analyzed_sources_v2: true}
    yield tool_use + domain_created|domain_updated + tool_result
  else:
    incremental delta → merge entity_types → analyzed_sources_v2: true
    yield tool_use + domain_updated + tool_result
  if signal.aborted → return
  // dryRun: после bootstrap отдать DomainEntry и вернуться
  // Step 2: Ingest с retry-loop на onFileError (canRetry = !retried)
  for await ev of runIngest([file], ..., [currentDomain], ...): yield ev
  if signal.aborted → return
  // только теперь:
  currentDomain.analyzed_sources = [..., file]
  yield tool_use + domain_updated (analyzed_sources) + tool_result
  yield file_done
yield result
```

Обработка stream-ответа LLM (extractStreamDeltas), fallback non-streaming на error, `parseStructured` → `DomainEntry` либо `EntityTypesDeltaResponse`, нормализация `wiki_folder` (срезать `vaults/<vaultName>/`, `!Wiki/`).

**Тесты:**

1. **Per-file write order** — vault содержит статьи file[0] до того как LLM вызван для file[1].
2. **Resume skip** — domain c `analyzed_sources: ["a"]` + `_v2: true` → mock-LLM не вызван для "a".
3. **Abort mid-file** — abort после `domain_updated` Step 1 file[1], до runIngest → `analyzed_sources` содержит file[0], НЕ file[1].
4. **Repeated init** — `analyzed_sources` совпадает с `sourceFiles` → call count 0, result "no new sources".

Существующие init-тесты с проверкой `phase: "analysis"` / `phase: "ingest"` — удалить эти assertions.

### Task 12: Финал — full test + manual smoke

- `npm test` → all PASS.
- `npm run build` → `dist/main.js`.
- Manual в Obsidian (Ollama/Qwen): инкрементальная запись, подпапки, abort/resume, repeated init без LLM, fallback на старой модели.

## Self-Review

**Покрытие спеки:**

| Block | Покрыт задачами |
|---|---|
| 1 (auto-fallback) | Tasks 2, 3, 4, 6, 7 |
| 2 (subfolder placement) | Tasks 8, 9 |
| 3 (per-file pipeline) | Tasks 10, 11 + manual в Task 12 |

**Известные расхождения spec ↔ план:**

- Спека предписывает миграцию в `src/settings.ts:loadSettings`. План переносит в `DomainStore.load()` через `migrateDomainsV2` (domains хранятся отдельно от settings). Findings F-003.

**Открытые findings из review (verifiability/consistency):**

- F-001: failing-тесты per-file pipeline даны псевдокодом без конкретных assertion expressions — нужна точная mock-инфраструктура до запуска.
- F-002: критерий «либо PASS, либо требуют обновления» для существующих init-тестов нечёткий; команда `vitest ... | head -100` ad-hoc.
- F-003: миграция перенесена в `DomainStore.load()` — обосновано.

## Связанные страницы

- [[init-stability-design]] — спецификация
- [[init-operation]] — целевая операция
- [[ingest-operation]] — внутренний шаг per-file loop
- [[agent-runner]] — обёртка `wrapWithJsonFallback`
- [[backend-strategy]] — native / claude-agent разделение
- [[reasoning-first-json]] — конвенция полей reasoning (важна для streaming retry)
