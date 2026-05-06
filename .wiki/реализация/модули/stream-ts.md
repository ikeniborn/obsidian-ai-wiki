---
wiki_sources: ["src/stream.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[run-event]]"
  - "[[claude-cli-client]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["parseStreamLine", "stream.ts"]
---
# parseStreamLine (stream.ts)

Функция парсинга одной строки stream-JSON stdout от iclaude.sh в типизированный `RunEvent`. Единственная ответственность файла — преобразование сырой строки в событие для UI.

## Основные характеристики

- **Расположение:** `src/stream.ts`
- **Экспорт:** `parseStreamLine(raw: string): RunEvent | null`
- **Формат входа:** одна строка stdout (JSON или не-JSON)

### Правила парсинга

1. Пустые строки → `null`
2. Строки не начинающиеся с `{` → `null` (баннеры iclaude, ANSI-цвета игнорируются)
3. Невалидный JSON → `{ kind: "error", message: "stream parse error: ..." }`
4. Валидный JSON → маппинг по полю `type`:

| `type` | Результат |
|--------|----------|
| `"system"` | `{ kind: "system", message, sessionId? }` |
| `"assistant"` | `{ kind: "tool_use" }` или `{ kind: "assistant_text" }` или `{ kind: "ask_user" }` |
| `"user"` | `{ kind: "tool_result", ok, preview? }` |
| `"result"` | `{ kind: "result" }` или `{ kind: "error" }` |
| иной | `null` |

### AskUserQuestion

Специальный tool_use с именем `AskUserQuestion` маппируется в `{ kind: "ask_user", question, options, toolUseId }` — используется для интерактивного взаимодействия с пользователем из агента.

## Применение в контексте реализации

Используется исключительно в `ClaudeCliClient._generate()` для построения AsyncGenerator событий из потока процесса.

## Связанные концепции

- [[run-event]] — тип событий, которые производит parseStreamLine
- [[claude-cli-client]] — единственный потребитель parseStreamLine
