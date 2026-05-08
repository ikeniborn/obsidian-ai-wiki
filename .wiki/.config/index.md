# Wiki Index

<!-- Этот файл обновляется автоматически при ingest/init/query --save -->

## Страницы по доменам

### Домен: планы (Планы реализации)

#### планы/фичи

- [[collapsible-progress-display]] — Collapsible Progress Display
- [[interactive-mode]] — Interactive Mode (Ask User)
- [[native-agent]] — Native Agent (AgentRunner)
- [[claude-agent-backend]] — Claude Agent Backend (ClaudeCliClient)
- [[domain-map-in-vault]] — Domain Map в Vault (хранение доменов)
- [[per-operation-models]] — Per-Operation Models
- [[dev-mode-prompt-management]] — Dev Mode и управление промптами
- [[dspy-prompt-optimization]] — DSPy / MIPROv2 Оптимизация промптов
- [[wiki-init-root-files]] — Wiki Init Root Files (ensureRootFiles)
- [[chat-after-all-operations]] — Chat After All Operations
- [[chat-session-resume]] — Chat Session Resume
- [[e2big-fix]] — E2BIG Fix — Temp Files для больших промптов
- [[source-path-auto-add]] — Source Path Auto-Add с Consolidation
- [[vault-relative-paths]] — Vault-Relative Paths
- [[domain-form-ux]] — Domain Form UX (EditDomainModal)
- [[links-frontmatter]] — Links → Frontmatter
- [[obsidian-review-fixes]] — ObsidianReviewBot Required Fixes
- [[agent-base-contract]] — Agent Base Contract (base.md)
- [[chat-feedback]] — Chat Feedback (Animated Timer)

#### планы/компоненты

- [[view-ts]] — src/view.ts
- [[controller-ts]] — src/controller.ts
- [[agent-runner-ts]] — src/agent-runner.ts
- [[claude-cli-client-ts]] — src/claude-cli-client.ts
- [[types-ts]] — src/types.ts
- [[phases-ts]] — src/phases/*.ts (Phase Functions)
- [[stream-ts]] — src/stream.ts
- [[settings-ts]] — src/settings.ts
- [[modals-ts]] — src/modals.ts

#### планы/паттерны

- [[async-generator-events]] — AsyncGenerator / Event-Driven Stream (RunEvent)
- [[single-flight]] — Single-Flight Guard
- [[tdd-vitest]] — TDD с Vitest
- [[vault-relative-path-pattern]] — Vault-Relative Path Pattern
- [[esbuild-text-loader]] — esbuild Text Loader для .md файлов

### Домен: спецификации (Спецификации дизайна)

#### спецификации/фичи

- [[collapsible-progress-display]] — Collapsible Progress Display (раскрывающийся блок прогресса)
- [[interactive-mode]] — Interactive Mode (интерактивный режим iclaude)
- [[multi-vault-domain-maps]] — Multi-Vault Domain Maps (vault-специфичные карты доменов)
- [[native-agent]] — Native Agent (нативный агент)
- [[domain-map-native-agent]] — Domain Map Storage для Native Agent
- [[obsidian-review-fixes]] — Obsidian Review Fixes (исправления для публикации)
- [[claude-agent-backend]] — Claude-Agent Backend (ClaudeCliClient)
- [[per-operation-models]] — Per-Operation Models (настройка модели на операцию)
- [[domain-map-in-vault]] — Domain Map в Vault (хранение доменов в data.json)
- [[agent-base-contract]] — Agent Base Contract (prompts/base.md)
- [[chat-feedback]] — Chat Feedback (анимированный таймер + сворачиваемый чат)
- [[dev-mode-prompt-management]] — Dev Mode и управление промптами
- [[dspy-prompt-optimization]] — DSPy / MIPROv2 Оптимизация промптов
- [[wiki-init-root-files]] — Wiki Init Root Files (ensureRootFiles)
- [[chat-after-all-operations]] — Chat After All Operations
- [[devmode-logdir]] — DevMode logDir (logPath → logDir)
- [[domain-form-ux]] — Domain Form UX (EditDomainModal)
- [[domain-populate]] — Domain Populate (наполнение домена при создании)
- [[e2big-fix]] — E2BIG Fix — Temp Files для больших промптов
- [[links-frontmatter]] — Links → Frontmatter (исходящие ссылки в YAML)
- [[vault-relative-paths]] — Vault-Relative Paths (пути относительно vault)

#### спецификации/компоненты

- [[claude-cli-client-ts]] — src/claude-cli-client.ts
- [[agent-runner-ts]] — src/agent-runner.ts
- [[controller-ts]] — src/controller.ts
- [[view-ts]] — src/view.ts
- [[types-ts]] — src/types.ts
- [[modals-ts]] — src/modals.ts

#### спецификации/паттерны

- [[llm-client-interface]] — LlmClient (интерфейс абстракции backend)
- [[domain-created-event]] — domain_created Event (паттерн сохранения через события)
- [[hybrid-orchestration]] — Гибридная оркестрация (TypeScript + LLM)
- [[esbuild-md-loader]] — esbuild MD Loader (встраивание Markdown при сборке)

### Домен: документация (Документация проекта)

#### документация/руководства

- [[разработка-плагина]] — Руководство разработчика (сборка, установка, smoke-test)
- [[публикация-плагина]] — Публикация плагина в Obsidian Community Plugins
- [[оптимизация-промптов]] — Оптимизация промптов через DSPy / MIPROv2
- [[архитектура-плагина]] — Архитектура плагина obsidian-llm-wiki

#### документация/компоненты

- [[wiki-controller]] — WikiController (controller.ts)
- [[claude-cli-client]] — ClaudeCliClient (claude-cli-client.ts)

#### документация/паттерны

- [[single-flight-guard]] — Single-Flight Guard
- [[async-generator-events]] — AsyncGenerator / Event-Driven Stream (RunEvent)
- [[backend-strategy]] — Backend Strategy Pattern (LlmClient)

#### документация/операции

- [[поток-выполнения-операции]] — Поток выполнения операции

### Домен: скрипты (Вспомогательные скрипты)

#### скрипты/модули

- [[dspy-optimizer]] — DSPy Prompt Optimizer (optimize.py + lib/)

#### скрипты/конфигурация

- [[dspy-env-config]] — Конфигурация DSPy оптимизатора (.env)

#### скрипты/пайплайны

- [[dspy-mipro-pipeline]] — DSPy MIPROv2 Оптимизационный пайплайн

### Домен: реализация (Реализация плагина)

#### реализация/модули

- [[agent-runner]] — AgentRunner (agent-runner.ts)
- [[claude-cli-client]] — ClaudeCliClient (claude-cli-client.ts)
- [[vault-tools]] — VaultTools (vault-tools.ts)
- [[stream-ts]] — parseStreamLine (stream.ts)
- [[wiki-controller]] — WikiController (controller.ts)
- [[llm-wiki-view]] — LlmWikiView (view.ts)
- [[domain-map-ts]] — domain.ts (DomainEntry, EntityType, applyDomainEvent)
- [[domain-store]] — DomainStore (domain-store.ts) — vault-bound карта доменов
- [[local-config]] — LocalConfigStore (local-config.ts) — per-device overlay (iclaudePath, backend, API)
- [[effective-settings]] — resolveEffective (effective-settings.ts) — слияние synced + local
- [[mobile-fetch]] — mobileFetch (mobile-fetch.ts) — fetch на базе Obsidian requestUrl
- [[llm-utils-ts]] — llm-utils.ts (buildChatParams, extractStreamDeltas)
- [[main-ts]] — main.ts (точка входа плагина, LlmWikiPlugin)
- [[modals-ts]] — modals.ts (Modal компоненты)
- [[settings-ts]] — settings.ts (LlmWikiSettingTab)
- [[source-paths-ts]] — source-paths.ts (consolidateSourcePaths)
- [[wiki-path-ts]] — wiki-path.ts (WIKI_ROOT, domainWikiFolder)
- [[template-ts]] — phases/template.ts (render)

#### реализация/фазы

- [[run-ingest]] — runIngest (phases/ingest.ts)
- [[run-init]] — runInit (phases/init.ts)
- [[run-query]] — runQuery (phases/query.ts)
- [[run-lint]] — runLint (phases/lint.ts)
- [[run-fix]] — runFix (phases/fix.ts)
- [[run-lint-chat]] — runLintChat (phases/chat.ts)

#### реализация/типы

- [[run-event]] — RunEvent (union-тип событий)
- [[llm-client]] — LlmClient (интерфейс backend)
- [[llm-wiki-plugin-settings]] — LlmWikiPluginSettings (конфигурация плагина)
- [[domain-entry]] — DomainEntry (конфигурация домена)
- [[entity-type]] — EntityType (описание типа сущности)

#### реализация/промпты

- [[ingest-промпт]] — Ingest промпт (prompts/ingest.md)
- [[init-промпт]] — Init промпт (prompts/init.md)
- [[base-contract-промпт]] — Base Contract промпт (prompts/base.md)
- [[lint-промпт]] — Lint промпт (prompts/lint.md)
- [[query-промпт]] — Query промпт (prompts/query.md)
- [[chat-промпт]] — Chat промпт (prompts/chat.md)
- [[fix-промпт]] — Fix промпт (prompts/fix.md)
- [[evaluator-промпт]] — Evaluator промпт (prompts/evaluator.md)

#### реализация/тесты

- [[vitest-инфраструктура]] — Vitest инфраструктура тестирования
- [[тесты-фаз]] — Тесты фазовых функций (tests/phases/)
