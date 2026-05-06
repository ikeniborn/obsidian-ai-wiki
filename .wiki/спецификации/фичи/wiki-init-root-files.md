---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-wiki-init-root-files-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - init
  - self-sufficient
aliases:
  - "ensureRootFiles"
  - "Корневые файлы вики"
---

# Wiki Init Root Files (ensureRootFiles)

Самодостаточная инициализация корневых файлов wiki при первом запуске `init`. Операция создаёт `_schema.md`, `_index.md`, `_log.md` если они не существуют — без зависимости от внешних файлов или ручного ввода. Шаблон `_schema.md` встраивается в `main.js` через esbuild.

## Основные характеристики

- **Проблема**: при `init` агент читал корневые файлы через `tryRead` (возвращает `""` если нет), но не создавал их; содержимое `_schema.md` зависело от внешних источников
- **Решение**: шаблон `templates/_schema.md` в репозитории плагина встраивается при сборке; операция `init` вызывает `ensureRootFiles()` как первый шаг
- **Идемпотентность**: повторный `init` не перезаписывает существующие файлы
- **Ошибки записи**: если `vaultTools.write` падает при создании корневых файлов — ошибка поглощается (аналогично `appendLog`); операция продолжается
- **esbuild**: `loader: { ".md": "text" }` — файлы `.md` из `prompts/` и `templates/` импортируются как строки
- **TypeScript declaration**: `src/md-modules.d.ts` — `declare module "*.md"` для type-safe импортов

## Содержание `templates/_schema.md`

Конвенции из `rules/wiki-conventions.md` скилла `llm-wiki`: язык, именование файлов, структура страницы, frontmatter, WikiLinks, правила контента.

## Затронутые файлы

| Файл | Действие |
|---|---|
| `esbuild.config.mjs` | Добавить `loader: { ".md": "text" }` |
| `src/md-modules.d.ts` | Создать — TypeScript declaration |
| `templates/_schema.md` | Создать — шаблон схемы |
| `src/phases/init.ts` | Добавить `ensureRootFiles()` как первый шаг |

## Связанные концепции

- [[agent-base-contract]]
