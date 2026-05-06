---
wiki_sources: [docs/superpowers/plans/2026-04-26-progress-display.md, docs/superpowers/plans/2026-04-27-interactive-mode.md, docs/superpowers/plans/2026-05-05-chat-after-all-operations.md, docs/superpowers/plans/2026-05-05-vault-relative-paths.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [LlmWikiView, боковая-панель]
---
# src/view.ts

Реализует `LlmWikiView` (Obsidian ItemView) — боковую панель плагина с живым рендером шагов операции, метрик, истории и чат-секции.

## Основные характеристики

- Наследуется от Obsidian `ItemView`, регистрируется через `registerView()` в `main.ts`
- Метод `onEvent(ev: RunEvent)` рендерит поступающие события в реальном времени
- Содержит поля: `progressToggle`, `progressCount`, `chatSection`, `lastContext`, `chatHistory`
- `wikiRoot` вычисляется из `domains[0]?.wiki_folder` (vault-relative)

## Изменения по планам

| Фича | Изменение |
|---|---|
| Progress Display | `metricsEl` → `progressToggle`/`progressCount`; `toggleSteps()`; `translateSystemEvent()` |
| Interactive Mode | Рендер вопроса/ответа `ask_user` в UI |
| Chat After All Ops | `lastLint` → `lastContext`; условие показа чата расширяется до 4 операций; сброс в `setRunning()` |
| Vault-relative Paths | `wikiRoot`: убирается vaultPrefix-стрипинг |

## Зависимости

Зависит от `src/types.ts` (RunEvent, WikiOperation), `src/controller.ts` (методы chat, dispatch).
