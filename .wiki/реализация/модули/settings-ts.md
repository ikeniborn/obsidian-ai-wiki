---
wiki_sources: ["src/settings.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-wiki-plugin-settings]]"
  - "[[domain-entry]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["settings.ts", "LlmWikiSettingTab"]
---
# settings.ts (LlmWikiSettingTab)

Вкладка настроек плагина в Obsidian. `PluginSettingTab` с полным UI для всех параметров: общие, backend (claude-agent / native-agent), домены, dev mode.

## Основные характеристики

- **Расположение:** `src/settings.ts`
- **Класс:** `LlmWikiSettingTab extends PluginSettingTab`
- **Метод:** `display()` — полностью перестраивает UI при каждом вызове

### Секции UI

| Секция | Содержимое |
|--------|-----------|
| General | `systemPrompt`, `maxTokens` (если !perOperation && !claude-agent), `timeouts`, `historyLimit`, `agentLogPath` |
| Domains | Список доменов: Edit / Delete кнопки; при пустом списке — пояснительный текст |
| Backend | Dropdown claude-agent / native-agent; параметры выбранного backend |
| claude-agent | `iclaudePath`, `spawnCwd`, `model` (если !perOperation), `allowedTools`, `perOperation` toggle |
| native-agent | `baseUrl`, `apiKey`, `model`, `numCtx`, `temperature` (если !perOperation), `perOperation` toggle |
| Per-Operation | При `perOperation=true`: для каждой операции (ingest/query/lint/init) — model (claude-agent) или model+maxTokens+temperature (native-agent) |
| Dev Mode | `enabled` toggle, `logDir`, `evaluatorModel` |

### Реактивность

`display()` вызывается из `main.ts` через `this.plugin.controller.onBusyChange`. При активной операции (`busy=true`) показывает баннер и отключает кнопки Edit/Delete доменов.

## Связанные концепции

- [[llm-wiki-plugin-settings]] — тип настроек, отображаемых и изменяемых через этот UI
- [[domain-entry]] — структура домена, редактируемая через EditDomainModal
