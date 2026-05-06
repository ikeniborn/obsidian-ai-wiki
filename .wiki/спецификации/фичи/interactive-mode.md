---
wiki_sources:
  - "docs/superpowers/specs/2026-04-27-interactive-mode-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - interactive
aliases:
  - "Ask User Question"
  - "Интерактивный режим"
---

# Interactive Mode (Интерактивный режим iclaude)

Фича добавляет поддержку интерактивных вопросов от скилла `llm-wiki` (через `AskUserQuestion`) непосредственно в Obsidian-плагине. Решает проблему зависания при операциях типа `bootstrap`, которые ожидают ввода через stdin, закрытый в текущей реализации.

## Основные характеристики

- **Протокол**: stdin открывается (`"pipe"` вместо `"ignore"`), `AskUserQuestion` распознаётся как новый `RunEvent` типа `ask_user`
- **Новый RunEvent**: `{ kind: "ask_user"; question: string; options: string[]; toolUseId: string }`
- **Парсинг**: `parseStreamLine()` детектирует `tool_use` с `name: "AskUserQuestion"` и возвращает `ask_user` событие
- **Runner**: новый метод `sendToolResult(toolUseId, answer)` пишет в stdin JSON `tool_result`; генератор приостанавливается до ответа
- **UI**: `WikiQuestionModal extends Modal` показывает вопрос с кнопками-вариантами или текстовым полем; resolve через ответ, reject через «Отменить» → SIGTERM
- **Single-flight**: guard остаётся активным пока modal открыт

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | Добавить `ask_user` в union `RunEvent` |
| `src/stream.ts` | Детекция `tool_use` name=AskUserQuestion |
| `src/runner.ts` | stdin → pipe; `sendToolResult()` + `resumeStream()` |
| `src/controller.ts` | await `view.showQuestionModal()` перед `sendToolResult` |
| `src/view.ts` | Новый `WikiQuestionModal`; рендер `ask_user` событий |

## Связанные концепции

- [[runner-ts]]
- [[controller-ts]]
- [[stream-ts]]
- [[view-ts]]
