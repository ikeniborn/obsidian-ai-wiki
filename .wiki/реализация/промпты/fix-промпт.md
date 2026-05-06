---
wiki_sources: ["prompts/fix.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[run-fix]]"
  - "[[entity-type]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["fix.md", "fix prompt"]
---
# Fix промпт (prompts/fix.md)

Системный промпт для операции fix. Инструктирует LLM исправлять wiki-страницы домена и возвращать только изменённые страницы в JSON-формате.

## Основные характеристики

- **Расположение:** `prompts/fix.md`
- **Встраивается:** через esbuild text-loader
- **Рендеринг:** `render(fixTemplate, variables)` из `phases/template.ts`

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{domain_name}}` | `domain.name` |
| `{{fix_instruction}}` | Инструкция конкретной fix-операции |
| `{{entity_types_block}}` | Блок описания entity_types домена |
| `{{wiki_path}}` | Путь к папке домена в wiki |
| `{{today}}` | Текущая дата |

### Выходной формат

```json
[{"path": "wiki_path/EntityName.md", "content": "полный контент страницы"}]
```

Только изменённые страницы. Неизменённые страницы не включаются в ответ.

## Связанные концепции

- [[run-fix]] — использует этот промпт
- [[entity-type]] — entity_types передаются в `{{entity_types_block}}`
