---
wiki_status: developing
wiki_sources:
  - src/phases/fix.ts
  - docs/architecture/README.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [операция, fix, security, path-validation]
---

# Fix Operation

Автоматическое исправление wiki-страниц домена по результатам lint-отчёта или структурного анализа. LLM получает все страницы домена и возвращает исправленные в формате JSON-массива.

## Назначение

`runFix` (`src/phases/fix.ts`) читает все `.md` файлы wiki-домена, прогоняет структурный анализ (`checkStructure`), формирует промпт с контентом страниц и ожидает от LLM JSON-массив изменённых страниц. Может принимать lint-отчёт из предыдущей операции.

## Path-блокировка (security)

После получения страниц от LLM каждый путь проверяется перед записью:

```ts
if (!normalize(page.path).startsWith(wikiVaultPath + "/")) {
  yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
  errors.push(`${page.path}: blocked, outside wiki folder`);
  continue;
}
```

Это предотвращает запись файлов за пределы wiki-папки домена — даже если LLM вернёт произвольный путь. `normalize()` из `path-browserify` разворачивает `../` traversal до сравнения.

## Поток выполнения

```
runFix(args, vaultTools, llm, model, domains, vaultRoot, signal, opts, lintReport?, userInstruction?)
  → domainWikiFolder(domain.wiki_folder) → absWiki
  → vaultTools.listFiles(wikiVaultPath) → files (без META_FILES)
  → vaultTools.readAll(files) → pages: Map<string, string>
  → checkStructure(pages) → structuralIssues
  → buildFixMessages(…) → LLM stream
  → parseJsonPages(fullText) → fixedPages[]
  → для каждой: path-check → vaultTools.write()
  → buildFixSummary(…) → yield result
```

## Входные данные

- `lintReport` — если передан из истории, приоритет над структурным анализом
- `userInstruction` — произвольная инструкция пользователя; меняет системную инструкцию на «выполни задачу, верни только изменённые страницы»
- `META_FILES` (`_index.md`, `_log.md`, `_wiki_schema.md`, `_format_schema.md`) исключаются из обработки

## Fallback при ошибке стриминга

При ошибке стрима (не AbortError) — повтор через non-streaming запрос без `signal`.

## Вывод

Отчёт включает: список исправленных страниц, ошибки записи, структурные проблемы из `checkStructure`.

## Связанные страницы

- [[wiki-controller]]
- [[agent-runner]]
- [[format-operation]]
