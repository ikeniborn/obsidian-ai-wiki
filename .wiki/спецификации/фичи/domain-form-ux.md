---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-domain-form-ux-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - ux
  - modals
aliases:
  - "EditDomainModal UX"
  - "Entity Type Cards"
---

# Domain Form UX (EditDomainModal)

Улучшение UX трёх секций формы редактирования домена: entity_types показываются как карточки (с fallback на JSON-редактор), source_paths — как динамический список с кнопками добавления/удаления, language_notes — как многострочный textarea.

## Основные характеристики

### Entity Types — карточки + JSON fallback

- **Read mode (дефолт)**: каждый `EntityType` — карточка с `type` в заголовке, `description`, тегами `extraction_cues`, `wiki_subfolder`, `min_mentions_for_page`
- **Edit mode**: по кнопке «Edit JSON» → textarea с raw JSON; кнопка «← Карточки» возвращает назад (с валидацией JSON)
- **Состояние**: `entityTypesMode: "cards" | "json"`, `entityTypesList: EntityType[]`, `entityTypesVal: string`
- **Save**: в card-mode берётся из `entityTypesList` (ошибки JSON невозможны); в json-mode — парсинг с инлайн-ошибкой

### Source Paths — список с контролами

- **Структура**: каждый путь — строка с кнопкой `[×]`; снизу input + кнопка «+ Добавить» (Enter тоже добавляет)
- **Обработка**: `trim()` по краям, внутренние пробелы сохраняются; дубликаты и пустые строки фильтруются при Save
- **Состояние**: `sourcePathsList: string[]` вместо `sourcePathsVal: string`

### Language Notes — textarea

- `addTextArea(...)` вместо `addText(...)`; `rows=4`, `resize: vertical`; перенос строк сохраняется

## Затронутые файлы

| Файл | Что меняется |
|---|---|
| `src/modals.ts` | `EditDomainModal`: новые поля состояния, `onOpen()`, `handleSave()` |
| `styles.css` | Стили карточек entity_types, строк source_paths |

## Связанные концепции

- [[domain-map-in-vault]]
- [[modals-ts]]
