---
wiki_sources: ["src/main.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[wiki-controller]]"
  - "[[llm-wiki-view]]"
  - "[[llm-wiki-plugin-settings]]"
  - "[[domain-store]]"
  - "[[local-config]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["main.ts", "LlmWikiPlugin", "точка входа", "migrateLegacyData"]
---
# main.ts (точка входа плагина)

Главный файл плагина. Регистрирует View, команды, настройки, ribbon-иконку. Управляет жизненным циклом: `onload` / `onunload`. Инстанцирует `DomainStore` и `LocalConfigStore`, запускает идемпотентную миграцию `migrateLegacyData()` ДО `loadSettings()`.

## Основные характеристики

- **Расположение:** `src/main.ts`
- **Класс:** `LlmWikiPlugin extends Plugin`
- **Точка входа:** `default export LlmWikiPlugin`

### Порядок инициализации (onload)

1. `new DomainStore(this.app.vault)` — vault-bound
2. `new LocalConfigStore(this)` — plugin-dir-bound
3. `migrateLegacyData(this, domainStore, localConfigStore)` — переносит legacy поля
4. `await this.loadSettings()` — после миграции, чтобы `data.json` уже был очищен
5. `new WikiController(app, plugin, domainStore, localConfigStore)`
6. `registerView`, `addRibbonIcon`, `addCommand`, `addSettingTab`

### Регистрируемые команды

| id | Действие |
|----|---------|
| `open-panel` | Открыть боковую панель |
| `ingest-current` | Ingest активного файла |
| `query` | Query без сохранения |
| `query-save` | Query с сохранением |
| `lint` | Lint домена (DomainModal, async load доменов) |
| `init` | Init домена с dryRun (DomainModal, async load) |
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

### `migrateDomainWikiFolder(domains)` — устарела

Сохранена для обратной совместимости тестов. Логика дублируется в `DomainStore.load()` (in-place strip `!Wiki/` prefix).

## Связанные концепции

- [[domain-store]] — инстанцируется первым, передаётся в controller
- [[local-config]] — инстанцируется вторым, передаётся в controller
- [[wiki-controller]] — принимает оба store через конструктор
- [[llm-wiki-view]] — регистрируется через `registerView`
- [[llm-wiki-plugin-settings]] — тип настроек, без `domains` и без `claudeAgent.iclaudePath`
