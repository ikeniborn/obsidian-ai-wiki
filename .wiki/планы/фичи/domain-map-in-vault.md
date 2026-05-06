---
wiki_sources: [docs/superpowers/plans/2026-04-30-domain-map-in-vault.md, docs/superpowers/plans/2026-04-27-multi-vault-domain-maps.md, docs/superpowers/plans/2026-04-28-domain-map-native-agent.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [domain-storage, домены-в-настройках]
---
# Domain Map в Vault (хранение доменов)

Серия фич переносит хранение доменов из внешнего JSON-файла (`domain-map.json`) в Obsidian `data.json` (поле `settings.domains[]`). Параллельно упрощается структура хранения: убирается привязка к shared-директории.

## Эволюция хранения

| Версия | Механизм | Файл |
|---|---|---|
| Начальная | Внешний файл | `domain-map-<vaultName>.json` рядом с iclaude.sh |
| Промежуточная | Файл в плагине | `domain-map.json` в директории плагина |
| Текущая | Obsidian data.json | `settings.domains[]` в Obsidian plugin storage |

## Основные характеристики

- `domain-map.ts` упрощается до типов + `validateDomainId()` (убираются функции чтения файла)
- RunEvent получает новый тип `domain_created` с полем `entry: DomainEntry`
- Фаза `init` эмитирует `domain_created` вместо записи JSON-файла
- `WikiController` перехватывает `domain_created` и сохраняет домен через `plugin.saveSettings()`
- `WikiDomain` (union-тип) уступает место динамическому `string` для id домена

## Vault-relative пути (финальная фаза)

Финальная эволюция: `wiki_folder` и `source_paths` хранятся как vault-relative строки (без префикса `vaults/<VaultName>/`). `vaultRoot = app.vault.adapter.getBasePath()` — единственная точка привязки путей.
