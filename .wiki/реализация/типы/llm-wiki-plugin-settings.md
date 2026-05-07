---
wiki_sources: ["src/types.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[run-event]]"
  - "[[wiki-controller]]"
  - "[[domain-store]]"
  - "[[local-config]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LlmWikiPluginSettings", "DEFAULT_SETTINGS", "PluginSettings"]
---
# LlmWikiPluginSettings (types.ts)

Конфигурация плагина. Сериализуется в `data.json` Obsidian. **Не содержит** `domains[]` (вынесены в `!Wiki/_domain.json`) и `claudeAgent.iclaudePath` (вынесен в `<plugin-dir>/local.json`).

## Основные характеристики

- **Расположение:** `src/types.ts`
- **Интерфейс:** `LlmWikiPluginSettings`
- **Значения по умолчанию:** `DEFAULT_SETTINGS`

### Ключевые поля

| Поле | Тип | Описание |
|------|-----|---------|
| `backend` | `"claude-agent" \| "native-agent"` | Активный backend |
| `historyLimit` | `number` | Максимум записей истории (default 20) |
| `timeouts` | `{ingest, query, lint, fix, init}` | Таймауты операций (сек) |
| `systemPrompt` | `string` | Top-level системный промпт |
| `maxTokens` | `number` | Top-level лимит токенов |
| `agentLogEnabled` | `boolean` | Логирование JSONL потока |
| `claudeAgent` | `{model, spawnCwd, allowedTools, ...}` | Без `iclaudePath` (см. [[local-config]]) |
| `nativeAgent` | `{baseUrl, apiKey, model, ...}` | Native backend |
| `devMode` | `{enabled, evaluatorModel}` | Без `logDir` |

### Что вынесено из `data.json`

| Было | Стало | Причина |
|------|-------|---------|
| `settings.domains[]` | `!Wiki/_domain.json` ([[domain-store]]) | Синхронизируется с заметками; крупные коллекции не вписываются в `data.json` |
| `settings.claudeAgent.iclaudePath` | `<plugin-dir>/local.json` ([[local-config]]) | Machine-specific путь, нельзя синкать через Obsidian Sync |

Миграция выполняется в `migrateLegacyData()` ([[main-ts]]) идемпотентно при загрузке плагина.

### Таймауты по умолчанию (секунды)

| Операция | Default |
|---------|---------|
| ingest | 300 |
| query | 300 |
| lint | 900 |
| fix | 900 |
| init | 3600 |

### perOperation модели

При `perOperation: true` — отдельная модель на операцию. По умолчанию для claude-agent: haiku → ingest, sonnet → остальные.

## Связанные концепции

- [[domain-entry]] — теперь хранится в [[domain-store]], не в settings
- [[local-config]] — `iclaudePath` отдельно
