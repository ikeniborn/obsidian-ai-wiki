---
wiki_sources: ["src/local-config.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[main-ts]]"
  - "[[wiki-controller]]"
  - "[[settings-ts]]"
  - "[[effective-settings]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LocalConfigStore", "local-config.ts", "LocalConfig"]
---
# LocalConfigStore (local-config.ts)

Per-device overlay настроек плагина: `<plugin-dir>/local.json`. Хранит машинно-зависимые и чувствительные поля (`iclaudePath`, `apiKey`, `baseUrl`, `backend`, `model`, `agentLogEnabled` и т.д.). Не синхронизируется через Obsidian Sync/git/Syncthing.

## Основные характеристики

- **Расположение:** `src/local-config.ts`
- **Класс:** `LocalConfigStore(plugin: Plugin)`
- **Файл:** `<plugin.manifest.dir>/local.json`

### Тип `LocalConfig`

```typescript
interface LocalConfig {
  iclaudePath: string;                // Путь до iclaude.sh / claude CLI
  backend?: "claude-agent" | "native-agent";
  agentLogEnabled?: boolean;
  claudeAgent?: {
    model: string;
    allowedTools: string;
  };
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;                   // Чувствительно — не попадает в data.json
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
  };
  migrated_v1?: boolean;              // Флаг однократной миграции (см. main-ts.md)
}
```

Все поля кроме `iclaudePath` и `migrated_v1` опциональны. Если поле отсутствует, эффективное значение берётся из synced `LlmWikiPluginSettings` через [[effective-settings|resolveEffective]].

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

`iclaudePath` зависит от машины (Linux/Mac/Windows пути). `apiKey` — чувствителен и не должен попадать в синхронизируемый `data.json`. `backend` и `model` могут отличаться между устройствами (на мобильном — только cloud LLM). Хранение в `<plugin-dir>/local.json` (исключённом из синка) решает все три задачи. Эффективное состояние собирается [[effective-settings|resolveEffective(synced, local)]].

## Связанные концепции

- [[effective-settings]] — функция слияния synced + local в эффективные настройки
- [[main-ts]] — инстанцирует store, запускает `migrateLegacyData` и `migrateToLocalV1` (перенос полей из `data.json`)
- [[wiki-controller]] — читает `local` через `localConfigStore.load()` для выбора backend и spawn-параметров
- [[settings-ts]] — UI пишет patch только в `LocalConfig` для всех machine-specific полей
