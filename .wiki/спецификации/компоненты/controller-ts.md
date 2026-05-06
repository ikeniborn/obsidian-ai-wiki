---
wiki_sources:
  - "docs/superpowers/specs/2026-04-27-interactive-mode-design.md"
  - "docs/superpowers/specs/2026-04-28-domain-map-native-agent-design.md"
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
  - "docs/superpowers/specs/2026-05-05-chat-after-all-operations-design.md"
  - "docs/superpowers/specs/2026-05-05-vault-relative-paths-design.md"
wiki_updated: 2026-05-05
wiki_status: developing
tags:
  - specs
  - component
  - typescript
aliases:
  - "WikiController"
  - "src/controller.ts"
---

# src/controller.ts

Single-flight контроллер операций плагина. Маршрутизирует запросы к backend (AgentRunner), управляет жизненным циклом операции, обрабатывает специальные события (`ask_user`, `domain_created`), логирует в JSONL.

## Ключевые изменения по спекам

- **Interactive mode**: при `ask_user` событии — `await view.showQuestionModal()`, затем `runner.sendToolResult()`; single-flight guard активен пока modal открыт
- **`resolveDomainMapDir()`**: helper для определения пути к domain-map файлу; для `native-agent` — `domainMapDir` или авто `vault/.obsidian/plugins/llm-wiki/`
- **`requireClaudeAgent()`**: заменяет `requireSkillPath()` — проверяет только `claudeAgent.iclaudePath`
- **`dispatch()`**: обработка `domain_created` событие → `settings.domains.push(ev.entry) + saveSettings()`
- **`loadDomains()`**: `return this.plugin.settings.domains ?? []` (без файлового I/O)
- **`lintChat()` → `chat()`**: переименование + параметр `operation: WikiOperation`; `dispatchChat()` логирует события
- **Vault-relative paths**: `vaultRoot = vaultBasePath` (без вычисления `repoRoot`)
- **`populate()`**: новый метод; передаёт `onFileError` callback в `RunRequest`

## Удалено

- `requireSkillPath()`, `resolveCwd()`, `cwdOrEmpty()`, ветка `backend === "claude-code"`
- `resolveDomainMapDir()` (после переноса доменов в data.json)

## Связанные концепции

- [[interactive-mode]]
- [[domain-map-in-vault]]
- [[vault-relative-paths]]
- [[chat-after-all-operations]]
