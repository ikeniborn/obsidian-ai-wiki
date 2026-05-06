---
wiki_sources: [docs/superpowers/plans/2026-04-27-interactive-mode.md, docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-04-29-claude-agent-backend.md, docs/superpowers/plans/2026-04-30-domain-map-in-vault.md, docs/superpowers/plans/2026-05-05-chat-after-all-operations.md, docs/superpowers/plans/2026-05-05-chat-session-resume.md, docs/superpowers/plans/2026-05-05-source-path-auto-add.md, docs/superpowers/plans/2026-05-05-vault-relative-paths.md]
wiki_updated: 2026-05-05
wiki_status: mature
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [WikiController, контроллер]
---
# src/controller.ts

`WikiController` — центральный оркестратор плагина. Реализует single-flight guard, маршрутизацию по бэкендам, управление доменами и чат-сессиями.

## Основные характеристики

- Single-flight: `this._running` блокирует параллельный запуск операций
- Метод `dispatch(op, args, domainId, context, instruction)` — точка входа для всех операций
- `buildAgentRunner(vaultRoot, resumeSessionId?)` — фабрика AgentRunner с конфигурацией из settings
- `dispatchChat(operation, domainId, context, chatMessages)` — отдельный путь для чат-операции
- `registerDomain(id, input)` — создание нового домена в `settings.domains[]`

## Изменения по планам

| Фича | Изменение |
|---|---|
| Domain Map in Vault | Handler `domain_created` → `plugin.saveSettings()` |
| Chat After All Ops | `lintChat()` → `chat(operation, domainId, context, history, msg)` |
| Chat Session Resume | `_chatSessionId` хранится и передаётся в `buildAgentRunner`; сброс при ошибке и при не-chat операции |
| Source Path Auto-Add | Handler `source_path_added` использует `consolidateSourcePaths` |
| E2BIG Fix | Передаёт `tmpDir` в `ClaudeCliClient` |
| Vault-relative Paths | Убирается вычисление `repoRoot` через vaultSuffix; `registerDomain` убирает `vaults/<name>/` prefix |
