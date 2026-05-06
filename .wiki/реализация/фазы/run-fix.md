---
wiki_sources: ["src/phases/fix.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[run-event]]"
  - "[[run-lint]]"
  - "[[run-ingest]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runFix", "fix.ts"]
---
# runFix (phases/fix.ts)

Фазовая функция операции fix. Применяет исправления к wiki-страницам домена на основе lint-отчёта или пользовательской инструкции.

## Основные характеристики

- **Расположение:** `src/phases/fix.ts`
- **Сигнатура:** `async function* runFix(args, vaultTools, llm, model, domains, vaultRoot, signal, opts, lintReport?, userInstruction?): AsyncGenerator<RunEvent>`

### Алгоритм

1. Определить домен: `args[0]` как id или первый домен
2. Glob все `.md` файлы wiki-папки (исключить `_index.md`, `_log.md`, `_schema.md`)
3. Прочитать все страницы и выполнить `checkStructure()` из `lint.ts`
4. Вызвать LLM с `fix.md` промптом, передав контекст: страницы, структурные проблемы, lint-отчёт, пользовательскую инструкцию
5. Распарсить ответ LLM через `parseJsonPages()` из `ingest.ts`
6. Записать изменённые страницы через `VaultTools.write()`
7. Вернуть сводку: кол-во исправленных страниц, ошибки записи, структурные проблемы

### Режимы работы

| Режим | Условие | Поведение |
|-------|---------|----------|
| По lint-отчёту | `lintReport` передан | Исправляет по результатам предыдущего lint |
| По инструкции | `userInstruction` передан | Выполняет произвольную задачу пользователя |
| Структурный анализ | Оба отсутствуют | Исправляет по `checkStructure()` |

## Связанные концепции

- [[run-lint]] — продюсер lint-отчёта, который fix использует как вход
- [[run-ingest]] — предоставляет `parseJsonPages()` для разбора ответа LLM
