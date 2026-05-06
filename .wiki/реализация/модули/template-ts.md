---
wiki_sources: ["src/phases/template.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links: []
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["template.ts", "render"]
---
# template.ts (render)

Минимальный шаблонизатор строк. Один экспортируемый метод.

## Основные характеристики

- **Расположение:** `src/phases/template.ts`
- **Функция:** `render(template: string, vars: Record<string, string>): string`

### Поведение

Заменяет все вхождения `{{key}}` на `vars[key]`. Если ключ отсутствует в `vars` — оставляет `{{key}}` без изменений (graceful degradation).

Используется во всех промпт-файлах: `prompts/ingest.md`, `prompts/query.md`, `prompts/fix.md`, `prompts/chat.md`, `prompts/lint.md`, `prompts/init.md`.
