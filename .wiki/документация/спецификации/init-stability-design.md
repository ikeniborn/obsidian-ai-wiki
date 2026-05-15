---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-15-init-stability-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [spec, init, native-backend, json-mode, pipeline]
---

# Init Stability Design

Спецификация трёх независимых фиксов надёжности и UX операции [[init-operation]] при работе с native OpenAI-совместимыми backend'ами (Qwen, DeepSeek, Ollama).

## Назначение

Закрыть три класса проблем:

1. **Block 1 — Structured Output Auto-Fallback.** Убрать пользовательскую настройку `nativeAgent.structuredOutput` (`json_schema | json_object | none`); всегда пытаться `json_object` и автоматически деградировать до режима без `response_format` при ошибке backend'а.
2. **Block 2 — Article Subfolder Placement.** Статьи приземляются в подпапки по `entity_type.wiki_subfolder`, а не в корень домена; правка на уровне prompt'а через явные path-шаблоны.
3. **Block 3 — Per-File Sequential Pipeline.** В `runInitWithSources` объединить две фазы (analyze всех файлов → ingest всех файлов) в один цикл `for file: analyze → ingest → file_done`, чтобы статьи появлялись в vault инкрементально.

## Block 1: Structured Output Auto-Fallback

**Проблема.** Три значения `structuredOutput` пользователь выбирает наугад. Открытые модели (Qwen, DeepSeek) отвергают `json_schema` со `strict: true` на уровне API (400/422). `json_object` поддерживается шире, но не универсально.

**Решение.** Native backend всегда отправляет `json_object`; при ошибке вида `isJsonModeError` — retry того же запроса без `response_format`. Парсинг через `parseStructured` (robust mode, без API-гарантий).

**Ключевые контракты.**

- `isJsonModeError(e)` — `true` если HTTP-статус ∈ {400, 422} И сообщение (lowercased) содержит одно из: `response_format`, `json_object`, `json mode`, `unsupported`. Оба условия обязательны — исключает retry на невалидный prompt/auth/quota.
- `wrapWithJsonFallback(llm)` — proxy `LlmClient` с retry-логикой.
  - Non-streaming: try/catch вокруг `create()`; на match — retry без `response_format`.
  - Streaming: ошибка может прийти на `await create()` ИЛИ внутри `for await`. Retry допустим только до первого **text-delta chunk** (`choices[0].delta.content` непустая строка). НЕ считаются content и не блокируют retry: role-only init chunks, пустые/whitespace deltas, любые reasoning-поля (`delta.reasoning`, `delta.reasoning_content`, `delta.thinking` — Qwen/DeepSeek variants).
- `parseStructured` расширен: перед regex-fallback'ом снимает markdown fences (` ```json…``` `, ` ```…``` `). Цепочка: `JSON.parse` → strip `<think>` → strip fences → `\{[\s\S]*\}`.
- `LlmCallOptions.jsonMode` сужен до `"json_object" | false`; вариант `"json_schema"` удалён.
- `buildChatParams` теряет ветку `json_schema`; параметр `responseSchema` остаётся в сигнатуре для backward-compat вызовов.

**Затронутые места.** `src/types.ts`, `src/settings.ts` (удаление UI dropdown и `DEFAULT_SETTINGS.structuredOutput`), `src/agent-runner.ts` (`buildOptsFor` всегда `jsonMode: "json_object"`, обёртка `wrapWithJsonFallback` в конструкторе), `src/phases/llm-utils.ts`, `src/phases/{init,query,lint}.ts` (удаление сравнений `opts.jsonMode === "json_schema"` и неиспользуемых импортов схем `DOMAIN_ENTRY_SCHEMA`/`ENTITY_TYPES_DELTA_SCHEMA`/`SEEDS_SCHEMA`).

**Backend [[claude-cli-client]] не затронут** — для ветки claude-agent `jsonMode` не выставляется, `buildChatParams` не добавляет `response_format`. См. [[backend-strategy]].

**Миграция.** Существующие `data.json` с любым значением `nativeAgent.structuredOutput` загружаются: TypeScript structural typing игнорирует extra props. При первом `saveSettings()` поле естественно исчезает. Активная миграция не нужна.

## Block 2: Article Subfolder Placement

**Проблема.** Prompt инструктирует LLM использовать префикс `wiki_path/`, но не даёт per-entity-type path-шаблонов. LLM кладёт все статьи в корень домена, игнорируя `entity_types[i].wiki_subfolder`.

**Решение.** Prompt-level fix: `buildEntityTypesBlock(domain, wikiVaultPath)` инжектит явные шаблоны путей в системный prompt [[ingest-operation]].

**Контракт.**

- Для типов с `wiki_subfolder`: строка `Путь для сущностей этого типа: <wikiVaultPath>/<wiki_subfolder>/<EntityName>.md`.
- Для типов без `wiki_subfolder`: `Путь для сущностей этого типа: <wikiVaultPath>/<EntityName>.md`.
- `<wikiVaultPath>` и `<wiki_subfolder>` интерполируются кодом; `<EntityName>` — литерал-placeholder для LLM.
- Пустой `entity_types` → блок без path-строк; fallback-правило промпта применяется безусловно.

**Правка промпта.** В `prompts/ingest.md` строка 13 (`- Путь страницы должен начинаться с "{{wiki_path}}/"`) заменена на ссылку «используй точный шаблон из секции ТИПЫ СУЩНОСТЕЙ ДОМЕНА» + fallback `{{wiki_path}}/<EntityName>.md`. Секция `ТИПЫ СУЩНОСТЕЙ ДОМЕНА` уже идёт ДО блока `ПРАВИЛА`.

**Терминология.** `wikiVaultPath` (параметр функции) и `{{wiki_path}}` (placeholder в промпте) — одно и то же: vault-relative путь к wiki-папке домена (например `!Wiki/ии`).

## Block 3: Per-File Sequential Pipeline

**Проблема.** Старый `runInitWithSources` имел две последовательные фазы:

- Phase 1: проанализировать все N файлов → построить `entity_types` (без записи в vault).
- Phase 2: ingest всех N файлов → запись статей.

Статьи появляются в vault только в начале Phase 2; vault пуст всё время выполнения Phase 1.

**Решение.** Один цикл по файлам: для каждого файла `Analyze → Ingest → file_done`. Статьи пишутся сразу после обработки каждого источника.

**Поток.**

```
yield init_start { totalFiles }
currentDomain = existing ?? null
for each file in toAnalyze:
  yield file_start
  read file
  // Step 1: Analyze
  if i === 0 && !isResuming: bootstrap (initTemplate)
  else: incremental delta (initIncrementalTemplate) + merge entity_types
  yield domain_created | domain_updated
  if signal.aborted → return (без обновления analyzed_sources)
  // Step 2: Ingest
  for await ev of runIngest([file], ..., [currentDomain], ...): yield ev
  currentDomain.analyzed_sources = [..., file]
  yield domain_updated (analyzed_sources)
  yield file_done
yield result
```

**Ключевые решения.**

- `runIngest` получает `currentDomain` с `entity_types`, известными на момент обработки этого файла. Список растёт с каждой итерацией. Сигнатура неизменна — массив с единственным элементом `[currentDomain]`.
- **Resume-safety.** `analyzed_sources` обновляется ТОЛЬКО после успешного завершения обоих шагов. При abort в любой момент файл будет пере-обработан полностью. `toAnalyze = sourceFiles.filter(f => !alreadyAnalyzed.has(f))`.
- `init_start` emits один раз; поле `phase` стало optional (backward-compat для старых history-entries) и в новом коде не выставляется.
- `onFileError` callback сохранён для ingest-шага.
- **Finalize.** На успешном завершении `analyzed_sources` не сбрасывается. Следующий init на том же домене: bootstrap пропускается (`isResuming = true`), `toAnalyze` содержит только новые файлы. Если новых нет — `result: "no new sources to process"` без LLM-вызовов.
- **dryRun.** После bootstrap первого файла (Step 1) выводит `DomainEntry` JSON и возвращает. Поведение прежнее.

## Миграция `analyzed_sources_v2`

Старый pipeline добавлял файл в `analyzed_sources` после Phase 1 (analyze), ДО Phase 2 (ingest). Если пользователь прерывал old init между фазами — в `analyzed_sources` оставались файлы без созданных статей. Новый код пропустил бы их полностью → orphan'ы.

**Решение.** Одноразовая миграция при загрузке доменов:

- Добавлено поле `DomainEntry.analyzed_sources_v2?: boolean`.
- Если `analyzed_sources` defined И `analyzed_sources_v2` отсутствует → сброс `analyzed_sources = []`, `analyzed_sources_v2 = true`.
- Новый код всегда выставляет `analyzed_sources_v2: true` при создании/обновлении домена.
- В спеке миграция размещена в `src/settings.ts:loadSettings`; реальный код хранит domains в отдельном store — см. [[init-stability-plan]] (Task 10).

## DoD (Definition of Done)

1. Integration test (mock OpenAI) для стриминг- и non-streaming запроса с 400 на `response_format` → оба fallback'ятся, ответ получен.
2. Unit-test `isJsonModeError`: 400/422 + keyword → true; 401/403/429/500 → false; 400 без keyword → false.
3. Unit-test `parseStructured`: fenced ` ```json `, ` ``` ` без языка, `<think>…</think>{…}` → парсятся.
4. Unit-test `buildEntityTypesBlock`: с `wiki_subfolder` → шаблон содержит подпапку; без `wiki_subfolder` → корень домена; пустой `entity_types` → нет path-строк.
5. Integration tests `runInitWithSources`: per-file write order, resume skip, abort mid-file, repeated init с пустым `toAnalyze`.
6. Manual: статьи появляются в vault инкрементально после каждого `file_done`; статьи лежат в `<wiki_path>/<subfolder>/<Name>.md`; на старой модели без `json_object` срабатывает retry.

## Out of Scope

- `json_schema` removal для claude-agent backend (не использует OpenAI API напрямую — см. [[claude-cli-client]]).
- Standalone [[ingest-operation]] вне init context (уже пишет per-file).
- [[query-operation]], format, evaluator — не парсят structured JSON в этом стиле.

## Связанные страницы

- [[init-stability-plan]] — реализационный план этой спеки
- [[init-operation]] — целевая операция
- [[ingest-operation]] — внутри per-file loop
- [[agent-runner]] — обёртка `wrapWithJsonFallback` и `buildOptsFor`
- [[backend-strategy]] — разделение native / claude-agent
- [[claude-cli-client]] — backend, не затронутый Block 1
- [[reasoning-first-json]] — конвенция полей `reasoning`/`reasoning_content`, релевантна для streaming retry-логики
