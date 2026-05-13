---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-08-format-operation-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [спецификация, format, дизайн]
---

# Format Operation — Design Spec

Дата: 2026-05-08. Спецификация операции Format — анализ не-wiki markdown-страниц с генерацией preview и итерацией через чат.

## Ключевые решения

| Аспект | Решение |
|---|---|
| Формат ответа LLM | JSON `{ report, formatted }` с `response_format: json_object` |
| Хранение preview | `!Temp/<basename>.formatted.md` — вне wiki-доменов |
| Apply | `vault.modify(TFile, content)` — обновляет буфер редактора (не `adapter.write`) |
| Validator | `significantTokens()` сравнивает оригинал с formatted; warning при missing |
| Vision | `backend === "claude-agent"` → `hasVision=true` → image_url content blocks |
| Refine | `_pendingFormat.chat` хранит историю; каждый refine → полный повторный вызов LLM |

## Контракт LLM-ответа

```json
{
  "report": "## Предлагаемые изменения\n- [frontmatter] добавлены tags\n- ...",
  "formatted": "---\ntags: [...]\n---\n\n# Заголовок\n..."
}
```

## Файлы

| Файл | Роль |
|---|---|
| `src/phases/format.ts` | `runFormat()` |
| `src/phases/format-utils.ts` | `extractJsonObject`, `significantTokens`, `missingTokens` |
| `prompts/format.md` | Системный промт с `{{format_schema}}` и `{{has_vision}}` |
| `templates/_format-schema.md` | Правила форматирования не-wiki страниц |

## Edge cases

- Нет активного файла → Notice
- Файл не `.md` → Notice
- `!Temp/` отсутствует → `vault.createFolder("!Temp")` лениво
- `finish_reason === "length"` → ошибка без retry
- Plugin reload → `_pendingFormat` теряется, orphan temp остаётся в `!Temp/`

## Связанные страницы

- [[format-operation]]
- [[wiki-controller]]
