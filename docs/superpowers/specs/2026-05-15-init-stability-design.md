# Init Stability Design

Date: 2026-05-15

## Overview

Three independent fixes addressing reliability and UX of the `init` operation with native OpenAI-compatible backends (Qwen, DeepSeek, Ollama, etc.):

1. **Structured output auto-fallback** — remove user-facing mode setting; auto-degrade `json_object → none` on unsupported models.
2. **Article subfolder placement** — articles land in entity-type subfolders, not domain root.
3. **Per-file sequential pipeline** — articles written to vault immediately after each source file is processed, not at end of all init.

---

## Block 1: Structured Output Auto-Fallback

### Problem

`structuredOutput` setting has three values (`json_schema / json_object / none`). Users cannot determine which to use for a given model. Open models (Qwen, DeepSeek) often reject `json_schema` with `strict: true` at API level (400/422). `json_object` is broadly supported but not universal.

### Solution

Remove `structuredOutput` from `LlmWikiPluginSettings.nativeAgent` and from settings UI entirely. Replace with automatic behavior:

- Native backend always attempts `json_object` mode first.
- If API returns error indicating unsupported `response_format` → retry same request without `response_format`.
- All parsing uses `parseStructured` (robust mode, no API-level guarantee).

### Implementation

**`src/phases/llm-utils.ts`** — extend `parseStructured`:
- Strip markdown fences (` ```json…``` `, ` ```…``` `) before regex search.
- Current chain: `JSON.parse` → strip `<think>` → `\{[\s\S]*\}`. New chain prepends fence stripping.

**`src/phases/llm-utils.ts`** — add `wrapWithJsonFallback(llm: LlmClient): LlmClient`:
- Returns proxy `LlmClient` wrapping `chat.completions.create`.
- On call: if params include `response_format` → try; on error matching `isJsonModeError(e)` → retry without `response_format`.
- `isJsonModeError`: HTTP status ∈ {400, 422} **AND** error message (lowercased) contains one of: `response_format`, `json_object`, `json mode`, `unsupported`. Both conditions required — исключает retry на невалидный prompt/auth/quota 400.
- Non-streaming: error thrown at `create()` await — wrap in try/catch, retry.
- Streaming: error may surface either at `create()` await OR at first `for await` chunk. Wrap both: catch at `create()`, then if iteration throws before first **text-delta chunk** (`choices[0].delta.content` non-empty string) → retry without `response_format`. НЕ считаются content и не блокируют retry: role-only init chunks (`delta.role` без `content`), пустые/whitespace deltas, любые reasoning-поля (`delta.reasoning`, `delta.reasoning_content`, `delta.thinking` — все варианты, используемые Qwen/DeepSeek/прочими). После первой непустой `delta.content` — transport error, без retry.
- DoD:
  1. Integration test (mock OpenAI server) против стриминг- и non-streaming запроса, возвращающего 400 на `response_format` → оба fallback'ятся, ответ получен.
  2. Unit-test `isJsonModeError`: статусы 400/422 + ключевые слова → true; 401/403/429/500 → false; 400 без ключевых слов → false.
  3. Unit-test `parseStructured`: вход с ` ```json … ``` ` → парсится; ` ``` … ``` ` без языка → парсится; `<think>…</think>{…}` → парсится.

**`src/agent-runner.ts`** — `buildOptsFor`:
- Remove `na.structuredOutput` logic.
- Always pass `jsonMode: "json_object"` in opts for native backend.
- Wrap `this.llm` with `wrapWithJsonFallback` before passing to phases.

**`src/types.ts`**:
- `LlmCallOptions.jsonMode`: remove `"json_schema"` variant → `"json_object" | false`. `false` (или omit) = backend без structured-режима (claude-agent через iclaude.sh, mock-адаптеры в тестах). `"json_object"` = native OpenAI-совместимый backend.
- `LlmWikiPluginSettings.nativeAgent`: remove `structuredOutput` field.

**`src/settings.ts`**:
- Remove `structuredOutput` dropdown from settings UI.
- Remove from `DEFAULT_SETTINGS`.

**`src/phases/init.ts` / `src/phases/query.ts` / `src/phases/lint.ts`**:
- Remove all `opts.jsonMode === "json_schema"` comparisons (now unreachable per new `LlmCallOptions.jsonMode` type) — затрагивает `init.ts:98,260,345`, `query.ts:183`, `lint.ts:345`.
- Remove `bootstrapSchema`, `deltaSchema`, `schema` locals entirely; drop schema arg from `buildChatParams` calls в этих файлах.
- Drop unused imports `DOMAIN_ENTRY_SCHEMA`, `ENTITY_TYPES_DELTA_SCHEMA`, `SEEDS_SCHEMA` после удаления их call-sites.

**`src/phases/llm-utils.ts` / `buildChatParams`**:
- Remove `json_schema` branch entirely (строки 67-71).
- Keep only `json_object` branch.

**`tests/llm-utils.test.ts`**:
- Remove или переписать тест `"sets response_format json_schema when jsonMode=json_schema and schema provided"` (строки 118-122) — variant `json_schema` удалён из типа.
- Сохранить тесты `json_object` и `no response_format when jsonMode absent`.

**claude-agent backend (`src/claude-cli-client.ts`)**: не затронут. `agent-runner.ts` для ветки claude-agent не выставляет `jsonMode` в opts (см. строки 28-30 текущего файла) → значение `undefined` → `buildChatParams` не добавляет `response_format`. Сужение типа `LlmCallOptions.jsonMode` до `"json_object" | false | undefined` совместимо: claude-agent ветка не пересекается с удаляемым `"json_schema"`.

**Migration**: existing settings с `nativeAgent.structuredOutput` любого значения (`"json_schema" | "json_object" | "none"`) загружаются без ошибок — поле отсутствует в новом типе, TypeScript structural typing игнорирует extra props. При первом сохранении settings поле исчезает естественным образом. Активная миграция/удаление не требуется. Валидации схемы settings нет.

---

## Block 2: Article Subfolder Placement

### Problem

Ingest prompt instructs LLM to use `wiki_path/` prefix but doesn't provide explicit per-entity-type path templates. LLM places all articles in domain root, ignoring `wiki_subfolder` fields from entity types.

### Solution

Prompt-level fix using domain entity_types data: generate explicit path templates per entity type and inject into ingest system prompt. Since Block 3 ensures entity_types are updated before ingest of each file, templates are always current.

### Implementation

**Terminology**: `wikiVaultPath` (function param) and `{{wiki_path}}` (prompt variable) are the same value — vault-relative path to domain wiki folder (e.g. `!Wiki/ии`). Existing `{{wiki_path}}` placeholder retained; new param `wikiVaultPath` carries the same string into `buildEntityTypesBlock`.

**`src/phases/ingest.ts`** — `buildEntityTypesBlock(domain, wikiVaultPath)`:
- Add `wikiVaultPath` parameter.
- For each entity type with `wiki_subfolder`, add line (literal `<EntityName>` is a placeholder for LLM to substitute with actual entity name):
  ```
  Путь для сущностей этого типа: <wikiVaultPath>/<wiki_subfolder>/<EntityName>.md
  ```
- For entity types without `wiki_subfolder`, add line:
  ```
  Путь для сущностей этого типа: <wikiVaultPath>/<EntityName>.md
  ```
- `<wikiVaultPath>` and `<wiki_subfolder>` are interpolated by code; `<EntityName>` left literal (instruction to LLM).

**`prompts/ingest.md`** (точка инъекции — секция `ПРАВИЛА:`, замена строки 13 `- Путь страницы должен начинаться с "{{wiki_path}}/"`):
- Replace на:
  ```
  - Путь статьи определяется типом сущности — используй точный шаблон из секции «ТИПЫ СУЩНОСТЕЙ ДОМЕНА» (выше, до блока ПРАВИЛА), подставив имя сущности вместо <EntityName>
  - Если тип сущности не определён или у домена нет entity_types → путь по умолчанию: {{wiki_path}}/<EntityName>.md
  ```
- Секция `ТИПЫ СУЩНОСТЕЙ ДОМЕНА:` уже существует в шаблоне (строки 4-5) ДО блока `ПРАВИЛА:` — порядок сохраняется, доп. структурных изменений промпта не требуется.

**Edge case — пустые entity_types**: если `domain.entity_types` пуст или отсутствует (новый домен до bootstrap, либо delta вернула пустой массив), `buildEntityTypesBlock` возвращает пустой/минимальный блок без строк `Путь для сущностей этого типа:...`. Промпт fallback-правило (`{{wiki_path}}/<EntityName>.md`) применяется LLM безусловно. В Block 3 эта ситуация возникает только при ingest до bootstrap первого файла — недостижима по логике loop (Step 1 всегда выполняется до Step 2).

**Call site**: `buildIngestMessages` passes `wikiVaultPath` (already in scope) to `buildEntityTypesBlock`.

**DoD**:
1. Unit-test `buildEntityTypesBlock`: domain с `wiki_subfolder: "Технологии"` → блок содержит `Путь для сущностей этого типа: !Wiki/ии/Технологии/<EntityName>.md`.
2. Unit-test: domain с entity type без `wiki_subfolder` → блок содержит `Путь для сущностей этого типа: !Wiki/ии/<EntityName>.md` (без подпапки).
3. Unit-test: `entity_types` пуст → блок не содержит строк `Путь для сущностей этого типа:`, ошибок нет.
4. Manual: после init домена с `entity_types` имеющим `wiki_subfolder: "Технологии"` статьи этого типа создаются по пути `!Wiki/<domain>/Технологии/<Name>.md`, не в корне домена.

---

## Block 3: Per-File Sequential Pipeline in Init

### Problem

`runInitWithSources` has two sequential phases:
- Phase 1: analyze all N source files → build entity_types (no vault writes).
- Phase 2: ingest all N source files → write articles.

Articles appear in vault only when Phase 2 begins. Phase 1 for many files is long; vault remains empty throughout.

### Solution

Merge phases into a single per-file loop. For each source file:
1. **Analyze**: call LLM (bootstrap or incremental template) → update `currentDomain` in memory → persist via `domain_updated` event.
2. **Ingest**: call `runIngest(file, currentDomain)` → articles written to vault immediately.
3. Emit `file_done` → proceed to next file.

### Implementation

**`src/phases/init.ts`** — rewrite `runInitWithSources`:

```
yield { kind: "init_start", totalFiles: toAnalyze.length }

currentDomain = existing ?? null

for each file in toAnalyze:
  yield file_start

  read file content

  // Step 1: Analyze
  if i === 0 && !isResuming:
    LLM call with initTemplate → parse DomainEntry → currentDomain
    yield domain_created / domain_updated
  else:
    LLM call with initIncrementalTemplate → parse EntityTypesDelta
    merge entity_types into currentDomain
    yield domain_updated

  if signal.aborted → save progress → return

  // Step 2: Ingest (immediate write)
  for await ev of runIngest([file], vaultTools, llm, model, [currentDomain], ...):
    yield ev

  currentDomain.analyzed_sources = [..., file]
  yield domain_updated (analyzed_sources)

  yield file_done

// Finalize: analyzed_sources НЕ сбрасывается — сохраняется как полный список обработанных
yield result
```

**Key points**:
- `runIngest` receives `currentDomain` with entity_types known at that point (grows with each file). Signature unchanged: pass `[currentDomain]` (single-element array).
- Resume logic: `analyzed_sources` updated только после успешного завершения ОБОИХ шагов для файла. На resume файлы из `analyzed_sources` пропускаются полностью (no analysis, no ingest). `toAnalyze = sourceFiles.filter(f => !alreadyAnalyzed.has(f))`.
- `init_start` emits once with `totalFiles`; `phase` field becomes optional in type (kept for backward-compat with old history entries) but new emits omit it.
- `onFileError` callback preserved for ingest step.
- Abort handling: if aborted mid-file (after Step 1 or during Step 2) → `analyzed_sources` NOT updated for that file → safe to resume from that file.

**Migration с старого 2-фазного pipeline**:
- Старый код добавлял файл в `analyzed_sources` после завершения Phase 1 (analyze) — до начала Phase 2 (ingest). Если пользователь прервал старый init после Phase 1 но до Phase 2, в `analyzed_sources` остались файлы без созданных wiki-статей.
- Новый код, увидев такой `analyzed_sources`, пропустит эти файлы полностью → wiki-статьи никогда не будут созданы (orphan).
- Решение: одноразовая миграция при загрузке settings — если у домена `analyzed_sources` defined И отсутствует marker нового pipeline `analyzed_sources_v2: true` → сбросить `analyzed_sources = []` (полный re-init на следующем запуске).
- Реализация: `src/settings.ts` `loadSettings()` — после merge с DEFAULT_SETTINGS пройтись по `domains[*]`: если `analyzed_sources` defined и `analyzed_sources_v2` отсутствует → `analyzed_sources = []`, `analyzed_sources_v2 = true`. Поле `analyzed_sources_v2: boolean` добавляется в `DomainEntry` тип.
- Новый код всегда выставляет `analyzed_sources_v2: true` при создании/обновлении домена (в `runInitWithSources` после bootstrap первого файла).
- DoD миграции: unit-test на `loadSettings` — domain с `analyzed_sources: ["a","b"]` без `_v2` → после load `analyzed_sources: []`, `analyzed_sources_v2: true`. Domain с `analyzed_sources_v2: true` → не изменён.

**Finalize behavior — повторный запуск init**:
- На успешном завершении `analyzed_sources` НЕ сбрасывается в `undefined`. Сохраняется как полный список обработанных файлов.
- Следующий запуск init на том же домене:
  - `existing.analyzed_sources` defined и `analyzed_sources_v2: true` → `isResuming = true` → bootstrap пропущен.
  - `toAnalyze = sourceFiles.filter(f => !alreadyAnalyzed.has(f))` → только новые файлы пройдут через analyze + ingest.
  - Если новых файлов нет → `toAnalyze` пуст → loop не выполняется → emit result "no new sources".
- Полный re-bootstrap домена возможен только через явный сброс `analyzed_sources` пользователем (вне scope этой задачи).

**dryRun behavior в новом pipeline**:
- При `dryRun: true` после bootstrap первого файла (Step 1) выводит DomainEntry JSON и возвращает (как сейчас). Step 2 (ingest) и обработка остальных файлов пропускаются.
- Поведение существующее, не меняется. dryRun остаётся способом превью bootstrap-результата.

**`src/types.ts`** — `RunEvent.init_start`: keep `phase` as optional field (backward-compat for stored history entries from old 2-phase pipeline). New code never sets it.

**DoD Block 3**:
1. Integration test (`tests/phases/init-pipeline.test.ts`): init с N=3 source files и mock LLM → после обработки file[0] vault содержит статьи file[0] (проверка через mock VaultTools.write), не дожидаясь file[1].
2. Test resume: прервать после file[1] file_done → перезапуск → `toAnalyze` содержит только file[2]; file[0] и file[1] не пере-анализируются и не пере-ingest'ятся.
3. Test abort mid-file: signal.aborted после Step 1 file[1], до Step 2 → `analyzed_sources = [file[0]]` (file[1] НЕ добавлен) → resume пере-обрабатывает file[1] полностью.
4. Test repeated init: после успешного init с N файлов повторный запуск с тем же sourceFiles → `toAnalyze` пуст → emit result без LLM-вызовов.
5. Manual: после init домена статьи появляются в vault инкрементально (видны в Obsidian после каждого file_done), не пакетом в конце.

---

## Affected Files Summary

| File | Change |
|---|---|
| `src/types.ts` | Remove `json_schema` from `LlmCallOptions.jsonMode`; remove `structuredOutput` from `nativeAgent` settings; add `analyzed_sources_v2: boolean` to `DomainEntry`; `RunEvent.init_start.phase` → optional |
| `src/settings.ts` | Remove `structuredOutput` from UI and `DEFAULT_SETTINGS`; добавить миграцию `analyzed_sources` без `_v2` → пустой массив в `loadSettings` |
| `src/phases/llm-utils.ts` | Extend `parseStructured` (fence stripping); add `wrapWithJsonFallback` (handles streaming + non-streaming); remove `json_schema` branch from `buildChatParams` |
| `src/agent-runner.ts` | Always `jsonMode: "json_object"` for native; wrap llm with `wrapWithJsonFallback` |
| `src/phases/init.ts` | Rewrite `runInitWithSources` as per-file loop; remove `json_schema` schema branches; выставлять `analyzed_sources_v2: true` |
| `src/phases/query.ts` | Remove `json_schema` schema branch |
| `src/phases/lint.ts` | Remove `json_schema` schema branch |
| `src/phases/ingest.ts` | `buildEntityTypesBlock` adds explicit path templates; accepts `wikiVaultPath` |
| `prompts/ingest.md` | Explicit subfolder path rule |
| `tests/llm-utils.test.ts` | Удалить тест `json_schema` variant |

## Out of Scope

- `json_schema` removal for claude-agent backend (not applicable — uses iclaude.sh, not OpenAI API directly).
- Changing ingest behaviour outside of init context (standalone ingest already writes per-file).
- Evaluator, format, query phases (don't parse structured JSON responses in the same way).
