---
wiki_sources:
  - "docs/superpowers/specs/2026-04-29-per-operation-models-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - models
  - configuration
aliases:
  - "Per-Operation Model Configuration"
  - "perOperation"
---

# Per-Operation Models (настройка модели на операцию)

Добавляет раздельную конфигурацию модели, `maxTokens` и `temperature` для каждой из четырёх операций (ingest, query, lint, init). Применимо для обоих backend (`claude-agent` и `native-agent`). Toggle `perOperation` переключает между режимом «одна модель» и «своя модель для каждой операции».

## Основные характеристики

- **Мотивация**: разные операции требуют разных cost/quality компромиссов — ingest/lint можно делать быстрой/дешёвой моделью, query — качественной, init — мощной
- **Новые интерфейсы**: `ClaudeOperationConfig { model, maxTokens }`, `NativeOperationConfig { model, maxTokens, temperature }`, `OpMap<T> = { ingest, query, lint, init }`
- **`claudeAgent.perOperation`**: если true — каждая операция из `operations.*`; если false — общий `model`
- **`nativeAgent.perOperation`**: аналогично; `topP` и `numCtx` всегда глобальные
- **`buildOptsFor(op)`**: метод `AgentRunner`, заменяет `buildOpts()`; возвращает `{ model, opts }` с учётом флага и backend
- **`ClaudeCliClient`**: исправление — использует `params.model` вместо `this.cfg.model` (с fallback)
- **UI**: toggle `perOperation` перерисовывает секцию; при включении — 4 подсекции с полями модели/токенов/температуры

## Дефолты для claude-agent

```
ingest: { model: "haiku", maxTokens: 4096 }
query:  { model: "sonnet", maxTokens: 4096 }
lint:   { model: "haiku", maxTokens: 4096 }
init:   { model: "sonnet", maxTokens: 8192 }
```

## Связанные концепции

- [[claude-agent-backend]]
- [[native-agent]]
- [[agent-runner-ts]]
