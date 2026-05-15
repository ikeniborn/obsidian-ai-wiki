---
wiki_status: developing
wiki_sources:
  - prompts/init.md
  - prompts/init-incremental.md
  - prompts/lint.md
wiki_updated: 2026-05-15
wiki_domain: документация
wiki_outgoing_links:
  - "[[init-operation]]"
  - "[[lint-operation]]"
tags: [паттерн, LLM, JSON, prompt]
aliases: ["reasoning first", "chain-of-thought JSON"]
---

# Reasoning-First JSON

Соглашение об ответах LLM-промптов: поле `reasoning` всегда первым в возвращаемом JSON. Используется во всех промптах операций init и lint.

## Основные характеристики

- Поле `reasoning` содержит пошаговое обоснование принятых решений (выбор entity_types, изменения структуры домена и т.д.)
- Размещается первым в JSON-объекте для того, чтобы модель формулировала обоснование до финального ответа — это улучшает качество downstream-полей
- Применяется в промптах: `prompts/init.md`, `prompts/init-incremental.md`, `prompts/lint.md`

## Применение

| Промпт | Поля после reasoning |
|--------|---------------------|
| `init.md` | `id`, `name`, `wiki_folder`, `source_paths`, `entity_types`, `language_notes` |
| `init-incremental.md` | `entity_types`, `language_notes` |
| `lint.md` | `entity_types`, `language_notes` |

## Output JSON Example в промптах

`prompts/init.md` и `prompts/init-incremental.md` дополнены секциями `## Output JSON Example` — эталон формы ответа с reasoning-полем первым. Снижает частоту retry в [[parse-with-retry]] при работе native backend ([[backend-strategy]]).

## Связанные страницы

- [[init-operation]]
- [[lint-operation]]
- [[structured-output-retry]] — паттерн валидации формы ответа
- [[parse-with-retry]] — использует zod-схемы, обязывающие поле `reasoning`
