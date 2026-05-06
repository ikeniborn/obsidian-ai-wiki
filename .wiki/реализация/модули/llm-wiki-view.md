---
wiki_sources: ["src/view.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[wiki-controller]]"
  - "[[run-event]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LlmWikiView", "view.ts"]
---
# LlmWikiView (view.ts)

Боковая панель плагина (ItemView). Отображает прогресс выполнения операции в реальном времени: шаги инструментов, текст ответа LLM, финальный результат. Также содержит элементы управления: выбор домена, поле query, кнопки ingest/lint/init.

## Основные характеристики

- **Расположение:** `src/view.ts`
- **Класс:** `LlmWikiView extends ItemView`
- **View type:** `LLM_WIKI_VIEW_TYPE = "llm-wiki-view"`
- **Состояния:** `idle | running | done | error | cancelled`

### Публичный API

| Метод | Описание |
|-------|---------|
| `onEvent(ev: RunEvent)` | Обрабатывает событие из потока и обновляет UI |
| `setRunning()` | Переключает в состояние `running`, сбрасывает прогресс |
| `setDone(ev)` | Отображает финальный результат, переключает в `done` |
| `setError(msg)` | Отображает сообщение об ошибке |
| `setCancelled()` | Отображает состояние отмены |

### Отображение прогресса

- Секция `stepsEl` показывает события tool_use/tool_result/assistant_text в реальном времени
- Раскрывающийся блок прогресса (`progressToggle`) со счётчиком шагов
- Финальный результат (`finalEl`) с возможностью сворачивания
- История предыдущих операций (`historyEl`)

### Chat-режим

После завершения операции lint/fix/ingest отображается чат-интерфейс (`chatSection`) для уточняющих вопросов. Поддерживает многотурный диалог через `WikiController.chat()`.

## Связанные концепции

- [[wiki-controller]] — вызывает методы LlmWikiView для отображения событий
- [[run-event]] — типы событий, которые LlmWikiView обрабатывает через `onEvent()`
