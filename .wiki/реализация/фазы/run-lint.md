---
wiki_sources: ["src/phases/lint.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[lint-промпт]]"
  - "[[run-event]]"
  - "[[run-ingest]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runLint", "lint.ts"]
---
# runLint (phases/lint.ts)

Фазовая функция операции lint. Проверяет качество wiki: frontmatter, мёртвые ссылки, orphan-страницы, покрытие источников.

## Основные характеристики

- **Расположение:** `src/phases/lint.ts`
- **Сигнатура:** `async function* runLint(args, vaultTools, llm, model, domains, vaultRoot, signal, opts): AsyncGenerator<RunEvent>`

### Алгоритм

1. Если задан `args[0]` — фильтровать по id домена; иначе — все домены
2. Для каждого домена:
   - Собрать `.md` файлы wiki-папки (кроме meta-файлов)
   - Прочитать все страницы и `_index.md`
   - Вызвать LLM с `lint.md` промптом
   - Распарсить результат как отчёт + JSON-массив обновлённых страниц
3. Объединить отчёты всех доменов

### Связанные концепции

- [[lint-промпт]] — шаблон для проверки wiki
- [[run-fix]] — фаза исправления по результатам lint
- [[run-ingest]] — предоставляет `parseJsonPages()`, используемую для разбора ответа LLM
