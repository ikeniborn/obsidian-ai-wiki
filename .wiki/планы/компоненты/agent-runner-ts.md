---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-04-29-per-operation-models.md, docs/superpowers/plans/2026-05-05-chat-after-all-operations.md, docs/superpowers/plans/2026-05-05-vault-relative-paths.md, docs/superpowers/plans/2026-05-05-devmode-logdir.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [AgentRunner, агент-раннер]
---
# src/agent-runner.ts

`AgentRunner` — оркестратор native-agent бэкенда. Маршрутизирует операции на соответствующие phase-функции, управляет LlmClient и логированием dev-режима.

## Основные характеристики

- Класс принимает `LlmClient`, `VaultTools`, `DomainEntry[]`, `vaultName`, `settings`
- `run(req: RunRequest)` — публичный метод, возвращает `AsyncGenerator<RunEvent>`
- `runOperation(req, model, opts, vaultRoot, domains)` — внутренняя маршрутизация по `req.operation`
- `buildOptsFor(op: OpKey)` — формирует `LlmCallOptions` с учётом per-operation конфигурации
- `writeDevLog(entry)` — записывает в `<devMode.logDir>/dev.jsonl` при включённом dev-режиме
- `updateDevLogEval(entry)` — дополняет последнюю запись результатом evaluator-фазы

## Изменения по планам

| Фича | Изменение |
|---|---|
| Native Agent | Создан |
| Per-Operation Models | `buildOpts()` → `buildOptsFor(op)` |
| Dev Mode | `writeDevLog`, `updateDevLogEval`, evaluator-фаза |
| Chat After All Ops | `runLintChat` получает `operationHeader` параметр |
| Vault-relative Paths | `repoRoot` → `vaultRoot` во всех phase-вызовах |
| devMode logDir | `logPath` → `join(logDir, "dev.jsonl")` |
