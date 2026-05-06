---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-links-frontmatter-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - links
  - frontmatter
  - obsidian
aliases:
  - "Links in Frontmatter"
  - "Связанные концепции → Frontmatter"
---

# Links → Frontmatter (исходящие ссылки в YAML)

Перенос WikiLinks на связанные страницы из тела статьи (`## Связанные концепции`) в YAML-frontmatter под поле `links`. Obsidian 1.4+ распознаёт `[[...]]`-синтаксис внутри YAML-значений и включает ссылки в Graph View и Backlinks нативно.

## Основные характеристики

- **Проблема**: раздел `## Связанные концепции` воспринимается как технический артефакт, засоряющий видимый контент
- **Формат поля**: `links: ["[[concept-a]]", "[[concept-b]]"]`; пустой массив допустим
- **Обратная совместимость**: существующие статьи с `## Связанные концепции` не мигрируются; новые генерируются по обновлённой схеме
- **Lint**: `checkStructure` применяет regex `/\[\[([^\]]+)\]\]/g` к полному raw-content включая YAML — ссылки в `links` проверяются автоматически
- **Требования**: Obsidian ≥ 1.4.0

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `templates/_schema.md` | Убрать п.5 из обязательной структуры; добавить `links` в таблицу Frontmatter |
| `prompts/ingest.md` | Добавить `links: []` в пример JSON-ответа LLM |

## Связанные концепции

- [[wiki-init-root-files]]
