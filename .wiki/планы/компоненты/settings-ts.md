---
wiki_sources: [docs/superpowers/plans/2026-04-29-claude-agent-backend.md, docs/superpowers/plans/2026-04-29-per-operation-models.md, docs/superpowers/plans/2026-05-04-dev-mode-prompt-management.md, docs/superpowers/plans/2026-05-05-devmode-logdir.md, docs/superpowers/plans/2026-05-05-domain-form-ux.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [LlmWikiSettingTab, настройки]
---
# src/settings.ts

`LlmWikiSettingTab` (Obsidian PluginSettingTab) — UI настроек плагина. `autodetectCwd()` обходит дерево вверх до 6 уровней для поиска корня проекта.

## Основные характеристики

- Секции настроек: General, Claude Agent backend, Native Agent backend, Dev Mode
- `autodetectCwd()`: ищет корень vault, возвращает абсолютный путь
- Настройки сохраняются через `plugin.saveSettings()` при каждом изменении поля

## Изменения по планам

| Фича | Изменение |
|---|---|
| Claude Agent Backend | Новая секция `claudeAgent.*` (iclaudePath, model, spawnCwd и т.д.) |
| Per-Operation Models | Секция per-operation с переключателем; sub-секции для каждой операции |
| Dev Mode | Поля: `devMode.enabled`, `devMode.logDir`, `devMode.evaluatorModel` |
| devMode logDir | `devMode.logPath` → `devMode.logDir`; placeholder обновляется до `/tmp` |
| Domain Form UX | Использует `EditDomainModal` для редактирования доменов |

## Структура настроек (LlmWikiPluginSettings)

```typescript
{
  backend: "claude-agent" | "native-agent";
  claudeAgent: { iclaudePath, model, spawnCwd, ... };
  nativeAgent: { baseUrl, model, maxTokens, temperature, ... };
  devMode: { enabled, logDir, evaluatorModel };
  domains: DomainEntry[];
  history: RunHistoryEntry[];
  historyLimit: number;
}
```
