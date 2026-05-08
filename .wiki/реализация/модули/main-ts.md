---
wiki_sources: ["src/main.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[wiki-controller]]"
  - "[[llm-wiki-view]]"
  - "[[llm-wiki-plugin-settings]]"
  - "[[domain-store]]"
  - "[[local-config]]"
  - "[[effective-settings]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["main.ts", "LlmWikiPlugin", "точка входа", "migrateLegacyData", "migrateToLocalV1"]
---
# main.ts (точка входа плагина)

Главный файл плагина. Регистрирует View, команды, настройки, ribbon-иконку. Управляет жизненным циклом: `onload` / `onunload`. Инстанцирует `DomainStore` и `LocalConfigStore`, запускает две идемпотентные миграции: `migrateLegacyData()` ДО `loadSettings()` и `migrateToLocalV1()` после.

## Основные характеристики

- **Расположение:** `src/main.ts`
- **Класс:** `LlmWikiPlugin extends Plugin`
- **Точка входа:** `default export LlmWikiPlugin`

### Порядок инициализации (onload)

1. `new DomainStore(this.app.vault)` — vault-bound
2. `new LocalConfigStore(this)` — plugin-dir-bound
3. `migrateLegacyData(this, domainStore, localConfigStore)` — переносит legacy поля
4. `await this.loadSettings()` — после миграции, чтобы `data.json` уже был очищен
5. `migrateToLocalV1(this, localConfigStore)` — однократно копирует backend/native/claude/agentLogEnabled из synced в `LocalConfig`, ставит `migrated_v1: true`, очищает `apiKey` из `data.json`
6. `new WikiController(app, plugin, domainStore, localConfigStore)`
7. `registerView`, `addRibbonIcon`, `addCommand`, `addSettingTab`

### Регистрируемые команды

| id | Действие |
|----|---------|
| `open-panel` | Открыть боковую панель |
| `ingest-current` | Ingest активного файла (только десктоп — на мобильном команда не регистрируется) |
| `query` | Query без сохранения |
| `query-save` | Query с сохранением |
| `lint` | Lint домена (DomainModal, async load доменов) — только десктоп |
| `init` | Init домена с dryRun (DomainModal, async load) — только десктоп |
| `cancel` | Отменить текущую операцию |

`lint`/`init` — callback обёрнут в async IIFE: `controller.loadDomains()` асинхронен; при `DomainCorruptError` — silent return.

### `migrateLegacyData(plugin, domainStore, localConfigStore)`

Однократная миграция при загрузке плагина. Идемпотентна — на чистом `data.json` ничего не делает.

| Legacy поле | Куда переносится | Условие |
|-------------|------------------|---------|
| `data.domains[]` | `!Wiki/_domain.json` через `domainStore.save()` | непустой массив + `_domain.json` ещё нет в vault |
| `data.claudeAgent.iclaudePath` | `<plugin-dir>/local.json` через `localConfigStore.save()` | непустая строка + текущий `local.iclaudePath` пуст |

После переноса поле удаляется из `data` и вызывается `plugin.saveData(data)`. На последующих запусках поля отсутствуют — миграция no-op.

### `loadSettings()`

Глубокий merge `DEFAULT_SETTINGS` с сохранёнными данными + миграции:
- `backend: "claude-code"` → `"claude-agent"`
- Перенос `systemPrompt`/`maxTokens` per-backend → top-level
- `agentLogPath` → `agentLogEnabled` (boolean)
- Очистка `devMode` от устаревшего `logDir`
- На `Platform.isMobile`: backend форсится в `native-agent` (claude-agent несовместим), `nativeAgent.perOperation` и `devMode.enabled` принудительно выключаются (релевантна только операция `query`)

### `migrateToLocalV1(plugin, localConfigStore)`

Однократная миграция (флаг `local.migrated_v1`). Если флаг не выставлен:
1. Копирует в `LocalConfig`: `backend`, `nativeAgent` (включая `apiKey`), `claudeAgent` (model + allowedTools), `agentLogEnabled`
2. Ставит `migrated_v1: true`
3. Затирает `s.nativeAgent.apiKey = ""` в synced и сохраняет (чтобы ключ не попал в Obsidian Sync)

После миграции UI настроек пишет per-device поля только в `LocalConfig`; synced `data.json` хранит дефолты для совместимости старого схемного дерева.

### `migrateDomainWikiFolder(domains)` — устарела

Сохранена для обратной совместимости тестов. Логика дублируется в `DomainStore.load()` (in-place strip `!Wiki/` prefix).

## Связанные концепции

- [[domain-store]] — инстанцируется первым, передаётся в controller
- [[local-config]] — инстанцируется вторым, передаётся в controller
- [[wiki-controller]] — принимает оба store через конструктор
- [[llm-wiki-view]] — регистрируется через `registerView`
- [[llm-wiki-plugin-settings]] — тип настроек, без `domains` и без `claudeAgent.iclaudePath`
