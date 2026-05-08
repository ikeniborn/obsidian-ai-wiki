---
wiki_sources: ["src/settings.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-wiki-plugin-settings]]"
  - "[[domain-entry]]"
  - "[[domain-store]]"
  - "[[local-config]]"
  - "[[effective-settings]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["settings.ts", "LlmWikiSettingTab"]
---
# settings.ts (LlmWikiSettingTab)

Вкладка настроек плагина. `PluginSettingTab` с UI: общие, backend, домены, dev mode. Все machine-specific и чувствительные поля (`backend`, `iclaudePath`, API-credentials, `model`, `agentLogEnabled`) пишутся в `LocalConfig` через `LocalConfigStore`. UI рендерится async-aware: `display() → refresh() async → render() sync`. Эффективные значения для отображения собираются через [[effective-settings|resolveEffective()]].

## Основные характеристики

- **Расположение:** `src/settings.ts`
- **Класс:** `LlmWikiSettingTab extends PluginSettingTab`
- **Метод:** `display()` — синхронная точка входа Obsidian; делегирует `void this.refresh()`

### Async refresh pattern

```
display(): void              // вызов от Obsidian
  → void this.refresh()      // async, не блокирует
      → await domainStore.load()      → cachedDomains
      → await localConfigStore.load() → localCache
      → this.render()                  // sync, использует кэши + resolveEffective
```

Поля кэша: `cachedDomains: DomainEntry[]`, `localCache: LocalConfig`. На `DomainCorruptError` — `Notice` + `cachedDomains = []`.

### Patch-хелперы

| Хелпер | Запись | Применение |
|--------|--------|-----------|
| `patchLocal(patch)` | top-level поля `LocalConfig` | `iclaudePath`, `backend`, `agentLogEnabled` |
| `patchLocalNative(patch)` | вложенный `nativeAgent` overlay | `baseUrl`, `apiKey`, `model`, `temperature`, `numCtx` |
| `patchLocalClaude(patch)` | вложенный `claudeAgent` overlay | `model`, `allowedTools` |

Все три обновляют `localCache` и пишут через `localConfigStore.save()`. Per-operation секция и dev-mode остаются в synced `plugin.settings` через `plugin.saveSettings()`.

### Секции UI

| Секция | Содержимое | Источник |
|--------|-----------|----------|
| General | `systemPrompt`, `maxTokens` (если !perOperation && !claude-agent), `timeouts`, `historyLimit`, `agentLogEnabled` (десктоп) | synced + local (`agentLogEnabled`) |
| Domains | Список из `cachedDomains`: Edit / Delete | `DomainStore` |
| Backend | Dropdown `claude-agent` / `native-agent` (скрыт на мобильном — только cloud LLM) | `local.backend` |
| claude-agent | `iclaudePath`, `model`, `allowedTools`, `perOperation` | `local` (через `patchLocal`/`patchLocalClaude`) |
| native-agent | `baseUrl`, `apiKey`, `model`, `numCtx`, `temperature`, `perOperation` (десктоп) | `local.nativeAgent` (через `patchLocalNative`) |
| Per-Operation | Per-op `model` (claude) или `model + maxTokens + temperature` (native) | synced |
| Dev Mode | `enabled`, `evaluatorModel` (только десктоп) | synced |

### Mobile-only UI

При `Platform.isMobile`:
- Скрыт выбор backend (forced `native-agent`), вместо него — ссылка на mobile-cloud-ollama.md
- Скрыт `agentLogEnabled` toggle, dev-mode секция, claude-agent секция, per-operation toggle
- Native-agent остаётся, но без переключателя per-operation

### Реактивность

`display()` триггерится из `controller.onBusyChange`. При `busy=true` — баннер + Edit/Delete доменов отключены.

## Связанные концепции

- [[llm-wiki-plugin-settings]] — synced часть конфига; чувствительные/per-device поля выгружены в `LocalConfig`
- [[local-config]] — overlay для machine-specific полей; именно туда пишет UI
- [[effective-settings]] — функция, формирующая значения для отображения
- [[domain-store]] — источник списка доменов
- [[domain-entry]] — структура для EditDomainModal
