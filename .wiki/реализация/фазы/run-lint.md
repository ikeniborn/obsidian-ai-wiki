---
wiki_sources: ["src/phases/lint.ts"]
wiki_updated: 2026-05-12
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[lint-промпт]]"
  - "[[run-event]]"
  - "[[run-ingest]]"
  - "[[raw-frontmatter-ts]]"
  - "[[domain-entry]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runLint", "lint.ts"]
---
# runLint (phases/lint.ts)

Фазовая функция операции lint. Проверяет качество wiki, автоматически исправляет найденные проблемы, актуализирует конфигурацию домена и синхронизирует backlinks в source-файлах.

## Основные характеристики

- **Расположение:** `src/phases/lint.ts`
- **Сигнатура:** `async function* runLint(args, vaultTools, llm, model, domains, vaultRoot, signal, opts): AsyncGenerator<RunEvent>`

## Алгоритм (3-фазный для каждого домена)

1. Если задан `args[0]` — фильтровать по id домена; иначе — все домены.
2. Для каждого домена выполнить последовательно:

### Фаза 1: LLM-аудит качества

- Glob `.md` файлов wiki-папки, исключая `META_FILES` (`_index.md`, `_log.md`, `_wiki_schema.md`, `_format_schema.md`)
- `checkStructure(pages)` — статические проверки (см. ниже) → `structuralIssues`
- LLM-вызов с `lint.md` промптом: передать страницы (обрезка до 500 символов) + структурные проблемы → `llmReport` (стриминг с yield `assistant_text`)

### Фаза 2: Актуализация конфигурации домена

- `actualizeDomainConfig(domain, pages, llm, model, opts, signal)` — отдельный LLM-вызов (non-streaming)
- LLM анализирует текущий конфиг домена + содержимое wiki-страниц
- Возвращает JSON `{entity_types?, language_notes?}` или `null`
- Если получен патч: yield `domain_updated` event с `{domainId, patch}`
- `computeEntityDiff()` — формирует текстовый отчёт об изменениях entity_types

### Фаза 3: Автоматическое исправление страниц

- `buildFixMessages()` → LLM-вызов с инструкцией исправить мёртвые ссылки, добавить frontmatter, устранить дублирование
- Ответ парсится через `parseJsonPages()` (из `run-ingest`)
- Изменённые страницы записываются через `vaultTools.write()` (проверка пути в wiki-папке)

### Фаза 4: Синхронизация backlinks

После всех исправлений — построить обратный индекс `rawPath → Set<wikiPage>`:
- Для каждой wiki-страницы: `parseWikiSourcesFromFm(content)` → список source-файлов
- Для каждого source-файла: прочитать, вызвать `upsertRawFrontmatter()` с `wiki_updated = today` и `wiki_articles = [...articles]`, записать
- yield `domain_updated` с количеством обновлённых файлов

3. Объединить отчёты всех доменов в итоговый `result` event.

## Вспомогательные функции

### checkStructure(pages)

Статические проверки (без LLM):
- Отсутствующий frontmatter (не начинается с `---`)
- Мёртвые WikiLinks `[[X]]` — ссылка не найдена среди известных страниц

### computeEntityDiff(oldTypes, newTypes)

Сравнивает entity_types до и после актуализации. Возвращает markdown-отчёт с маркерами `✚ добавлен`, `✖ удалён`, `✎ обновлён`.

### actualizeDomainConfig(domain, pages, llm, model, opts, signal)

Non-streaming LLM-вызов. Анализирует текущий конфиг (`entity_types`, `language_notes`) и содержимое wiki-страниц (по 300 символов). Возвращает частичный патч или `null`.

## META_FILES

Константа — файлы, исключаемые из lint-проверки:
```ts
const META_FILES = ["_index.md", "_log.md", "_wiki_schema.md", "_format_schema.md"];
```

## Связанные концепции

- [[lint-промпт]] — шаблон для аудита wiki LLM-ом
- [[run-ingest]] — предоставляет `parseJsonPages()` для разбора ответа fix-фазы
- [[raw-frontmatter-ts]] — `upsertRawFrontmatter`, `parseWikiSourcesFromFm` для backlink sync
- [[run-event]] — `domain_updated` event для обновления конфигурации домена
