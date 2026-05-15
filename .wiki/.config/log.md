# Wiki Log

<!-- Append-only лог. Новые записи добавляются в конец. -->

## 2026-05-13 — init документация

**Операция:** init  
**Домен:** документация  
**Источники:** docs/ (8 md, 1 yaml — architecture + superpowers/specs + superpowers/plans)  
**Bootstrap:** entity_types сгенерированы и сохранены (5 типов: компонент, операция, паттерн, спецификация, план)

**Создано страниц:** 12
- документация/компоненты/wiki-controller.md (mature)
- документация/компоненты/agent-runner.md (mature)
- документация/компоненты/claude-cli-client.md (mature)
- документация/компоненты/llm-wiki-view.md (developing)
- документация/операции/format-operation.md (mature)
- документация/операции/поток-выполнения-операции.md (mature)
- документация/паттерны/single-flight-guard.md (mature)
- документация/паттерны/async-generator-events.md (mature)
- документация/паттерны/backend-strategy.md (mature)
- документация/спецификации/agent-base-contract.md (mature)
- документация/спецификации/format-operation-design.md (mature)
- документация/спецификации/claude-agent-backend-design.md (mature)

**Обновлено:** index.md, log.md

**Следующий шаг:** ingest оставшихся specs из docs/superpowers/specs/ и docs/superpowers/plans/ по мере необходимости

## 2026-05-13 — ingest (security: proxy, phases/fix, view)

**Операция:** ingest  
**Домен:** документация  
**Источники:** src/claude-cli-client.ts, src/phases/fix.ts, src/view.ts

**Обновлено страниц:** 2
- документация/компоненты/claude-cli-client.md — актуализирована `ClaudeCliConfig` (удалён `maxTokens`, добавлены `cwd`/`allowedTools`/`tmpDir`/`tmpWrite`/`tmpRemove`/`resumeSessionId`); расширено описание proxy-правила и spawn args
- документация/компоненты/llm-wiki-view.md — добавлен раздел XSS-защиты (`sanitizeLinks`) и `registerLinkHandler`

**Создано страниц:** 1
- документация/операции/fix-operation.md (developing) — описание операции fix с акцентом на path-блокировку (security)

**Обновлено:** index.md, log.md

## 2026-05-13 — ingest audit-fix-design spec + format-token-preservation plan

**Операция:** ingest  
**Домен:** документация  
**Источники:** docs/superpowers/specs/2026-05-13-audit-fix-design.md, docs/superpowers/plans/2026-05-13-format-token-preservation.md

**Создано страниц:** 1
- документация/спецификации/audit-fix-design.md (mature) — spec: 4 ошибки + ~21 предупреждение для Community Plugins (minAppVersion, sentence-case, window APIs, TypeScript any)

**Не создано (уже покрыто):** формат план → format-operation.md уже содержит token-retry и appendMissingLines

**Обновлено:** index.md (спецификации 3→4), log.md

## 2026-05-13 — ingest src/phases/format.ts

**Операция:** ingest  
**Домен:** документация  
**Источник:** src/phases/format.ts

**Обновлено страниц:** 1
- документация/операции/format-operation.md — добавлены: три LLM-вызова (основной / JSON-retry / token-restore), `callOnce()` inner generator (stream + fallback), `extractImagePaths`, `format_schema` загрузка из `!Wiki/_format_schema.md`, исправлен `tempPath` (`<dir>/<basename>` вместо `!Temp/`), `missingTokensWithContext` вместо `missingTokens`, `appendMissingLines` hard fallback, `looksTruncated` проверка до retry

**Обновлено:** log.md

## 2026-05-13 — ingest src/phases/format-utils.ts

**Операция:** ingest  
**Домен:** документация  
**Источник:** src/phases/format-utils.ts

**Создано страниц:** 1
- документация/компоненты/format-utils.md (stub) — публичный API: `FormatResponse`, `MissingToken`, `extractJsonObject`, `looksTruncated`, `significantTokens`, `missingTokens`, `missingTokensWithContext`, `appendMissingLines`; алгоритмы token-extraction и lemmatization; поток использования в runFormat

**Обновлено:** index.md (компоненты 4→5), log.md

## 2026-05-14T00:00:00

**Операция:** ingest
**Источник:** README.md
**Домен:** документация

**Затронуто страниц:** 6

- СОЗДАНА: `документация/операции/ingest-operation.md` (stub) — UX-поток, desktop-only
- СОЗДАНА: `документация/операции/query-operation.md` (stub) — query + query-save, desktop+mobile
- СОЗДАНА: `документация/операции/lint-operation.md` (stub) — проверка качества, desktop-only
- СОЗДАНА: `документация/операции/init-operation.md` (stub) — инициализация домена, desktop-only
- СОЗДАНА: `документация/операции/chat-operation.md` (stub) — интерактивный чат после Lint/Query
- СОЗДАНА: `документация/паттерны/per-device-settings.md` (stub) — local.json для machine-specific путей

**Примечание:** README.md вне source_paths["docs"], обработан по содержимому как документация домена

---

## 2026-05-14 — ingest generation-speed spec + plan

**Операция:** ingest
**Домен:** документация
**Источники:**
- `docs/superpowers/specs/2026-05-14-generation-speed-design.md`
- `docs/superpowers/plans/2026-05-14-generation-speed.md`

**Создано страниц:** 2
- `документация/спецификации/generation-speed-design.md` (mature) — дизайн отображения tok/s: источник `usage.output_tokens`, два DOM-места (progressCount + resultSpeedEl), поток данных через appendEvent→finish→setRunning, изменения в types/stream/view/controller
- `документация/планы/generation-speed-plan.md` (mature) — 6 задач реализации: TDD для stream.ts, 4 под-изменения view.ts, обогащение лога controller.ts, bump версии

**Обновлено страниц:** 1
- `документация/компоненты/llm-wiki-view.md` — добавлен раздел «Отображение скорости генерации» с описанием `lastTokPerSec`, `resultSpeedEl` и потоком данных

**Обновлено:** index.md (спецификации 4→5, планы 0→1), log.md

---

## 2026-05-14 — ingest remove-content-truncation spec

**Операция:** ingest
**Домен:** документация
**Источник:** `docs/superpowers/specs/2026-05-14-remove-content-truncation-design.md`

**Создано страниц:** 1
- `документация/спецификации/remove-content-truncation-design.md` (mature) — spec: удаление всех `.slice(0, N)` из четырёх LLM-фаз (init/ingest/lint/query); рефактор `buildContextBlock` в query.ts без параметра `maxChars`; замена truncation-предупреждения в init на информационный лог размера

**Обновлено:** index.md (спецификации 5→6), log.md

---

## 2026-05-15T00:00:00

**Операция:** ingest
**Источники:** `prompts/init.md`, `prompts/init-incremental.md`, `prompts/lint.md`
**Домен:** документация

**Затронуто страниц:** 3

- ОБНОВЛЕНА: `документация/операции/init-operation.md` (stub → developing) — добавлены разделы «LLM-промпты»: bootstrap-анализ (init.md) и инкрементальное обновление entity_types (init-incremental.md); структура выходного JSON; правила обновления entity_types
- ОБНОВЛЕНА: `документация/операции/lint-operation.md` (stub → developing) — добавлен раздел «LLM-промпт (lint.md)»: входные данные, выходной JSON, назначение поля reasoning
- СОЗДАНА: `документация/паттерны/reasoning-first-json.md` (stub) — соглашение: поле reasoning первым в JSON-ответах LLM-промптов; применяется в init.md, init-incremental.md, lint.md

**Примечание:** prompts/ вне source_paths["docs"], обработаны по содержимому как документация домена

---

## 2026-05-15T11:57:00

**Операция:** ingest
**Источники:**
- `docs/superpowers/specs/2026-05-15-init-stability-design.md`
- `docs/superpowers/specs/2026-05-15-reinit-button-design.md`
- `docs/superpowers/plans/2026-05-15-init-stability-design.md`
- `docs/superpowers/plans/2026-05-15-reinit-button.md`

**Домен:** документация

**Затронуто страниц:** 4

- СОЗДАНА: `документация/спецификации/init-stability-design.md` (mature) — спека трёх блоков init: auto-fallback structured output (json_object с retry без response_format), размещение статей по wiki_subfolder через path-шаблоны в prompt'е, per-file pipeline (analyze + ingest в одном цикле), миграция analyzed_sources_v2
- СОЗДАНА: `документация/спецификации/reinit-button-design.md` (mature) — UI-спека кнопки ⟳ в domainRow: вызов controller.init для выбранного домена с сохранёнными sourcePaths, ConfirmModal с подсчётом md-файлов, disabled-синхронизация во всех переходах (change/refreshDomains/setRunning/finish), 4 i18n-ключа
- СОЗДАНА: `документация/планы/init-stability-plan.md` (mature) — 12 задач реализации init-stability: типы, llm-utils (parseStructured fences, wrapWithJsonFallback, isJsonModeError), agent-runner, settings, ingest path templates, DomainStore миграция migrateDomainsV2, rewrite runInitWithSources, тесты. F-003: миграция перенесена в DomainStore.load() из spec'овой loadSettings
- СОЗДАНА: `документация/планы/reinit-button-plan.md` (mature) — 5 задач реализации reinit-button: i18n (en/ru/es), поле reinitBtn в view.ts, disabled-sync, метод runReinit с loadDomains+ConfirmModal+controller.init, patch-bump 0.1.96→0.1.97

**Обновлено:** index.md (спецификации 6→8, планы 1→3), log.md

---
