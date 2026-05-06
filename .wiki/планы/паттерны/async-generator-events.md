---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-04-27-interactive-mode.md, docs/superpowers/plans/2026-04-30-domain-map-in-vault.md, docs/superpowers/plans/2026-05-05-source-path-auto-add.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [RunEvent-stream, event-driven-architecture]
---
# AsyncGenerator / Event-Driven Stream (RunEvent)

Центральный архитектурный паттерн плагина: все wiki-операции реализованы как `async function*` генераторы, эмитирующие типизированные события `RunEvent`.

## Основные характеристики

- Каждая phase-функция — `AsyncGenerator<RunEvent>`, не возвращает значение напрямую
- `AgentRunner.run()` и `WikiController.dispatch()` итерируют события через `for await`
- `LlmWikiView.onEvent()` рендерит события в реальном времени (live UI)
- Событийная модель позволяет добавлять новые типы событий без изменения существующих потребителей

## Типы событий

| Kind | Источник | Потребитель |
|---|---|---|
| `tool_use` | Phase-функции | View (рендер шага) |
| `tool_result` | Phase-функции | View |
| `assistant_text` | LLM streaming | View (live текст) |
| `result` | Phase-функции | Controller (история), View |
| `error` | Любой | Controller, View |
| `source_path_added` | ingest.ts | Controller (сохранение) |
| `domain_created` | init.ts | Controller (settings) |
| `domain_updated` | lint.ts | Controller (settings) |
| `ask_user` | Phase (interactive) | Controller → Modal |
| `system` | stream.ts (iclaude) | View, Controller (session_id) |

## Применение паттерна

```typescript
// Phase-функция
export async function* runIngest(...): AsyncGenerator<RunEvent> {
  yield { kind: "tool_use", name: "Read", input: { path } };
  const content = await vaultTools.read(path);
  yield { kind: "tool_result", ok: true };
  // ...
  yield { kind: "result", durationMs, text: summary };
}

// Потребитель
for await (const ev of runIngest(...)) {
  if (ev.kind === "domain_created") saveDomain(ev.entry);
  view?.onEvent(ev);
}
```
