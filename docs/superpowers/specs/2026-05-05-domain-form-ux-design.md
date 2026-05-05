# Domain Form UX — Design Spec

**Date:** 2026-05-05  
**Scope:** `EditDomainModal` в `src/modals.ts`  
**Goal:** Улучшить UX трёх секций формы редактирования домена.

---

## Контекст

`EditDomainModal` — модальное окно редактирования домена. Открывается из настроек плагина по кнопке «Edit» рядом с каждым доменом.

Три секции с UX-проблемами:

| Секция | Текущее состояние | Проблема |
|---|---|---|
| `entity_types` | Raw JSON textarea, 10 строк, monospace | Тяжело читать при 3+ типах; LLM генерирует JSON — пользователь только смотрит |
| `source_paths` | Textarea, по одному пути на строку | Нет контролов добавить/удалить, пути с пробелами выглядят опасно |
| `language_notes` | Однострочный `<input>` | Многострочный текст обрезается, неудобно читать |

---

## Решение: Подход A — Read-mode + JSON fallback

### 1. Entity Types — карточки по умолчанию, JSON по кнопке

**Read mode (по умолчанию):**
- Если `entity_types` пуст (`[]` или не задан) — показывается текстовая подсказка: «Типы сущностей не заданы. Нажмите Edit JSON чтобы добавить.»
- Каждый `EntityType` — карточка с заголовком (поле `type`) и подробностями:
  - `description` — текст под заголовком
  - `extraction_cues` — список тегов
  - `wiki_subfolder` — справа в заголовке (`suffix/`)
  - `min_mentions_for_page` — мелким текстом внизу карточки (если задан)
- Кнопка **«Edit JSON»** в правом верхнем углу секции переключает в textarea

**Edit mode (по кнопке «Edit JSON»):**
- Textarea с текущим JSON (авто-синхронизируется из read-mode)
- Кнопка **«← Карточки»** возвращает обратно; при переключении JSON парсится — если невалиден, показывается предупреждение, переключение не происходит
- Валидация при Save: если edit-mode активен и JSON невалиден — показывается ошибка инлайн под textarea (поведение как сейчас)

**Состояние в компоненте:**
```ts
private entityTypesMode: "cards" | "json" = "cards";
private entityTypesList: EntityType[];   // источник истины в card-mode
private entityTypesVal: string;          // источник истины в json-mode
```

**При Save:**
- В card-mode: `entityTypes` берётся из `entityTypesList` (ошибки JSON невозможны)
- В json-mode: парсится `entityTypesVal`, при ошибке — блокирует сохранение

---

### 2. Source Paths — per-item список с контролами

**Было:** `textarea` со строками вида `/путь1\n/путь2`.

**Стало:** динамический список:
- Каждый путь — строка: `[monospace div с путём] [кнопка ×]`
- Снизу: `[input placeholder="/путь/к/папке"] [кнопка + Добавить]`
- Enter в поле добавляет путь и очищает поле

**Обработка пробелов в путях:**
- Пути хранятся как `string[]` без изменений
- При добавлении: `path.trim()` только по краям — внутренние пробелы сохраняются
- Дубликаты и пустые строки отфильтровываются при сохранении
- В UI путь отображается целиком, длинные обрезаются через `text-overflow: ellipsis` + `title` атрибут с полным путём

**Состояние в компоненте:**
```ts
private sourcePathsList: string[];  // вместо sourcePathsVal: string
```

---

### 3. Language Notes — textarea

**Было:** `addText(...)` — однострочный `<input>`.

**Стало:** `addTextArea(...)` — многострочный, `rows=4`, `resize: vertical`.

Данные: `language_notes: string` без изменений. Перенос строк (`\n`) сохраняется и передаётся LLM как есть.

---

## Файлы, затронутые изменениями

| Файл | Что меняется |
|---|---|
| `src/modals.ts` | `EditDomainModal`: новые поля состояния, `onOpen()`, `handleSave()` |
| `styles.css` | Стили карточек entity_types, строк source_paths |

`domain-map.ts`, `types.ts`, `controller.ts` — **не меняются**.

---

## Что не входит в scope

- Добавление/удаление entity_types из карточек в read-mode (только просмотр + JSON-edit)
- Валидация существования пути source_paths на диске
- Drag-and-drop reorder для source_paths
