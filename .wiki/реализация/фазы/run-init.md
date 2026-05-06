---
wiki_sources: ["src/phases/init.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[run-ingest]]"
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[init-промпт]]"
  - "[[domain-entry]]"
  - "[[run-event]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runInit", "init.ts"]
---
# runInit (phases/init.ts)

Фазовая функция операции init. Два режима: bootstrap нового домена (без источников) и инициализация с источниками (массовый ingest файлов).

## Основные характеристики

- **Расположение:** `src/phases/init.ts`
- **Сигнатура:** `async function* runInit(args, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError?): AsyncGenerator<RunEvent>`

### Парсинг аргументов

- `args[0]` — domain id (обязателен)
- `args.includes("--dry-run")` — режим превью без записи
- `args.indexOf("--sources")` — если задан, `args.slice(idx+1)` — исходные пути

### Режим Bootstrap (без --sources)

1. Если домен уже существует с `entity_types.length > 0` → yield error
2. `ensureRootFiles()` — создать `_schema.md`, `_index.md`, `_log.md` если отсутствуют
3. Прочитать 5 примеров файлов vault
4. Вызвать LLM с `init.md` промптом → получить JSON DomainEntry
5. Нормализовать `wiki_folder` (убрать `vaults/<vaultName>/` prefix если LLM добавил)
6. yield `domain_created` или `domain_updated`
7. Записать в лог

### Режим с источниками (runInitWithSources)

1. `ensureRootFiles()`
2. Отфильтровать `.md` файлы из `allVaultFiles` по prefix `sourcePaths`
3. Вызвать LLM с примерами источников → получить DomainEntry с entity_types
4. yield `domain_created` / `domain_updated`
5. Для каждого файла → `runIngest()` с retry/skip/stop через `onFileError`
6. yield `file_start`, `file_done` для отображения прогресса в UI

### ensureRootFiles(vaultTools, wikiRoot)

Создаёт `_schema.md` (из шаблона `_schema.md`), `_index.md` и `_log.md` если они отсутствуют. Не перезаписывает существующие.

### Нормализация wiki_folder

LLM может вернуть `vaults/VaultName/!Wiki/domain` — код убирает prefix `vaults/<vaultName>/`, приводя к vault-relative пути.

## Связанные концепции

- [[run-ingest]] — вызывается для каждого источника в режиме с источниками
- [[init-промпт]] — шаблон промпта для генерации DomainEntry
