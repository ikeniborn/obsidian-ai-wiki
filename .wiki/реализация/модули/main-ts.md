---
wiki_sources: ["src/main.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[wiki-controller]]"
  - "[[llm-wiki-view]]"
  - "[[llm-wiki-plugin-settings]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["main.ts", "LlmWikiPlugin", "точка входа"]
---
# main.ts (точка входа плагина)

Главный файл плагина. Регистрирует View, команды, настройки, ribbon-иконку. Управляет жизненным циклом: `onload` / `onunload`. Также содержит `migrateDomainWikiFolder()` — функцию миграции схемы.

## Основные характеристики

- **Расположение:** `src/main.ts`
- **Класс:** `LlmWikiPlugin extends Plugin`
- **Точка входа:** `default export LlmWikiPlugin`

### Регистрируемые команды

| id | Действие |
|----|---------|
| `open-panel` | Открыть боковую панель |
| `ingest-current` | Ingest активного файла |
| `query` | Query без сохранения |
| `query-save` | Query с сохранением |
| `lint` | Lint домена (DomainModal) |
| `init` | Init домена с dryRun (DomainModal) |
| `cancel` | Отменить текущую операцию |

### Загрузка настроек (`loadSettings`)

Выполняет глубокий merge `DEFAULT_SETTINGS` с сохранёнными данными. Включает несколько миграций:
- `backend: "claude-code"` → `"claude-agent"` (schema v1 → v2)
- Перенос полей `systemPrompt`/`maxTokens` с per-backend уровня на top-level (schema v2)
- `devMode.logPath` → `devMode.logDir`
- Вызов `migrateDomainWikiFolder()` для strip `!Wiki/` prefix

### `migrateDomainWikiFolder(domains)`

Экспортированная утилита (используется в `migration.test.ts`). Проходит по массиву доменов, убирает prefix `!Wiki/` из `wiki_folder`. Возвращает `true` если хоть один домен был изменён — тогда плагин автоматически сохраняет настройки.

## Связанные концепции

- [[wiki-controller]] — создаётся в `onload`, принимает `app` и `plugin`
- [[llm-wiki-view]] — регистрируется через `registerView`
- [[llm-wiki-plugin-settings]] — тип настроек, загружаемых в `loadSettings`
