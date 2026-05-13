---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
  - docs/superpowers/specs/2026-05-04-agent-base-contract-design.md
wiki_updated: 2026-05-13
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

## Связанные страницы

- [[wiki-controller]]
- [[claude-cli-client]]
- [[async-generator-events]]
