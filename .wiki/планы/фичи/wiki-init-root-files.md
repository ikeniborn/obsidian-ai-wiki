---
wiki_sources: [docs/superpowers/plans/2026-05-04-wiki-init-root-files.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [ensure-root-files, корневые-файлы-вики]
---
# Wiki Init Root Files (ensureRootFiles)

Фича обеспечивает автоматическое создание корневых файлов wiki (`_schema.md`, `_index.md`, `_log.md`) при операции `init`, если они ещё не существуют.

## Основные характеристики

- Шаблон `templates/_schema.md` хранится в репозитории и встраивается в `main.js` через esbuild `loader: { ".md": "text" }`
- Vitest требует отдельного плагина трансформации `.md` (esbuild loader не используется Vitest)
- TypeScript-декларация `src/md-modules.d.ts` позволяет импортировать `.md` как строку
- Функция `ensureRootFiles(vaultTools, wikiRoot)` проверяет наличие каждого файла через `vaultTools.exists()` — перезапись существующих файлов запрещена
- Вызывается в начале `runInit()` до основной логики инициализации домена

## Файловая карта

| Файл | Изменение |
|---|---|
| `esbuild.config.mjs` | `loader: { ".md": "text" }` |
| `vitest.config.ts` | Plugin `md-text` для трансформации `.md` |
| `src/md-modules.d.ts` | `declare module "*.md"` |
| `templates/_schema.md` | Шаблон схемы (встраивается при сборке) |
| `src/phases/init.ts` | `ensureRootFiles()` + импорт шаблона |
| `tests/init.test.ts` | 4 теста: create/skip для каждого файла |
