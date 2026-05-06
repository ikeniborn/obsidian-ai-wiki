---
wiki_sources:
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - domain-map
  - storage
aliases:
  - "domain_created event"
  - "data.json domains"
---

# Domain Map в Vault (хранение доменов в data.json)

Перенос структуры domain-map из внешнего файла `domain-map-<vault>.json` (через Node.js `fs`) в `data.json` плагина (стандартный механизм Obsidian `loadData`/`saveData`). Убирает зависимость от файловой системы вне Obsidian API и поле `domainMapDir`.

## Основные характеристики

- **Хранилище**: `domains: DomainEntry[]` добавляется в `LlmWikiPluginSettings`; сохраняется через `saveData()`
- **Паттерн `domain_created`**: фаза `init` не вызывает `addDomain()` напрямую, а выдаёт RunEvent `{ kind: "domain_created", entry }` — контроллер перехватывает и сохраняет
- **Упрощение `domain-map.ts`**: весь файловый I/O удаляется; остаётся только `validateDomainId()` и типы
- **Удаление**: `readDomains`, `addDomain`, `domainMapPath`, `DomainMapFile`, `domainMapDir` из настроек
- **UI-редактор доменов**: в `settings.ts` добавляется секция со списком доменов, кнопками Edit/Delete; новый `EditDomainModal` с полями name, wiki_folder, source_paths (textarea), entity_types (JSON textarea), language_notes

## `EditDomainModal` поля

| Поле | Тип | Примечание |
|---|---|---|
| `name` | text | Человекочитаемое название |
| `wiki_folder` | text | Путь к папке wiki |
| `source_paths` | textarea | Один путь на строку |
| `entity_types` | textarea (JSON) | Сырой JSON-массив; валидация при Save |
| `language_notes` | text | Заметки о языке |

## Связанные концепции

- [[domain-map-native-agent]]
- [[multi-vault-domain-maps]]
- [[vault-relative-paths]]
