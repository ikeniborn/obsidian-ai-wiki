---
wiki_sources: ["src/phases/query.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[query-промпт]]"
  - "[[run-event]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runQuery", "query.ts"]
---
# runQuery (phases/query.ts)

Фазовая функция операции query. Читает wiki-страницы домена, формирует ответ на вопрос пользователя, при флаге `save` — создаёт новую wiki-страницу с ответом.

## Основные характеристики

- **Расположение:** `src/phases/query.ts`
- **Сигнатура:** `async function* runQuery(args, save, vaultTools, llm, model, domains, vaultRoot, signal, opts): AsyncGenerator<RunEvent>`

### Алгоритм

1. Взять `domains[0]` как целевой домен (query работает в контексте одного домена)
2. Собрать все `.md` файлы wiki-папки (исключить `_index.md`, `_log.md`, `_schema.md`)
3. Прочитать файлы (ограничение `MAX_CONTEXT_CHARS = 80_000`)
4. Вызвать LLM с `query.md` промптом + контекст wiki-страниц
5. При `save = true` — распарсить результат как JSON-массив страниц и записать

### Связанные концепции

- [[query-промпт]] — шаблон для формирования ответа
