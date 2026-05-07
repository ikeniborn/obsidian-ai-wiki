---
wiki_sources: ["src/domain-store.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[wiki-controller]]"
  - "[[main-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["DomainStore", "domain-store.ts", "DomainCorruptError"]
---
# DomainStore (domain-store.ts)

Хранилище карты доменов в vault: `!Wiki/_domain.json`. Lazy-чтение (без кэша), атомарная запись через `.tmp` + `rename`. Заменяет старое хранение `domains[]` в `data.json`.

## Основные характеристики

- **Расположение:** `src/domain-store.ts`
- **Класс:** `DomainStore(vault: Vault)`
- **Файл:** `!Wiki/_domain.json` (vault-relative)
- **Ошибка:** `DomainCorruptError` — невалидный JSON или не-массив

### API

| Метод | Описание |
|-------|---------|
| `load()` | Возвращает `DomainEntry[]`. `[]` если файла нет. Throws `DomainCorruptError` при битом JSON или non-array. |
| `save(domains)` | Создаёт `!Wiki/` если нужно, пишет в `_domain.json.tmp`, удаляет старый `_domain.json`, делает `rename`. |

### Атомарность

Запись через временный файл предотвращает повреждение при крэше:
1. `mkdir !Wiki` (если нет)
2. `write !Wiki/_domain.json.tmp <body>`
3. `remove !Wiki/_domain.json` (если есть)
4. `rename .tmp → _domain.json`

### Миграция wiki_folder

При `load()` для каждого домена с `wiki_folder` начинающимся на `!Wiki/` префикс снимается in-place (идемпотентно). Гарантирует совместимость со старыми записями где путь хранился полностью (`!Wiki/os` → `os`).

### Использование

- `WikiController` — load+save в обработчике `domain_*` событий из потока агента
- `LlmWikiSettingTab` — load в `refresh()`; save при edit/delete в UI
- `LlmWikiView` — load через `controller.loadDomains()` для отрисовки списка
- `migrateLegacyData` (main.ts) — save при переносе `data.domains` → vault

## Связанные концепции

- [[domain-entry]] — тип записи в массиве
- [[wiki-controller]] — основной потребитель
- [[main-ts]] — инстанцирует store до `loadSettings()`, запускает миграцию
