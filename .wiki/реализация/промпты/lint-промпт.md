---
wiki_sources: ["prompts/lint.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[run-lint]]"
  - "[[llm-utils-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["lint.md", "lint prompt"]
---
# Lint промпт (prompts/lint.md)

Шаблон system-промпта для операции lint. Инструктирует LLM проверять качество wiki-домена: дублирование, пробелы, размытые определения, устаревший контент.

## Основные характеристики

- **Расположение:** `prompts/lint.md`
- **Встраивается:** через esbuild text-loader как `import lintTemplate from "../../prompts/lint.md"`
- **Рендеринг:** `render(lintTemplate, variables)` из `phases/template.ts`

### Переменные шаблона

| Переменная | Источник |
|-----------|---------|
| `{{domain_name}}` | `domain.name` |
| `{{entity_types_block}}` | Сгенерированный блок описания entity_types |

### Формат ответа LLM

LLM возвращает краткий отчёт в markdown с перечислением найденных проблем по категориям: дублирование, пробелы в покрытии, размытые определения, устаревший контент.

## Связанные концепции

- [[run-lint]] — использует этот промпт
- [[llm-utils-ts]] — рендерит промпт через buildChatParams
