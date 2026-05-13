---
wiki_status: stub
wiki_sources:
  - README.md
wiki_updated: 2026-05-14
wiki_domain: документация
tags: [паттерн, настройки, синхронизация, local.json]
---

# Per-Device Settings

Хранение machine-specific настроек (пути к исполняемым файлам) в отдельном файле `local.json`, исключённом из синхронизации.

## Назначение

Решает конфликт: настройки плагина синхронизируются через Obsidian Sync / git / Syncthing, но путь к `iclaude.sh` уникален для каждой машины. Разделение на общие настройки и машино-специфичные позволяет синхронизировать vault без перезаписи локальных путей.

## Ключевые решения

- `<plugin-dir>/local.json` — хранит machine-specific параметры (путь к `iclaude.sh`)
- Основные настройки плагина — в стандартном `data.json` Obsidian, нормально синхронизируются
- `local.json` нужно исключить из синка (`.gitignore`, правила Syncthing и т.д.)
- `!Wiki/_domain.json` (карта доменов внутри vault) — нормально синхронизируется вместе с заметками

## Связанные страницы

- [[wiki-controller]]
- [[backend-strategy]]
