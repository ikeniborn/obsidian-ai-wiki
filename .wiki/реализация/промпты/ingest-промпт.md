---
wiki_sources: ["prompts/ingest.md"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[run-ingest]]"
  - "[[llm-utils-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["ingest.md", "ingest prompt"]
---
# Ingest промпт (prompts/ingest.md)

Шаблон system-промпта для операции ingest. Инструктирует LLM извлекать сущности из источника и возвращать массив wiki-страниц в формате JSON.

## Основные характеристики

- **Расположение:** `prompts/ingest.md`
- **Встраивается:** через esbuild text-loader как `import ingestTemplate from "../../prompts/ingest.md"`
- **Рендеринг:** `render(ingestTemplate, variables)` из `phases/template.ts`

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{domain_name}}` | `domain.name` |
| `{{entity_types_block}}` | Сгенерированный блок описания entity_types |
| `{{lang_notes}}` | `domain.language_notes` |
| `{{wiki_path}}` | vault-relative путь wiki-папки домена |
| `{{today}}` | ISO-дата (YYYY-MM-DD) |
| `{{schema_block}}` | Содержимое `_schema.md` (до 2000 символов) |
| `{{source_path}}` | Путь к источнику |

### Формат ответа LLM

LLM должен вернуть только JSON-массив:

```json
[
  {
    "path": "!Wiki/domain/subfolder/entity-name.md",
    "content": "---\nwiki_sources: [...]\n..."
  }
]
```

Парсинг выполняет `parseJsonPages()` в `ingest.ts`.

### Правила в промпте

- CREATE: сущность не существует, упоминаний >= min_mentions_for_page
- UPDATE: добавить информацию, не удалять старую
- SKIP: мало упоминаний или информация уже есть
- Путь страницы должен начинаться с `{{wiki_path}}/`
- Frontmatter обязателен: wiki_sources, wiki_updated, wiki_status

## Связанные концепции

- [[run-ingest]] — использует этот промпт
- [[llm-utils-ts]] — рендерит промпт через buildChatParams
