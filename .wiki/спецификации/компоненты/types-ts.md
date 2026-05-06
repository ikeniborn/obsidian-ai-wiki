---
wiki_sources:
  - "docs/superpowers/specs/2026-04-27-interactive-mode-design.md"
  - "docs/superpowers/specs/2026-04-27-multi-vault-domain-maps-design.md"
  - "docs/superpowers/specs/2026-04-28-native-agent-design.md"
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
  - "docs/superpowers/specs/2026-04-29-per-operation-models-design.md"
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
  - "docs/superpowers/specs/2026-05-04-dev-mode-prompt-management-design.md"
  - "docs/superpowers/specs/2026-05-05-chat-after-all-operations-design.md"
  - "docs/superpowers/specs/2026-05-05-domain-populate-design.md"
wiki_updated: 2026-05-05
wiki_status: developing
tags:
  - specs
  - component
  - typescript
  - types
aliases:
  - "LlmWikiPluginSettings"
  - "RunEvent"
  - "src/types.ts"
---

# src/types.ts

Центральный модуль TypeScript-типов плагина. Хранит `LlmWikiPluginSettings`, `RunEvent` union, `DomainEntry`, `WikiOperation` и сопутствующие интерфейсы. Изменяется при каждой крупной фиче.

## Ключевые изменения по спекам

- **`WikiDomain`**: с `"ии" | "ростелеком" | "базы-данных"` → `string` (Multi-Vault Domain Maps)
- **`RunEvent` union**: добавлены `ask_user`, `domain_created`, `populate_start`, `file_start`, `file_done`, `eval_result`
- **`LlmWikiPluginSettings`**: добавлены `backend`, `nativeAgent`, `claudeAgent`, `domains: DomainEntry[]`, `devMode: DevModeSettings`; удалены `cwd`, `allowedTools`, top-level `model`, `showRawJson`
- **`NativeAgentSettings`**: добавлены `domainMapDir`, `perOperation`, `operations: OpMap<NativeOperationConfig>`
- **`ClaudeAgentSettings`**: `iclaudePath`, `model`, `domainMapDir`, `systemPrompt`, `maxTokens`, `requestTimeoutSec`, `perOperation`, `operations`
- **`DevModeSettings`**: `enabled`, `logDir`, `evaluatorModel`
- **`LlmClient`**: минимальный интерфейс `chat.completions.create()` для `claude-agent` и `native-agent` бэкендов
- **`OpMap<T>`**: `{ ingest, query, lint, init }`; `ClaudeOperationConfig`, `NativeOperationConfig`
- **`RunHistoryEntry`**: добавлено опциональное `domainId?: string`
- **`AddDomainInput`**: расширен полем `sourcePaths: string[]`

## Связанные концепции

- [[claude-agent-backend]]
- [[native-agent]]
- [[per-operation-models]]
- [[domain-map-in-vault]]
- [[dev-mode-prompt-management]]
