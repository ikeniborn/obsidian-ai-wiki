---
wiki_sources: ["src/wiki-path.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links: []
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["wiki-path.ts", "WIKI_ROOT", "domainWikiFolder"]
---
# wiki-path.ts (WIKI_ROOT, domainWikiFolder)

Минимальный модуль с константой и утилитой для формирования путей wiki в vault.

## Основные характеристики

- **Расположение:** `src/wiki-path.ts`
- **Константа:** `WIKI_ROOT = "!Wiki"` — корневая папка wiki в vault
- **Функция:** `domainWikiFolder(subfolder: string): string` → `"!Wiki/{subfolder}"`

### Назначение

Единственный источник истины для пути `!Wiki/`. Используется при:
- Формировании `wiki_folder` домена при создании
- Миграции `wiki_folder` в `main.ts` (strip `!Wiki/` prefix → хранить только subfolder)
