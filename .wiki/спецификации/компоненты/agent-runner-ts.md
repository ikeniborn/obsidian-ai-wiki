---
wiki_sources:
  - "docs/superpowers/specs/2026-04-28-native-agent-design.md"
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
  - "docs/superpowers/specs/2026-04-29-per-operation-models-design.md"
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
wiki_updated: 2026-05-05
wiki_status: developing
tags:
  - specs
  - component
  - typescript
aliases:
  - "AgentRunner"
  - "src/agent-runner.ts"
---

# src/agent-runner.ts

Оркестратор фазовых операций нативного агента. Принимает `LlmClient` как первый аргумент, реализует тот же интерфейс `execute(req, signal): AsyncGenerator<RunEvent>` что и `IclaudeRunner`. Маршрутизирует операции к соответствующим фазовым функциям.

## Основные характеристики

- **Конструктор**: `AgentRunner(llm: LlmClient, settings, vaultTools, vaultName, domains)`; создание клиента вынесено в `controller.buildAgentRunner()`
- **`buildOptsFor(op)`**: backend-aware метод, заменяющий `buildOpts()`; возвращает `{ model, opts }`; учитывает `perOperation` флаг и backend
- **`run()`**: перебирает `RunRequest`, вызывает нужную фазу; при `devMode.enabled` вызывает `runEvaluator()` после операции
- **`populate`**: case в `run()` для передачи `onFileError` callback из `RunRequest` в `runPopulate()`
- **Удалено поле**: `private domainMapDir` (перенесено в `controller` → `settings.domains`)
- **i18n**: новые ключи для per-operation toggle в `src/i18n.ts`

## Связанные концепции

- [[claude-agent-backend]]
- [[native-agent]]
- [[per-operation-models]]
- [[domain-map-in-vault]]
