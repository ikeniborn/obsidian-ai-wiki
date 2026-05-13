---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [компонент, controller, orchestrator]
---

# WikiController

Центральный оркестратор плагина. Управляет жизненным циклом операций, single-flight guard-ом, состоянием pending format, историей запусков.

## Назначение

`WikiController` (`src/controller.ts`) — единственная точка входа из UI в логику плагина. View вызывает методы контроллера, контроллер создаёт `AgentRunner`, диспатчит операции и обновляет настройки по событиям.

## Ключевые методы

| Метод | Описание |
|---|---|
| `dispatch(op, args, …)` | Запускает операцию через AgentRunner; защищён single-flight guard |
| `ingestActive()` | Ingest активного файла в vault |
| `query(q, save?)` | Запрос к wiki с опциональным сохранением |
| `lint(domainId)` | Проверка качества wiki-домена |
| `init(domainId)` | Первичная инициализация домена |
| `format()` | Форматирование не-wiki файла; guard по wiki-папке |
| `formatApply()` | Применить preview к оригиналу, удалить temp |
| `formatCancel()` | Удалить temp, сбросить pending state |
| `formatRefine(msg)` | Добавить сообщение в chat history, редиспатчить format |
| `buildAgentRunner(vaultRoot)` | Фабрика AgentRunner + выбор LlmClient по backend |

## Состояние

- `this.current: AbortController | null` — single-flight guard. При `!= null` новые dispatch отклоняются с Notice.
- `this._pendingFormat` — состояние активного format preview: `{ originalPath, tempPath, chat: ChatMessage[] }`.

## buildAgentRunner

Создаёт `LlmClient` в зависимости от `settings.backend`:
- `"claude-agent"` → `new ClaudeCliClient(settings.claudeAgent)`
- `"native-agent"` → `new OpenAI({ baseURL, apiKey, … })`

Передаёт клиент в `new AgentRunner(llm, settings, vaultTools, vaultName, domains)`.

## Mobile gating

В `dispatch()` операции `ingest`/`lint`/`fix`/`init`/`chat` отклоняются на mobile с Notice. Разрешены: `query`, `query-save`, `format`.

## Связанные страницы

- [[agent-runner]]
- [[claude-cli-client]]
- [[single-flight-guard]]
- [[format-operation]]
