---
wiki_sources: ["src/types.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[run-event]]"
  - "[[wiki-controller]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LlmWikiPluginSettings", "DEFAULT_SETTINGS", "PluginSettings"]
---
# LlmWikiPluginSettings (types.ts)

Полная конфигурация плагина. Сериализуется в `data.json` Obsidian. Содержит настройки backend, доменов, таймаутов, истории и devMode.

## Основные характеристики

- **Расположение:** `src/types.ts`
- **Интерфейс:** `LlmWikiPluginSettings`
- **Значения по умолчанию:** `DEFAULT_SETTINGS`

### Ключевые поля

| Поле | Тип | Описание |
|------|-----|---------|
| `backend` | `"claude-agent" \| "native-agent"` | Активный backend |
| `domains` | `DomainEntry[]` | Конфигурация доменов |
| `historyLimit` | `number` | Максимум записей истории (default 20) |
| `timeouts` | `{ingest, query, lint, fix, init}` | Таймауты операций в секундах |
| `claudeAgent` | `{iclaudePath, model, spawnCwd, ...}` | Настройки claude-agent backend |
| `nativeAgent` | `{baseUrl, apiKey, model, temperature, ...}` | Настройки native-agent backend |
| `devMode` | `{enabled, logDir, evaluatorModel}` | Режим разработки |

### Таймауты по умолчанию (секунды)

| Операция | Default |
|---------|---------|
| ingest | 300 |
| query | 300 |
| lint | 900 |
| fix | 900 |
| init | 3600 |

### perOperation модели

При `perOperation: true` каждая операция может использовать отдельную модель. По умолчанию для claude-agent: haiku → ingest, sonnet → остальные.

## Связанные концепции

- [[domain-entry]] — тип элемента массива `domains`
