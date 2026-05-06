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
