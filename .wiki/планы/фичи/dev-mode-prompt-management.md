---
wiki_sources: [docs/superpowers/plans/2026-05-04-dev-mode-prompt-management.md, docs/superpowers/plans/2026-05-05-devmode-logdir.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [dev-mode, prompt-templates, девмод]
---
# Dev Mode и управление промптами

Фича переносит промпты phase-функций в файлы `prompts/*.md`, добавляет функцию `render()` для подстановки переменных, вводит dev-режим с логированием и evaluator-фазой.

## Основные характеристики

- Phase-промпты хранятся как `prompts/ingest.md`, `prompts/query.md`, `prompts/lint.md`, `prompts/init.md`, `prompts/chat.md`, `prompts/base.md`
- esbuild встраивает `.md` файлы как строки через `loader: { ".md": "text" }` (см. [[wiki-init-root-files]])
- Функция `render(template, vars)` заменяет `{{key}}` на значения (без шаблонных движков)
- User prompt field: `systemPrompt` пользователя добавляется как `## Уточнение` в конец system-промпта
- `devMode.logDir` (было `logPath`) — директория для `dev.jsonl` с записями каждого LLM-вызова
- `devMode.evaluatorModel` — модель для evaluator-фазы (оценивает качество ответа)

## Структура dev-лога

```json
{ "ts": "2026-05-04T12:00:00Z", "operation": "ingest", "prompt": "...", "response": "...", "eval": null }
```

После evaluator-фазы поле `eval` обновляется числовой оценкой.

## Миграция настроек

`devMode.logPath` (полный путь к файлу) → `devMode.logDir` (директория). Миграция в `loadSettings()`: берётся `dirname(logPath)`.
