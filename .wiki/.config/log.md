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

## 2026-05-15 — ingest (structured-output-resilience plan + prompt examples)

**Операция:** ingest
**Домен:** документация
**Источники:**
- docs/superpowers/plans/2026-05-15-structured-output-resilience.md
- prompts/init.md
- prompts/init-incremental.md

**Создано страниц:** 4
- документация/планы/structured-output-resilience-plan.md (mature)
- документация/компоненты/parse-with-retry.md (developing)
- документация/компоненты/structural-error-counter.md (developing)
- документация/паттерны/structured-output-retry.md (developing)

**Обновлено страниц:** 1
- документация/паттерны/reasoning-first-json.md — добавлена секция «Output JSON Example в промптах», ссылки на [[parse-with-retry]] и [[structured-output-retry]]; статус stub → developing

**Обновлено:** index.md (счётчики: компоненты 5→7, паттерны 5→6, планы 3→4)

**Следующий шаг:** lint документация после реализации плана; ingest спецификации docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md для дополнения контекста

## 2026-05-15 — ingest (reinit-force: spec, plan, TODO)

**Операция:** ingest
**Домен:** документация
**Источники:**
- `docs/TODO.md` (roadmap, item 5 — re-init wipe + rebuild)
- `docs/superpowers/specs/2026-05-15-reinit-force-design.md`
- `docs/superpowers/plans/2026-05-15-reinit-force-design.md`

**Создано страниц:** 2
- `документация/спецификации/reinit-force-design.md` (mature) — флаг `--force` для init: wipe wiki-папки + сброс entity_types/analyzed_sources/language_notes + recycle-иконка
- `документация/планы/reinit-force-plan.md` (mature) — TDD-декомпозиция: 7 задач (wipeDomainFolder helper, force param в runInitWithSources, --force dispatch в runInit, controller signature, view snake_case + recycle icon, i18n en/ru/es, manual verification)

**Обновлено страниц:** 1
- `документация/операции/init-operation.md` — добавлен раздел «Флаги CLI» с описанием `--dry-run` / `--sources` / `--force`; обновлены wiki_sources, теги, связанные страницы

**Не создано:**
- Для `docs/TODO.md` отдельная страница не создаётся — это roadmap-tracker, item 5 уже покрыт страницами reinit-force-* (синтез вместо дублирования)
- Для helper `wipeDomainFolder` — описан внутри `reinit-force-design.md`, отдельная страница нецелесообразна (одна функция, тесно связанная с фазой)

**Обновлено:** index.md (спецификации 8→9, планы 4→5), log.md

**Следующий шаг:** после реализации (commits по плану) — запустить `/llm-wiki lint документация` для проверки актуальности

---

## 2026-05-15 — ingest (max_tokens relocate + numCtx drop)

**Операция:** ingest
**Домен:** документация
**Источники:**
- `docs/superpowers/specs/2026-05-15-max-tokens-relocate-numctx-drop-design.md`
- `docs/superpowers/plans/2026-05-15-max-tokens-relocate-numctx-drop.md`
- `README.md`
- `docs/TODO.md`
- `docs/README.ru.md`

**Создано страниц:** 2
- `документация/спецификации/max-tokens-relocate-design.md` (mature) — schema v3: top-level `maxTokens` → `nativeAgent.maxTokens`; `numCtx` удалён из `LlmCallOptions`, `nativeAgent`, `LocalConfig`, UI и i18n; контракт миграции data.json
- `документация/планы/max-tokens-relocate-plan.md` (mature) — 9 задач TDD-реализации: types/local-config/llm-utils/agent-runner/i18n/settings UI/main.ts migration/тесты/version bump 0.1.99→0.1.100

**Обновлено страниц:** 1
- `документация/компоненты/agent-runner.md` — добавлен раздел «Build options (native, schema v3)»: `na.maxTokens` вместо `s.maxTokens`, `numCtx` удалён; источник + дата обновлены

**Не создано (синтез вместо дублирования):**
- `README.md` / `docs/README.ru.md` — RU/EN-мирроры уже покрыты предыдущими ingest (см. 2026-05-14T00:00:00); поле `Max tokens` уже описано в Settings reference. После v0.1.100 README потребует уточнения (Max tokens теперь native-only, num_ctx удалён), но это правка README, не вики
- `docs/TODO.md` — roadmap-tracker; item 4 (примеры native/claude в README) и item 6 (выбор домена на мобильном) ещё не реализованы; item 5 покрыт reinit-force-* страницами

**Обновлено:** index.md (спецификации 9→10, планы 5→6), log.md


## 2026-05-16 — ingest CLAUDE.md

**Операция:** ingest
**Домен:** документация
**Источник:** CLAUDE.md (корень репозитория, project instructions)

**Создано страниц:** 2
- документация/компоненты/wiki-graph-cache.md (stub) — GraphCache: in-memory per-domain hash-keyed кеш графа wiki
- документация/компоненты/wiki-seeds.md (stub) — selectSeeds: Jaccard-ранжирование seed-страниц для query

**Обновлено страниц:** 2
- документация/операции/query-operation.md — добавлены секция "Контекст для LLM" (graphCache + selectSeeds + graph_stats), новый wiki_source
- документация/операции/поток-выполнения-операции.md — добавлена секция "Graph cache в query/lint", новый wiki_source

**Пропущено:** прочие сущности CLAUDE.md (WikiController, AgentRunner, ClaudeCliClient, LlmWikiView, parseStreamLine, single-flight, stream-json) — уже покрыты mature-страницами без нового материала.

**Следующий шаг:** при необходимости поднять wiki-graph-cache и wiki-seeds из stub → developing после ingest реальных файлов src/wiki-graph-cache.ts и src/wiki-seeds.ts.

## 2026-05-16 — ingest mobile-domain-selector

- Операция: ingest
- Источники:
  - `docs/TODO.md` (items 6-7: mobile domain selector + native agent on mobile)
  - `docs/superpowers/specs/2026-05-16-mobile-domain-selector-design.md`
  - `docs/superpowers/plans/2026-05-16-mobile-domain-selector.md`
- Домен: документация
- Создано: 2
  - `документация/спецификации/mobile-domain-selector-design.md` (спецификация)
  - `документация/планы/mobile-domain-selector-plan.md` (план)
- Обновлено: 1
  - `документация/компоненты/llm-wiki-view.md` (добавлен раздел Mobile domain selector planned, расширены wiki_sources, теги)
- Пропущено: 0
- Замечания: TODO.md (roadmap) — отдельной страницы не создано (роадмап-документ); item 7 (native agent на mobile) — out of scope этой ingestion, отмечен как follow-up в spec.

## 2026-05-17 — ingest mobile-query-seed-design (spec + plan + prompts)

**Операция:** ingest (batch)  
**Домен:** документация  
**Источники:**
  - `docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md`
  - `docs/superpowers/plans/2026-05-17-mobile-query-seed-design.md`
  - `prompts/ingest.md`
  - `prompts/lint.md`
  - `prompts/init.md`
  - `prompts/init-incremental.md`

**Создано:** 3
  - `документация/спецификации/mobile-query-seed-design.md` (спецификация)
  - `документация/планы/mobile-query-seed-plan.md` (план)
  - `документация/компоненты/wiki-index.md` (компонент)

**Обновлено:** 5
  - `документация/компоненты/wiki-seeds.md` — алгоритм Jaccard: bodyContent(500), parseFmKeywords, scoreSeed/selectSeeds с annotation
  - `документация/операции/query-operation.md` — поток parseIndexAnnotations → selectSeeds, Jaccard-first + LLM fallback
  - `документация/операции/ingest-operation.md` — parseJsonPages с annotation?, upsertIndexAnnotation per page
  - `документация/операции/lint-operation.md` — upsertIndexAnnotation, удалён flat index rewrite, annotation в промпте

**Пропущено:** 0

## 2026-05-18 — ingest security-audit-fixes (spec + plan)

**Операция:** ingest (batch)
**Домен:** документация
**Источники:**
  - `docs/superpowers/specs/2026-05-18-security-audit-fixes-design.md`
  - `docs/superpowers/plans/2026-05-18-security-audit-fixes.md`
  - `README.md`

**Создано:** 2
  - `документация/спецификации/security-audit-fixes-design.md` (mature) — два замечания review bot: Finding 1 (vault enumeration → collectMdInPaths+walkFolder), Finding 2 (shell execution → probe-spawn→fs.access, validateIclaudePath, ShellConsentModal с onLayoutReady + controller guard, README Security)
  - `документация/планы/security-audit-fixes-plan.md` (mature) — 5 TDD-задач: Task 1 (getFiles→helpers), Task 2 (settings.ts no spawn), Task 3 (validateIclaudePath), Task 4 (consent modal+guard), Task 5 (README)

**Обновлено:** index.md (спецификации 12→13, планы 8→9), log.md

**Пропущено:** README.md — Security section уже присутствует в README (реализована Task 5), содержимое покрыто в обеих wiki-страницах

---

## 2026-05-18 — ingest lint-ux-fixes (spec + plan)

**Операция:** ingest (batch)
**Домен:** документация
**Источники:**
  - `docs/superpowers/specs/2026-05-18-lint-ux-fixes-design.md`
  - `docs/superpowers/plans/2026-05-18-lint-ux-fixes.md`

**Создано:** 2
  - `документация/спецификации/lint-ux-fixes-design.md` (mature) — пять независимых UX-фиксов: Fix 1 (appendLintLog в _log.md), Fix 2 (dedup dead-links через new Set), Fix 3 (lint-chat domain fallback + i18n selectDomainFirst), Fix 4 (copy button на чат-сообщениях, hover-reveal CSS), Fix 5 (убрать ASSISTANT_TEXT_MAX + waiting indicator tool_result→tool_use/assistant_text)
  - `документация/планы/lint-ux-fixes-plan.md` (mature) — 6 TDD-задач: Task 1 (appendLintLog), Task 2 (checkStructure dedup), Task 3 (i18n + domain fallback), Task 4 (copy btn CSS+TS), Task 5a (ASSISTANT_TEXT_MAX), Task 5b (waiting indicator поля+методы+wiring)

**Обновлено:** index.md (спецификации 13→14, планы 9→10), log.md

---

## 2026-05-18 — ingest README.md + docs/TODO.md

**Операция:** ingest  
**Домен:** документация  
**Источники:**
  - `README.md`
  - `docs/TODO.md`

**Создано страниц:** 2
  - `документация/компоненты/settings.md` (developing) — полный справочник настроек плагина: General, Domains, Backend selector, Claude Agent (включая shellConsentGiven), Native Agent (per-operation, structured output retries), Proxy, Graph, Dev mode
  - `документация/паттерны/shell-consent.md` (stub) — паттерн первого запуска: модальный диалог согласия перед spawn внешнего процесса, флаг `shellConsentGiven` в data.json, механизм отзыва

**Обновлено страниц:** 2
  - `документация/операции/lint-operation.md` — добавлен раздел «Известные проблемы» с TODO-пунктами 9/10/13/14 (статусы `[v]`/`[>]`): деdup dead-links (исправлено, коммит cddfb51), lint-chat ошибка, неполный прогресс + waiting indicator, lint не пишет в log/index
  - `документация/компоненты/llm-wiki-view.md` — добавлены разделы: copy-to-clipboard кнопка на чат-пузырях (коммит ba9f192), waiting indicator между tool_result и следующим LLM-событием (коммит 5547cc2)

**Не создано (уже покрыто):**
  - Операции (ingest/query/lint/init/chat/format) — покрыты в предыдущих ingest
  - TODO items 9–14 на уровне спецификаций — покрыты `lint-ux-fixes-design.md` и `security-audit-fixes-design.md`
  - Security section README — покрыта `security-audit-fixes-design.md`

**Обновлено:** index.md (компоненты 10→11, паттерны 6→7), log.md

---

## 2026-05-19 — ingest README.md + docs/ + prompts/

**Операция:** ingest  
**Домен:** документация  
**Источники:**
  - `README.md`
  - `docs/superpowers/specs/2026-05-19-live-response-ux-design.md`
  - `docs/superpowers/plans/2026-05-19-live-response-ux.md`
  - `docs/superpowers/specs/2026-05-19-live-status-ux-design.md`
  - `docs/superpowers/plans/2026-05-19-live-status-ux.md`
  - `docs/superpowers/specs/2026-05-19-index-path-annotation-design.md`
  - `docs/superpowers/plans/2026-05-19-index-path-annotation.md`
  - `docs/superpowers/specs/2026-05-19-wiki-path-hierarchy-design.md`
  - `docs/superpowers/plans/2026-05-19-wiki-path-hierarchy.md`
  - `docs/superpowers/specs/2026-05-19-agent-stability-audit-design.md`
  - `prompts/ingest.md` (ПРАВИЛО ПУТЕЙ уже добавлено)
  - `prompts/init.md` (ПРАВИЛО wiki_subfolder)

**Создано страниц:** 9
  - `документация/спецификации/live-response-ux-design.md` (mature) — streaming assistant_text в Result section, scheduleAssistantRender(), авто-коллапс Progress
  - `документация/планы/live-response-ux-plan.md` (mature) — 9 tasks; реализован v0.1.110, заменён live-status-ux
  - `документация/спецификации/live-status-ux-design.md` (mature) — Status-блок вместо streaming; Progress остаётся открытым; liveStatusSection/IconEl/TextEl
  - `документация/планы/live-status-ux-plan.md` (mature) — 10 tasks; реализован v0.1.111
  - `документация/спецификации/index-path-annotation-design.md` (mature) — новый формат `pid: [[pid]] path | annotation`, backward compat
  - `документация/планы/index-path-annotation-plan.md` (mature) — 5 TDD-задач; реализован v0.1.109
  - `документация/спецификации/wiki-path-hierarchy-design.md` (mature) — sanitize/validate функции, retry в ingest
  - `документация/планы/wiki-path-hierarchy-plan.md` (mature) — 4 TDD-задачи (wiki-path.ts, init, ingest, prompts)
  - `документация/спецификации/agent-stability-audit-design.md` (mature) — Zod схемы для page-arrays, lint merge assess+fix, format Zod

**Обновлено страниц:** 3
  - `документация/компоненты/llm-wiki-view.md` — добавлены разделы Live Response UX (v0.1.110) и Live Status UX (v0.1.111) с таблицей Status по событиям
  - `документация/компоненты/wiki-index.md` — обновлён API (fullPath param), новый формат _index.md, backward compat, история изменений
  - `документация/операции/lint-operation.md` — добавлен раздел agent-stability-audit (planned merge assess+fix, LintOutputSchema, UI-прогресс)

**Обновлено:** index.md (спецификации 14→19, планы 10→14), log.md

---

## 2026-05-20 — ingest (prompts/ingest.md, prompts/lint.md)

**Операция:** ingest
**Домен:** документация
**Источники:**
- `prompts/ingest.md`
- `prompts/lint.md`

**Создано страниц:** 0

**Обновлено страниц:** 2
- `документация/операции/ingest-operation.md` — обновлён по agent-stability-audit-design: промпт теперь возвращает `{reasoning, pages}` вместо сырого массива; `parseJsonPages` заменена на `parseWithRetry(WikiPagesOutputSchema)`; добавлено правило путей (4 сегмента); обновлены wiki_keywords, wiki_sources, история изменений
- `документация/операции/lint-operation.md` — обновлён по agent-stability-audit-design: промпт lint.md возвращает `{reasoning, report, fixes}` (combined assess+fix); раздел "Agent Stability Audit: Merge assess+fix" переведён из planned в реализовано; `buildFixMessages` удалена; обновлены wiki_keywords, wiki_sources, история изменений

**Обновлено:** log.md

---

## 2026-05-20 — ingest (wiki-config-schema-log-index-design spec + TODO)

**Операция:** ingest
**Домен:** документация
**Источники:**
- `docs/superpowers/specs/2026-05-20-wiki-config-schema-log-index-design.md`
- `docs/TODO.md`

**Создано страниц:** 2
- `документация/спецификации/wiki-config-schema-log-index-design.md` (mature) — три улучшения: config-layout (.config/), grouped Markdown index, enriched log format; новый модуль wiki-log.ts; wiki-index.ts перепись
- `документация/компоненты/wiki-log.md` (developing) — appendWikiLog API, LogOperation/IngestLogEntry типы, формат записей ingest/lint/fix

**Обновлено страниц:** 0

**Обновлено:** index.md (компоненты 11→12, спецификации 19→20), log.md

---

## 2026-05-23 — ingest docs/TODO.md (бэклог задач)

**Операция:** ingest
**Домен:** документация
**Источник:** `docs/TODO.md`

**Создано страниц:** 0

**Обновлено страниц:** 5
- `документация/операции/query-operation.md` — добавлен раздел «Варианты запуска (актуально)» (задача #30: убрать "Ask and save") и «Известные проблемы» (задачи #7, #30, #32); обновлены wiki_sources, wiki_updated
- `документация/операции/lint-operation.md` — в таблицу «Известные проблемы» добавлены задачи #21 (lint-chat новый процесс неверно) и #22 (некорректная запись в лог); обновлены wiki_updated
- `документация/операции/chat-operation.md` — добавлен раздел «Известные проблемы» (задачи #10, #21, #22); обновлены wiki_sources, wiki_updated
- `документация/компоненты/llm-wiki-view.md` — добавлен раздел «Известные проблемы» (задачи #20, #23, #29, #31, #33); обновлены wiki_updated
- `документация/компоненты/settings.md` — добавлен раздел «Известные проблемы» (задачи #12, #16, #27, #29); обновлены wiki_updated

**Пропущено (уже покрыто ранее):**
- Задачи 1–5, 8, 9, 13, 14, 17–19, 25, 28 — реализованы (`[v]`) или отражены в существующих wiki-страницах
- Задача 24 (архитектура ecom1-agent/.wiki) — исследовательская задача, не создаёт wiki-сущности
- Задача 26 (проверка prompt-architecture.md) — задача-ревью, не создаёт wiki-сущности
- Задача 4 (README примеры) — вне scope документации wiki

**Обновлено:** log.md

---

## 2026-05-24 — ingest docs/superpowers/specs/2026-05-23-ux-cleanup-design.md, docs/superpowers/plans/2026-05-23-ux-cleanup.md, docs/TODO.md

**Операция:** ingest  
**Домен:** документация  
**Источники:**
- `docs/superpowers/specs/2026-05-23-ux-cleanup-design.md`
- `docs/superpowers/plans/2026-05-23-ux-cleanup.md`
- `docs/TODO.md`

**Создано страниц:** 2
- `документация/спецификации/ux-cleanup-design.md` — UX Cleanup Design: consent per-switch (#29), удаление query-save (#30+), авто-коллапс Progress (#31)
- `документация/планы/ux-cleanup-plan.md` — UX Cleanup Implementation Plan (8 задач, 10 файлов)

**Обновлено страниц:** 5
- `документация/компоненты/llm-wiki-view.md` — задачи #30, #31 отмечены как спец/план; добавлены ссылки [[ux-cleanup-design]], [[ux-cleanup-plan]]; wiki_sources дополнены
- `документация/компоненты/settings.md` — задача #29 отмечена как спец/план; описание ShellConsent обновлено (per-switch вместо first-run); добавлены ссылки
- `документация/паттерны/shell-consent.md` — переименован First-Run → Per-Switch; механизм обновлён: modal fires on every switch; добавлена история изменения
- `документация/операции/query-operation.md` — удалено описание query-save; добавлен раздел «Удаление query-save (Task 30+)»; задача #30 отмечена реализованной в плане
- `.config/index.md` — добавлены [[ux-cleanup-design]] и [[ux-cleanup-plan]]

