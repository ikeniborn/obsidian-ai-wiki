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

### Домен: скрипты (Вспомогательные скрипты)

#### скрипты/модули

- [[dspy-optimizer]] — DSPy Prompt Optimizer (optimize.py + lib/)

#### скрипты/конфигурация

- [[dspy-env-config]] — Конфигурация DSPy оптимизатора (.env)

#### скрипты/пайплайны

- [[dspy-mipro-pipeline]] — DSPy MIPROv2 Оптимизационный пайплайн
