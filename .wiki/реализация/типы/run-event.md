---
wiki_sources: ["src/types.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[wiki-controller]]"
  - "[[llm-wiki-view]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["RunEvent", "WikiEvent"]
---
# RunEvent (types.ts)

Union-тип всех событий, которые фазовые функции передают через AsyncGenerator. Служит протоколом между `AgentRunner` и UI (`LlmWikiView`, `WikiController`).

## Основные характеристики

- **Расположение:** `src/types.ts`
- **Тип:** `type RunEvent = ...` (discriminated union по полю `kind`)

### Варианты событий

| kind | Поля | Назначение |
|------|------|-----------|
| `system` | message, sessionId? | Системное сообщение (backend, model, session) |
| `tool_use` | name, input | Инструмент запущен (Read, Write, Glob) |
| `tool_result` | ok, preview? | Результат инструмента |
| `assistant_text` | delta, isReasoning? | Дельта текста ответа LLM |
| `result` | durationMs, usdCost?, text | Финальный результат операции |
| `error` | message | Ошибка |
| `exit` | code | Завершение процесса (claude-agent) |
| `ask_user` | question, options, toolUseId | Запрос к пользователю из агента |
| `domain_created` | entry | Новый домен создан LLM |
| `domain_updated` | domainId, patch | Домен обновлён (entity_types, language_notes) |
| `source_path_added` | domainId, path | Путь источника добавлен к домену |
| `eval_result` | score, reasoning | Результат автооценки (devMode) |
| `init_start` | totalFiles | Начало init с источниками |
| `file_start` | file, index, total | Начало обработки файла в init |
| `file_done` | file | Файл обработан |

### Обработка в WikiController

Контроллер реагирует на:
- `domain_created` → push в settings.domains
- `domain_updated` → patch
- `source_path_added` → consolidateSourcePaths

## Связанные концепции

- [[agent-runner]] — продюсер RunEvent
- [[wiki-controller]] — обработчик RunEvent
