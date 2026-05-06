---
wiki_sources: ["src/phases/ingest.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[run-event]]"
  - "[[ingest-промпт]]"
  - "[[domain-entry]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runIngest", "ingest.ts"]
---
# runIngest (phases/ingest.ts)

Фазовая функция операции ingest. Читает файл-источник, отправляет его LLM для синтеза wiki-страниц, записывает результат в vault.

## Основные характеристики

- **Расположение:** `src/phases/ingest.ts`
- **Сигнатура:** `async function* runIngest(args, vaultTools, llm, model, domains, vaultRoot, signal, opts): AsyncGenerator<RunEvent>`

### Алгоритм выполнения

1. Разрешить абсолютный путь файла-источника → vault-relative через `vaultTools.toVaultPath()`
2. Прочитать файл (yield tool_use/tool_result)
3. `detectDomain()` — найти домен по prefix-match `source_paths`; если не найден — использовать первый домен
4. Прочитать `_schema.md`, `_index.md` и существующие wiki-страницы домена
5. Вызвать LLM с `ingest.md` промптом → получить JSON-массив страниц
6. Записать страницы через `vaultTools.write()` (блокировать пути вне wiki-папки домена)
7. Обновить `_log.md` и `_index.md`
8. yield `source_path_added` с родительской папкой источника

### parseJsonPages(text)

Ищет JSON-массив `[{path, content}]` в тексте LLM-ответа. Возвращает только объекты с полями `path: string` и `content: string`.

### detectDomain(absFilePath, domains, vaultRoot)

Prefix-match: возвращает первый домен, чей `source_path` является префиксом абсолютного пути файла. При отсутствии совпадения — возвращает `domains[0]`.

### extractParentSourcePath(absSource, vaultRoot)

Возвращает vault-relative путь родительской директории источника. Clamp: не выходит выше vaultRoot.

## Связанные концепции

- [[ingest-промпт]] — шаблон промпта для синтеза wiki-страниц
- [[run-init]] — использует runIngest внутри для обработки источников
