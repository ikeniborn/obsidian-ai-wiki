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
