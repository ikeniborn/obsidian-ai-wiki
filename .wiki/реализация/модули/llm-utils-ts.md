---
wiki_sources: ["src/phases/llm-utils.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-client]]"
  - "[[base-contract-промпт]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["llm-utils.ts", "buildChatParams", "extractStreamDeltas"]
---
# llm-utils.ts (phases/llm-utils.ts)

Утилиты построения запросов к LLM. Содержит `buildChatParams()` и `extractStreamDeltas()`. Используется всеми фазовыми функциями для формирования параметров вызова и извлечения дельт из streaming-ответа.

## Основные характеристики

- **Расположение:** `src/phases/llm-utils.ts`

### buildChatParams(model, messages, opts)

Строит объект параметров для `llm.chat.completions.create()`:
1. Добавляет `base.md` (base contract) в начало первого system-сообщения
2. Если задан `opts.systemPrompt` — инжектирует как раздел `## Уточнение`
3. Добавляет `temperature`, `max_tokens`, `top_p`, `num_ctx` если заданы

### extractStreamDeltas(chunk)

Извлекает `reasoning` и `content` из одного чанка streaming-ответа. Поддерживает reasoning-модели (minimax, o1), у которых думающий текст в нестандартном поле `delta.reasoning`.

### prependBaseContract

Приватная функция, читающая `prompts/base.md` через esbuild text-loader и добавляющая его в начало system-prompt при каждом вызове.

## Связанные концепции

- [[base-contract-промпт]] — base.md, автоматически добавляемый ко всем запросам
