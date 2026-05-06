---
wiki_sources: ["prompts/init.md"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[run-init]]"
  - "[[domain-entry]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["init.md", "init prompt"]
---
# Init промпт (prompts/init.md)

Шаблон system-промпта для операции init. Инструктирует LLM сгенерировать запись домена (`DomainEntry`) с entity_types на основе примеров файлов vault.

## Основные характеристики

- **Расположение:** `prompts/init.md`
- **Встраивается:** через esbuild text-loader

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{domain_id}}` | Переданный id домена |
| `{{vault_name}}` | `app.vault.getName()` |
| `{{schema_block}}` | Содержимое `_schema.md` (до 1500 символов) |
| `{{index_block}}` | Содержимое `_index.md` (до 1000 символов) |

### Формат ответа LLM

LLM должен вернуть только JSON объект `DomainEntry`:

```json
{
  "id": "domain-id",
  "name": "Человекочитаемое название",
  "wiki_folder": "vaults/VaultName/!Wiki/domain-id",
  "source_paths": [],
  "entity_types": [...],
  "language_notes": "..."
}
```

LLM часто возвращает `wiki_folder` с префиксом `vaults/<name>/` — код в `runInit` его нормализует.

## Связанные концепции

- [[run-init]] — использует этот промпт для генерации конфигурации домена
