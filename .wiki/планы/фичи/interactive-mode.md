---
wiki_sources: [docs/superpowers/plans/2026-04-27-interactive-mode.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [ask-user, интерактивный-режим]
---
# Interactive Mode (Ask User)

Фича добавляет поддержку двусторонней коммуникации между LLM-агентом и пользователем во время выполнения операции: агент может задать вопрос через `ask_user` событие, пользователь отвечает через модальный диалог.

## Основные характеристики

- Новый тип RunEvent `ask_user` с полем `question: string`
- Новый класс `WikiQuestionModal` (Obsidian Modal) для ввода ответа пользователем
- В `src/runner.ts` stdin-pipe открывается (было `"ignore"`, становится `"pipe"`)
- Новый метод `sendToolResult()` в runner для отправки ответа в stdin процесса
- `WikiController` перехватывает событие `ask_user` и ожидает ответа из модала перед продолжением

## Основные характеристики

| Компонент | Изменение |
|---|---|
| `src/types.ts` | Добавить `ask_user` в union RunEvent |
| `src/runner.ts` | stdin: `"pipe"`, добавить `sendToolResult()` |
| `src/controller.ts` | Handler `ask_user`: открыть modal, await ответ, вызвать `sendToolResult()` |
| `src/view.ts` | Рендер вопроса и ответа пользователя в интерфейсе |
