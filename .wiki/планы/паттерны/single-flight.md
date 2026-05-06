---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-04-29-claude-agent-backend.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [single-flight-guard, одна-операция]
---
# Single-Flight Guard

Паттерн предотвращения параллельного запуска операций. `WikiController` отклоняет любой новый запрос пока выполняется текущая операция.

## Основные характеристики

- Поле `this._running: boolean` (или `this.current: AbortController | null`) в `WikiController`
- При попытке параллельного запуска: `new Notice(i18n().ctrl.operationRunning); return;`
- Освобождается в `finally`-блоке `dispatch()` — гарантированное снятие блокировки
- Обоснование: iclaude.sh не реентерабелен; параллельный spawn испортит stdout-поток

## Реализация

```typescript
private async dispatch(op, args, ...): Promise<void> {
  if (this.isBusy()) {
    new Notice(i18n().ctrl.operationRunning);
    return;
  }
  this.current = new AbortController();
  try {
    // ... операция
  } finally {
    this.current = null;
  }
}
```

## Взаимодействие с UI

`LlmWikiView` проверяет `controller.currentOp` для отображения состояния "выполняется". Кнопки операций должны блокироваться на время выполнения.
