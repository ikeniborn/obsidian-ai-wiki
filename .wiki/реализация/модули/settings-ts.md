---
wiki_sources: ["src/settings.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-wiki-plugin-settings]]"
  - "[[domain-entry]]"
  - "[[domain-store]]"
  - "[[local-config]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["settings.ts", "LlmWikiSettingTab"]
---
# settings.ts (LlmWikiSettingTab)

Вкладка настроек плагина. `PluginSettingTab` с UI: общие, backend, домены, dev mode. Домены читаются через `DomainStore`, `iclaudePath` — через `LocalConfigStore`. UI рендерится async-aware: `display() → refresh() async → render() sync`.

## Основные характеристики

- **Расположение:** `src/settings.ts`
- **Класс:** `LlmWikiSettingTab extends PluginSettingTab`
- **Метод:** `display()` — синхронная точка входа Obsidian; делегирует `void this.refresh()`

### Async refresh pattern

```
display(): void              // вызов от Obsidian
  → void this.refresh()      // async, не блокирует
      → await domainStore.load()      // → cachedDomains
      → await localConfigStore.load() // → cachedIclaudePath
      → this.render()                  // sync, использует кэши
```

Поля кэша: `cachedDomains: DomainEntry[]`, `cachedIclaudePath: string`. На `DomainCorruptError` — `Notice` + `cachedDomains = []`.

### Секции UI

| Секция | Содержимое |
|--------|-----------|
| General | `systemPrompt`, `maxTokens` (если !perOperation && !claude-agent), `timeouts`, `historyLimit`, `agentLogEnabled` |
| Domains | Список из `cachedDomains`: Edit / Delete; пустой → пояснительный текст. Edit/Delete → `domainStore.load+save+refresh()` |
| Backend | Dropdown claude-agent / native-agent |
| claude-agent | `iclaudePath` (из `LocalConfigStore`, save через `localConfigStore.save({ iclaudePath })`), `spawnCwd`, `model`, `allowedTools`, `perOperation` |
| native-agent | `baseUrl`, `apiKey`, `model`, `numCtx`, `temperature`, `perOperation` |
| Per-Operation | Per-op model (claude) или model+maxTokens+temperature (native) |
| Dev Mode | `enabled`, `evaluatorModel` |

### Реактивность

`display()` триггерится из `controller.onBusyChange`. При `busy=true` — баннер + Edit/Delete доменов отключены.

## Связанные концепции

- [[llm-wiki-plugin-settings]] — без `domains` и без `claudeAgent.iclaudePath`
- [[domain-store]] — источник списка доменов
- [[local-config]] — источник `iclaudePath`
- [[domain-entry]] — структура для EditDomainModal
