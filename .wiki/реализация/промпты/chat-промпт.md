---
wiki_sources: ["prompts/chat.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[run-lint-chat]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["chat.md", "chat prompt"]
---
# Chat промпт (prompts/chat.md)

Системный промпт для чат-режима после операций. Инструктирует LLM отвечать конкретно, ссылаясь на страницы и сущности из контекста операции.

## Основные характеристики

- **Расположение:** `prompts/chat.md`
- **Встраивается:** через esbuild text-loader (`import chatTemplate from "../../prompts/chat.md"`)
- **Рендеринг:** `render(chatTemplate, variables)` из `phases/template.ts`

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{operation_header}}` | Заголовок операции (например, "Lint результаты") |
| `{{context}}` | Результат предыдущей операции (lint report, ingest summary и т.д.) |

### Поведение LLM

- Отвечает на вопросы пользователя по результатам операции
- Ссылается на конкретные страницы и сущности из контекста

## Связанные концепции

- [[run-lint-chat]] — использует этот промпт
