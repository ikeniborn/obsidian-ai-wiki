# Wiki Log

<!-- Append-only лог. Новые записи добавляются в конец. -->

## 2026-05-05 — init планы

**Операция:** init  
**Домен:** планы (Планы реализации)  
**Источники:** docs/superpowers/plans/ (23 файла)  
**Результат:** CREATED

### Созданные страницы

**Фичи (19):**
- планы/фичи/collapsible-progress-display.md
- планы/фичи/interactive-mode.md
- планы/фичи/native-agent.md
- планы/фичи/claude-agent-backend.md
- планы/фичи/domain-map-in-vault.md
- планы/фичи/per-operation-models.md
- планы/фичи/dev-mode-prompt-management.md
- планы/фичи/dspy-prompt-optimization.md
- планы/фичи/wiki-init-root-files.md
- планы/фичи/chat-after-all-operations.md
- планы/фичи/chat-session-resume.md
- планы/фичи/e2big-fix.md
- планы/фичи/source-path-auto-add.md
- планы/фичи/vault-relative-paths.md
- планы/фичи/domain-form-ux.md
- планы/фичи/links-frontmatter.md
- планы/фичи/obsidian-review-fixes.md
- планы/фичи/agent-base-contract.md
- планы/фичи/chat-feedback.md

**Компоненты (9):**
- планы/компоненты/view-ts.md
- планы/компоненты/controller-ts.md
- планы/компоненты/agent-runner-ts.md
- планы/компоненты/claude-cli-client-ts.md
- планы/компоненты/types-ts.md
- планы/компоненты/phases-ts.md
- планы/компоненты/stream-ts.md
- планы/компоненты/settings-ts.md
- планы/компоненты/modals-ts.md

**Паттерны (5):**
- планы/паттерны/async-generator-events.md
- планы/паттерны/single-flight.md
- планы/паттерны/tdd-vitest.md
- планы/паттерны/vault-relative-path-pattern.md
- планы/паттерны/esbuild-text-loader.md

**Итого:** 33 страницы CREATE, 0 UPDATE, 0 SKIP

---

## 2026-05-05T00:00:00 — init спецификации

**Операция:** init  
**Домен:** спецификации (Спецификации дизайна)  
**Источники:** docs/superpowers/specs/ (22 файла)  
**Результат:** CREATED

### Созданные страницы

**Фичи (21):**
- спецификации/фичи/collapsible-progress-display.md
- спецификации/фичи/interactive-mode.md
- спецификации/фичи/multi-vault-domain-maps.md
- спецификации/фичи/native-agent.md
- спецификации/фичи/domain-map-native-agent.md
- спецификации/фичи/obsidian-review-fixes.md
- спецификации/фичи/claude-agent-backend.md
- спецификации/фичи/per-operation-models.md
- спецификации/фичи/domain-map-in-vault.md
- спецификации/фичи/agent-base-contract.md
- спецификации/фичи/chat-feedback.md
- спецификации/фичи/dev-mode-prompt-management.md
- спецификации/фичи/dspy-prompt-optimization.md
- спецификации/фичи/wiki-init-root-files.md
- спецификации/фичи/chat-after-all-operations.md
- спецификации/фичи/devmode-logdir.md
- спецификации/фичи/domain-form-ux.md
- спецификации/фичи/domain-populate.md
- спецификации/фичи/e2big-fix.md
- спецификации/фичи/links-frontmatter.md
- спецификации/фичи/vault-relative-paths.md

**Компоненты (6):**
- спецификации/компоненты/claude-cli-client-ts.md
- спецификации/компоненты/agent-runner-ts.md
- спецификации/компоненты/controller-ts.md
- спецификации/компоненты/view-ts.md
- спецификации/компоненты/types-ts.md
- спецификации/компоненты/modals-ts.md

**Паттерны (4):**
- спецификации/паттерны/llm-client-interface.md
- спецификации/паттерны/domain-created-event.md
- спецификации/паттерны/hybrid-orchestration.md
- спецификации/паттерны/esbuild-md-loader.md

**Итого:** 31 страница CREATE, 0 UPDATE, 0 SKIP  
*Примечание: спек README (2026-04-28) не выделен в отдельную страницу — охвачен компонентными страницами*

---

## 2026-05-06 — init скрипты

**Операция:** init  
**Домен:** скрипты (Вспомогательные скрипты)  
**Источники:** scripts/ (0 .md файлов — источники на Python, документация отсутствует)  
**Результат:** DOMAIN REGISTERED, NO PAGES CREATED

### Зарегистрированные entity_types

- модуль — Python-модули (loader.py, optimizer.py, writer.py, backend.py, signature.py)
- конфигурация — env vars, pyproject.toml, настройки запуска
- пайплайн — рабочие процессы оптимизации

### Примечание

В `scripts/dspy/` находится DSPy-оптимизатор промптов llm-wiki. Файлы `.py` не являются источниками для ingest — только `.md` документация. Для наполнения домена необходимо создать документационные `.md` файлы в `scripts/`.

**Итого:** 0 CREATE, 0 UPDATE, 0 SKIP

## 2026-05-05 — ingest скрипты

**Операция:** ingest  
**Домен:** скрипты (Вспомогательные скрипты)  
**Источник:** scripts/dspy/README.md  
**Результат:** CREATED

### Созданные страницы

**Модули (1):**
- скрипты/модули/dspy-optimizer.md

**Конфигурация (1):**
- скрипты/конфигурация/dspy-env-config.md

**Пайплайны (1):**
- скрипты/пайплайны/dspy-mipro-pipeline.md

**Итого:** 3 CREATE, 0 UPDATE, 0 SKIP

---

## 2026-05-06 — fix документация

**Операция:** fix (orphan links)
**Домен:** документация (Документация проекта)
**Результат:** UPDATED

### Исправленные orphan-страницы (CT-004)

Добавлены входящие WikiLinks к 5 страницам без входящих ссылок:

| Страница | Добавлена ссылка из |
|----------|-------------------|
| `документация/компоненты/claude-cli-client` | `backend-strategy.md`, `архитектура-плагина.md` |
| `документация/компоненты/wiki-controller` | `single-flight-guard.md`, `async-generator-events.md`, `архитектура-плагина.md` |
| `документация/руководства/разработка-плагина` | `архитектура-плагина.md` |
| `документация/руководства/публикация-плагина` | `разработка-плагина.md` |
| `документация/руководства/оптимизация-промптов` | `разработка-плагина.md` |

**Итого:** 0 CREATE, 6 UPDATE (5 orphan pages + 1 frontmatter update), 0 SKIP

---

## 2026-05-06 — init реализация

**Операция:** init  
**Домен:** реализация (Реализация плагина)  
**Источники:** src/ (23 .ts файла), prompts/ (9 .md), tests/ (16 .ts)  
**Результат:** DOMAIN REGISTERED, CREATED

### Зарегистрированные entity_types

- модуль — TypeScript-файл с конкретной функциональностью
- фаза — асинхронная фазовая функция операции wiki
- тип — TypeScript интерфейс или тип данных
- промпт — шаблон промпта для LLM
- тест — набор тестов для модуля или фазы

### Созданные страницы

**Модули (7):**
- реализация/модули/agent-runner.md
- реализация/модули/claude-cli-client.md
- реализация/модули/vault-tools.md
- реализация/модули/stream-ts.md
- реализация/модули/wiki-controller.md
- реализация/модули/domain-map-ts.md
- реализация/модули/llm-utils-ts.md

**Фазы (4):**
- реализация/фазы/run-ingest.md
- реализация/фазы/run-init.md
- реализация/фазы/run-query.md
- реализация/фазы/run-lint.md

**Типы (3):**
- реализация/типы/run-event.md
- реализация/типы/llm-client.md
- реализация/типы/llm-wiki-plugin-settings.md

**Промпты (3):**
- реализация/промпты/ingest-промпт.md
- реализация/промпты/init-промпт.md
- реализация/промпты/base-contract-промпт.md

**Тесты (2):**
- реализация/тесты/vitest-инфраструктура.md
- реализация/тесты/тесты-фаз.md

**Итого:** 19 CREATE, 0 UPDATE, 0 SKIP

---

## 2026-05-06 — fix реализация (мёртвые WikiLinks)

**Операция:** fix (dead links CT-003)
**Домен:** реализация (Реализация плагина)
**Результат:** UPDATED + CREATED

### Исправленные ссылки (замена)

| Файл | Мёртвая ссылка | Исправлена на |
|------|---------------|--------------|
| `реализация/модули/claude-cli-client.md` | `[[parse-stream-line]]` | `[[stream-ts]]` |
| `реализация/фазы/run-lint.md` | `[[parse-json-pages]]` | `[[run-ingest]]` |

### Исправленные ссылки (удаление/inline)

| Файл | Мёртвая ссылка | Решение |
|------|---------------|---------|
| `реализация/модули/vault-tools.md` | `[[vault-adapter]]` | Заменена на inline-описание (интерфейс документирован в той же странице) |

### Созданные страницы

**Модули (1):**
- реализация/модули/llm-wiki-view.md

**Фазы (1):**
- реализация/фазы/run-fix.md

**Типы (2):**
- реализация/типы/domain-entry.md
- реализация/типы/entity-type.md

**Промпты (2):**
- реализация/промпты/lint-промпт.md
- реализация/промпты/query-промпт.md

**Итого:** 6 CREATE, 3 UPDATE, 0 SKIP

---

## 2026-05-06 — init документация

**Операция:** init  
**Домен:** документация (Документация проекта)  
**Источники:** docs/ (7 файлов: dev.md, optimize.md, publishing.md, architecture/README.md, architecture/overview.yaml, architecture/diagrams/data-flow.md, architecture/diagrams/dependency-graph.md)  
**Результат:** DOMAIN REGISTERED, CREATED

### Зарегистрированные entity_types

- руководство — практические руководства и инструкции (сборка, публикация, разработка)
- компонент — архитектурные компоненты/модули плагина
- паттерн — архитектурные паттерны (Single-Flight, AsyncGenerator, Strategy)
- операция — операции плагина (ingest, query, lint, fix, init, chat)

### Созданные страницы

**Руководства (4):**
- документация/руководства/разработка-плагина.md
- документация/руководства/публикация-плагина.md
- документация/руководства/оптимизация-промптов.md
- документация/руководства/архитектура-плагина.md

**Компоненты (2):**
- документация/компоненты/wiki-controller.md
- документация/компоненты/claude-cli-client.md

**Паттерны (3):**
- документация/паттерны/single-flight-guard.md
- документация/паттерны/async-generator-events.md
- документация/паттерны/backend-strategy.md

**Операции (1):**
- документация/операции/поток-выполнения-операции.md

**Итого:** 10 CREATE, 0 UPDATE, 0 SKIP

---

## 2026-05-06 — fix реализация (lint-report)

**Операция:** fix (lint-отчёт)
**Домен:** реализация (Реализация плагина)
**Результат:** UPDATED + CREATED

### Исправления lint-отчёта

1. **CT-003 (мёртвая ссылка):** В `query-промпт.md` экранирован `[[название]]` в backticks (`` [[название]] ``) — устранён ложный WikiLink в тексте
2. **CT-003 (orphan):** В `vitest-инфраструктура.md` добавлена ссылка `[[тесты-фаз]]` в frontmatter `wiki_outgoing_links` и в секцию "Связанные концепции"
3. **CT-004 (orphan):** В `vault-tools.md` добавлены WikiLinks `[[agent-runner]]` и `[[run-ingest]]` с пояснительным контекстом; обновлён `wiki_outgoing_links`

### Ingest (новые источники)

**Модули (6):**
- реализация/модули/main-ts.md — src/main.ts (LlmWikiPlugin, команды, миграции)
- реализация/модули/modals-ts.md — src/modals.ts (все Modal компоненты)
- реализация/модули/settings-ts.md — src/settings.ts (LlmWikiSettingTab)
- реализация/модули/source-paths-ts.md — src/source-paths.ts (consolidateSourcePaths)
- реализация/модули/wiki-path-ts.md — src/wiki-path.ts (WIKI_ROOT, domainWikiFolder)
- реализация/модули/template-ts.md — src/phases/template.ts (render)

**Фазы (1):**
- реализация/фазы/run-lint-chat.md — src/phases/chat.ts (runLintChat)

**Промпты (3):**
- реализация/промпты/chat-промпт.md — prompts/chat.md
- реализация/промпты/fix-промпт.md — prompts/fix.md
- реализация/промпты/evaluator-промпт.md — prompts/evaluator.md

### wiki_sources расширение

- `тесты-фаз.md`: wiki_sources расширен с 4 до 20 файлов (все тестовые файлы из tests/)

**Итого:** 10 CREATE, 4 UPDATE, 0 SKIP

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** docs/publishing.md
**Домен:** документация

**Затронуто страниц:** 1

- ОБНОВЛЕНА: `.wiki/документация/руководства/публикация-плагина.md` (stub → developing) — добавлены разделы: Требования к описанию, Форк obsidian-releases, Тело PR шаблон; обновлены wiki_external_links и wiki_status

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** scripts/dspy/ (optimize.py, lib/loader.py, lib/backend.py, lib/optimizer.py, lib/signature.py, lib/writer.py, README.md, pyproject.toml, tests/)
**Домен:** скрипты

**Затронуто страниц:** 3

- СОЗДАНА: `.wiki/скрипты/модули/dspy-optimizer.md` (тип: модуль, status: developing)
- СОЗДАНА: `.wiki/скрипты/конфигурация/dspy-env-config.md` (тип: конфигурация, status: stub)
- СОЗДАНА: `.wiki/скрипты/пайплайны/dspy-mipro-pipeline.md` (тип: пайплайн, status: developing)

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** scripts/dspy/ (tests/test_optimizer.py, tests/test_backend.py, tests/test_loader.py, tests/test_signature.py, tests/test_writer.py)
**Домен:** скрипты

**Затронуто страниц:** 1

- ОБНОВЛЕНА: `.wiki/скрипты/модули/dspy-optimizer.md` — добавлены wiki_sources для всех тестовых файлов; раздел "Тесты" расширен детальным описанием каждого test-файла; добавлено ПРОТИВОРЕЧИЕ: test_backend.py ожидает флаг `--tools` в argv, которого нет в текущем backend.py

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** scripts/dspy/tests/test_backend.py
**Домен:** скрипты

**Затронуто страниц:** 1

- ОБНОВЛЕНА: `.wiki/скрипты/модули/dspy-optimizer.md` — удалено ПРОТИВОРЕЧИЕ (assert "--tools" убран из test_backend.py); описание теста `forward()` обновлено: флаг `--tools` исключён из проверяемых argv-флагов

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** scripts/dspy/tests/test_backend.py
**Домен:** скрипты

**Затронуто страниц:** 1

- ОБНОВЛЕНА: `.wiki/скрипты/модули/dspy-optimizer.md` — раздел test_backend.py актуализирован: вызовы `forward()` заменены на `lm(prompt=...)` / `lm(messages=[...])` (через `__call__`); `make_lm()` теперь без аргументов, читает env vars через `monkeypatch.setenv`; атрибут `lm.model` имеет формат `"claude-code/{CLAUDE_MODEL}"`

---

## 2026-05-06T00:00:00

**Операция:** ingest
**Источник:** scripts/dspy/tests/test_backend.py
**Домен:** скрипты

**Затронуто страниц:** 0

- ПРОПУЩЕНА: `.wiki/скрипты/модули/dspy-optimizer.md` — источник уже в wiki_sources; изменение (удаление `assert "--tools" in args`) уже отражено в описании теста на странице (флаг `--tools` не упоминается); новой информации нет

---

## 2026-05-07T00:00:00

**Операция:** ingest
**Источник:** prompts/optimized/ingest.md
**Домен:** реализация

**Затронуто страниц:** 1

- ОБНОВЛЕНА: `.wiki/реализация/промпты/ingest-промпт.md` — добавлен раздел "История изменений" с результатом DSPy MIPROv2 оптимизации; wiki_sources расширен источником `prompts/optimized/ingest.md`; добавлена ссылка `[[dspy-mipro-pipeline]]` в wiki_outgoing_links и "Связанные концепции"

**Примечание:** Оптимизированный вариант промпта (prompts/optimized/ingest.md) совпал с исходным prompts/ingest.md — DSPy не внёс изменений. Файл удалён из рабочего дерева (D в git status).

---

## 2026-05-08T00:00:00 — ingest v0.1.61

**Операция:** ingest (batch)
**Источники:** src/mobile-fetch.ts, src/effective-settings.ts, src/local-config.ts, src/controller.ts, src/settings.ts, src/main.ts, src/agent-runner.ts, src/vault-tools.ts, src/phases/query.ts
**Домен:** реализация

**Затронуто страниц:** 9 (создано 2, обновлено 7)

- СОЗДАНА: `.wiki/реализация/модули/mobile-fetch.md` — новый модуль `mobile-fetch.ts` (адаптер `fetch` через Obsidian `requestUrl()` для обхода CORS на мобильной платформе)
- СОЗДАНА: `.wiki/реализация/модули/effective-settings.md` — новый модуль `effective-settings.ts` (`resolveEffective()` — слияние synced `LlmWikiPluginSettings` + per-device `LocalConfig` overlay)
- ОБНОВЛЕНА: `.wiki/реализация/модули/local-config.md` — расширен тип `LocalConfig` (добавлены `backend`, `agentLogEnabled`, `claudeAgent`, `nativeAgent`, `migrated_v1`); расширено описание per-device overlay; ссылка на [[effective-settings]]
- ОБНОВЛЕНА: `.wiki/реализация/модули/wiki-controller.md` — описана интеграция с `resolveEffective()` (выбор backend, build OpenAI/Claude клиента); mobile guards (`Platform.isMobile`, `cwdOrEmpty()`); подключение `mobileFetch` для OpenAI клиента; ссылки на [[effective-settings]] и [[mobile-fetch]]
- ОБНОВЛЕНА: `.wiki/реализация/модули/settings-ts.md` — описаны patch-хелперы (`patchLocal`/`patchLocalNative`/`patchLocalClaude`); все machine-specific и чувствительные поля пишутся в `LocalConfig`; mobile-only UI (скрыт backend dropdown, dev-mode, claude-agent); `localCache: LocalConfig` вместо `cachedIclaudePath`
- ОБНОВЛЕНА: `.wiki/реализация/модули/main-ts.md` — добавлен шаг `migrateToLocalV1()` в onload; описан перенос backend/native/claude/agentLogEnabled из synced в `LocalConfig` + scrub `apiKey`; mobile-форсинг backend и off-флагов в `loadSettings()`; команды ingest/lint/init только на десктопе
- ОБНОВЛЕНА: `.wiki/реализация/модули/agent-runner.md` — `dev.jsonl` пишется через `vaultTools.adapter` в `!Logs/dev.jsonl` (mobile-compatible); обновлена `wiki_updated`
- ОБНОВЛЕНА: `.wiki/реализация/модули/vault-tools.md` — в `VaultAdapter` явно описан метод `append`; пояснение зачем используется (`logEvent`, `writeDevLog`)
- ОБНОВЛЕНА: `.wiki/реализация/фазы/run-query.md` — детализирован алгоритм (vault-relative пути, мета-файлы, лимиты контекста, fallback non-streaming); отмечена mobile-совместимость; ссылка на [[wiki-path-ts]]

**Примечание:** Изменения соответствуют v0.1.61 — мобильная поддержка (CORS bypass через `requestUrl`) + per-device overlay для backend/credentials с однократной миграцией из synced `data.json`.

---

## 2026-05-12 — ingest реализация

**Операция:** ingest  
**Домен:** реализация (Реализация плагина)  
**Источники:**
- `src/utils/raw-frontmatter.ts`
- `src/phases/ingest.ts`
- `src/phases/lint.ts`

**Результат:**
- СОЗДАНА: `.wiki/реализация/модули/raw-frontmatter-ts.md` — новый модуль (upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm)
- ОБНОВЛЕНА: `.wiki/реализация/фазы/run-ingest.md` — добавлена секция «Запись backlinks в source-файл» (upsertRawFrontmatter, wiki_added/wiki_updated/wiki_articles); обновлена ссылка на [[raw-frontmatter-ts]]
- ОБНОВЛЕНА: `.wiki/реализация/фазы/run-lint.md` — статус stub→developing; детализирован 3-фазный алгоритм (LLM-аудит, actualizeDomainConfig, fix-pass, backlink sync); документированы checkStructure, computeEntityDiff, META_FILES; добавлены ссылки на [[raw-frontmatter-ts]] и [[domain-entry]]

---
