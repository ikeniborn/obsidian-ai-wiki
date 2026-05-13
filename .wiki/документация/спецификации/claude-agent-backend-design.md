---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [спецификация, backend, claude-agent]
---

# Claude-Agent Backend — Design Spec

Дата: 2026-04-29. Замена backend `claude-code` (IclaudeRunner) на `claude-agent` с TypeScript-оркестрацией через AgentRunner + ClaudeCliClient.

## Ключевые изменения

- `IclaudeRunner` удалён; оркестрацию берут TypeScript-фазы (AgentRunner)
- `LlmClient` — единый тип интерфейса для обоих backend
- `ClaudeCliClient` реализует `LlmClient` через spawn + readline
- `AgentRunner` принимает `llm: LlmClient` в конструкторе (не создаёт внутри)

## Settings

`claudeAgent` объект в `LlmWikiPluginSettings`:
- `iclaudePath`: путь к `claude` / `iclaude.sh`
- `model`: имя модели
- `systemPrompt`: добавляется через `buildOpts()`
- `maxTokens`, `requestTimeoutSec`

Per-device поля (не синхронизируются): `backend`, `iclaudePath`, `model`, `apiKey` → переехали в `local.json`.

## Spawn args порядок

```
iclaude.sh [--no-proxy] [--model M] -- -p <userContent> --output-format stream-json --verbose
```

Флаги iclaude до `--`, флаги claude после.

## Обратная совместимость

При первой загрузке `backend: "claude-code"` мигрирует → `"claude-agent"`, `iclaudePath` копируется из top-level.

## Связанные страницы

- [[backend-strategy]]
- [[claude-cli-client]]
- [[wiki-controller]]
