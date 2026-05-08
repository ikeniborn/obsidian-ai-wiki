---
wiki_sources: ["src/effective-settings.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[local-config]]"
  - "[[llm-wiki-plugin-settings]]"
  - "[[wiki-controller]]"
  - "[[settings-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["resolveEffective", "effective-settings.ts"]
---
# resolveEffective (effective-settings.ts)

Чистая функция, объединяющая synced-настройки (`data.json`) и per-device overlay (`local.json`) в эффективный объект `LlmWikiPluginSettings`. Поля из `LocalConfig`, если не `undefined`, имеют приоритет над синхронизируемыми.

## Основные характеристики

- **Расположение:** `src/effective-settings.ts`
- **Сигнатура:** `resolveEffective(s: LlmWikiPluginSettings, l: LocalConfig): LlmWikiPluginSettings`
- **Поведение:** pure — не модифицирует входы, возвращает новый объект

### Правила слияния

| Поле | Источник эффективного значения |
|------|---------------------------------|
| `backend` | `l.backend ?? s.backend` |
| `agentLogEnabled` | `l.agentLogEnabled ?? s.agentLogEnabled` |
| `claudeAgent` | spread `s.claudeAgent` + `l.claudeAgent` (per-device перезаписывает совпадающие поля: `model`, `allowedTools`) |
| `nativeAgent` | spread `s.nativeAgent` + `l.nativeAgent` (per-device перезаписывает: `baseUrl`, `apiKey`, `model`, `temperature`, `topP`, `numCtx`) |
| остальное | из `s` без изменений |

### Зачем

`apiKey`, `baseUrl`, выбор `backend`, путь `iclaude.sh`, `model` — машинно-зависимые или чувствительные. Если хранить их в `data.json` — Obsidian Sync разнесёт чужой ключ или несуществующий путь на другие устройства. `LocalConfig` хранится в `<plugin-dir>/local.json`, не синхронизируется. `resolveEffective()` собирает «как если бы всё было в одном месте» — все потребители (`controller.ts`, `settings.ts`) работают с эффективным `LlmWikiPluginSettings`.

### Где вызывается

- `WikiController.dispatch()` / `dispatchChat()` — проверка backend и API-credentials
- `WikiController.buildAgentRunner()` — параметры spawn ClaudeCliClient или OpenAI клиента
- `LlmWikiSettingTab.render()` — отображение текущих эффективных значений в UI

## Связанные концепции

- [[local-config]] — структура `LocalConfig` и стор для overlay
- [[llm-wiki-plugin-settings]] — базовый тип synced-настроек
- [[wiki-controller]] — основной потребитель
- [[settings-ts]] — отображает эффективные значения, пишет patch только в `LocalConfig`
