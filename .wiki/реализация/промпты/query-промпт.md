---
wiki_sources: ["prompts/query.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[run-query]]"
  - "[[llm-utils-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["query.md", "query prompt"]
---
# Query промпт (prompts/query.md)

Шаблон system-промпта для операции query. Инструктирует LLM отвечать строго на основе предоставленных wiki-страниц, использовать WikiLinks при ссылках на страницы.

## Основные характеристики

- **Расположение:** `prompts/query.md`
- **Встраивается:** через esbuild text-loader как `import queryTemplate from "../../prompts/query.md"`
- **Рендеринг:** `render(queryTemplate, variables)` из `phases/template.ts`

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{domain_name}}` | `domain.name` |
| `{{entity_types_block}}` | Сгенерированный блок описания entity_types |
| `{{schema_block}}` | Содержимое `_schema.md` |
| `{{index_block}}` | Содержимое `_index.md` (каталог wiki-страниц) |

### Поведение LLM

- Отвечает только на основе переданного контекста wiki-страниц
- Использует WikiLinks `[[название]]` для ссылок на страницы из индекса
- При `save = true` — ответ дополнительно возвращается в формате JSON-массива страниц для записи

## Связанные концепции

- [[run-query]] — использует этот промпт
- [[llm-utils-ts]] — рендерит промпт через buildChatParams
