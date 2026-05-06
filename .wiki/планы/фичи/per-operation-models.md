---
wiki_sources: [docs/superpowers/plans/2026-04-29-per-operation-models.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [per-op-config, операционные-модели]
---
# Per-Operation Models

Фича добавляет независимую конфигурацию модели, maxTokens и temperature для каждой wiki-операции (ingest, query, lint, init).

## Основные характеристики

- Новые типы: `OpKey` (union операций), `OpMap<T>` (маппинг операции → значение), `ClaudeOperationConfig`, `NativeOperationConfig`
- `AgentRunner.buildOpts()` переименовывается в `buildOptsFor(op: OpKey)`
- В настройках добавляется секция с переключателем per-operation, при включении каждая операция получает свою sub-секцию
- При выключенном per-operation режиме используются глобальные настройки модели
- Дефолтные значения наследуются от верхнеуровневых настроек при создании per-op конфига

## Типы

```typescript
type OpKey = "ingest" | "query" | "query-save" | "lint" | "init";
type OpMap<T> = Partial<Record<OpKey, T>>;

interface ClaudeOperationConfig {
  model?: string;
  perOperation?: OpMap<{ model: string }>;
}

interface NativeOperationConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  perOperation?: OpMap<{ model?: string; maxTokens?: number; temperature?: number }>;
}
```
