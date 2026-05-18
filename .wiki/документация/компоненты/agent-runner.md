---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
  - docs/superpowers/specs/2026-05-04-agent-base-contract-design.md
  - docs/superpowers/specs/2026-05-15-max-tokens-relocate-numctx-drop-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [компонент, runner, маршрутизация]
---

# AgentRunner

Маршрутизатор операций. Принимает `RunRequest`, выбирает нужную phase-функцию, выбирает модель, строит `LlmCallOptions`.

## Назначение

`AgentRunner` (`src/agent-runner.ts`) получает от контроллера единый объект `RunRequest` и запускает соответствующую фазу как `AsyncGenerator<RunEvent>`. Содержит `writeDevLog` / `updateDevLogEval` для dev-режима — пишет через `VaultTools.adapter` (работает и на mobile).

## Сигнатура run()

```ts
async *run(req: RunRequest): AsyncGenerator<RunEvent>
```

`RunRequest` включает: `operation`, `args`, `cwd`, `signal`, `timeoutMs`, `domainId`, `context`, `instruction`, `onFileError`, `chatMessages`.

## Маршрутизация

| `operation` | Фаза |
|---|---|
| `"ingest"` | `runIngest` |
| `"query"` / `"query-save"` | `runQuery` |
| `"lint"` | `runLint` |
| `"fix"` | `runFix` |
| `"init"` | `runInit` |
| `"chat"` | `runChat` |
| `"format"` | `runFormat` |

## Выбор модели

`buildOpts()` — backend-aware: для `claude-agent` берёт `claudeAgent.operations[op].model`; для `native-agent` — `nativeAgent.operations[op].model`.

## Build options (native, schema v3)

`buildOptsFor` для `native-agent` (после v0.1.100):
- per-op off: `maxTokens: na.maxTokens` (новое поле — раньше брался top-level `s.maxTokens`)
- per-op on: `maxTokens: c.maxTokens` (per-operation override)
- `numCtx` удалён из `LlmCallOptions` — Ollama OpenAI-route его игнорирует.

См. [[max-tokens-relocate-design]] и [[max-tokens-relocate-plan]].

## Связанные страницы

- [[wiki-controller]]
- [[claude-cli-client]]
- [[async-generator-events]]
- [[max-tokens-relocate-design]]
