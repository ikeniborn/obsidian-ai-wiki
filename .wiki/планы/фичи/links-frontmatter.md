---
wiki_sources: [docs/superpowers/plans/2026-05-05-links-frontmatter.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [frontmatter-links, связанные-концепции]
---
# Links → Frontmatter

Фича переносит исходящие ссылки wiki-статей из обязательного раздела `## Связанные концепции` в frontmatter-поле `links`, сохраняя поддержку Obsidian Graph View.

## Основные характеристики

- Obsidian 1.4+ распознаёт WikiLinks в формате `"[[page]]"` в frontmatter YAML
- Формат поля: `links: ["[[page-a]]", "[[page-b]]"]`
- `_schema.md` обновляется: п.5 обязательной структуры (Связанные концепции) удаляется, в таблицу Frontmatter добавляется строка `links`
- `prompts/ingest.md` — пример JSON-ответа LLM обновляется: добавляется `links: []` в frontmatter примера
- Изменения только в текстовых файлах, код не затрагивается

## До и после

```yaml
# До (обязательный раздел в body):
## Связанные концепции
- [[другая-страница]]

# После (frontmatter):
links: ["[[другая-страница]]"]
```
