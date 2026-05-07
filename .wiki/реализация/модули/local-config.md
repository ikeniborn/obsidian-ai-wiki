---
wiki_sources: ["src/local-config.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[main-ts]]"
  - "[[wiki-controller]]"
  - "[[settings-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LocalConfigStore", "local-config.ts", "LocalConfig"]
---
# LocalConfigStore (local-config.ts)

Machine-specific конфиг плагина: `<plugin-dir>/local.json`. Хранит `iclaudePath` (путь до `iclaude.sh`/`claude` CLI на текущей машине). Не синхронизируется через Obsidian Sync/git/Syncthing.

## Основные характеристики

- **Расположение:** `src/local-config.ts`
- **Класс:** `LocalConfigStore(plugin: Plugin)`
- **Файл:** `<plugin.manifest.dir>/local.json`
- **Тип:** `LocalConfig { iclaudePath: string }`

### API

| Метод | Описание |
|-------|---------|
| `load()` | Возвращает `LocalConfig` (с дефолтами `iclaudePath: ""`). Кэширует результат — повторные вызовы не читают диск. На битом JSON возвращает дефолты. |
| `save(patch)` | `Partial<LocalConfig>` — мерджится с текущим, пишется на диск, обновляет кэш. |

### Поведение

- **Кэш:** одна загрузка на жизненный цикл плагина — после первой `load()` диск не трогается до `save()`
- **Дефолты при ошибке:** битый JSON или отсутствующий файл → `{ iclaudePath: "" }`
- **Throws:** только если `plugin.manifest.dir` undefined (broken plugin install)

### Зачем отдельный файл

`iclaudePath` зависит от машины (на Linux `/home/user/...`, на Mac `/Users/...`). Хранить в `data.json` нельзя — Obsidian Sync затирает на других машинах. Хранение в `<plugin-dir>/local.json` + `.gitignore`-style исключение из синка решает задачу.

## Связанные концепции

- [[main-ts]] — инстанцирует store до `loadSettings()`, запускает миграцию `claudeAgent.iclaudePath` → `local.json`
- [[wiki-controller]] — читает `iclaudePath` через `localConfigStore.load()` при spawn
- [[settings-ts]] — UI для редактирования через `localConfigStore.save({ iclaudePath })`
