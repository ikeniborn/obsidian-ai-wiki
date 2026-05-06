---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-agent-base-contract-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - prompts
  - agent
aliases:
  - "prompts/base.md"
  - "Базовый системный промпт"
---

# Agent Base Contract (базовый контракт агента)

Создание единого базового системного промпта (`prompts/base.md`), применяющегося ко всем операциям. Встраивается в `main.js` через esbuild text loader и инжектируется первым в системный промпт, до фазового промпта и до пользовательского «Уточнения».

## Основные характеристики

- **Расположение**: `prompts/base.md` — новый файл; встраивается при сборке через `import baseContract from "../../prompts/base.md"`
- **Порядок системного промпта**: `[base.md]` → `[prompts/<phase>.md]` → `## Уточнение` (settings.systemPrompt)
- **Точка инжекции**: `src/phases/llm-utils.ts`, функция `buildChatParams()` — prepend базового контракта к первому системному сообщению
- **Содержание**: правила достоверности (только из контекста), формата (только запрошенное, JSON без пояснений), минимализма (не добавлять незапрошенное)
- **Механизм сборки**: использует существующий `loader: { ".md": "text" }` в esbuild; никакого disk read в runtime

## Связанные концепции

- [[dev-mode-prompt-management]]
