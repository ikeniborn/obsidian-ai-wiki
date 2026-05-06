---
wiki_sources: ["src/modals.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[entity-type]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["modals.ts", "Modal компоненты", "QueryModal", "DomainModal"]
---
# modals.ts (Modal компоненты)

Все модальные окна плагина. Используют Obsidian Modal API. Каждый класс решает одну задачу: ввод запроса, выбор домена, подтверждение, редактирование домена, обработка ошибок файла.

## Основные характеристики

- **Расположение:** `src/modals.ts`
- **Зависимости:** `obsidian`, `./domain-map`, `./i18n`

### Классы модалей

| Класс | Назначение |
|-------|-----------|
| `BusyCloseModal` | Диалог при закрытии во время активной операции: «Подождать / Отменить» |
| `ConfirmModal` | Универсальный диалог подтверждения (заголовок + список строк) |
| `QueryModal` | Ввод вопроса для query / query-save; textarea, submit по Enter |
| `DomainModal` | Выбор домена из dropdown (или текстовое поле при отсутствии доменов); флаг dryRun |
| `AddDomainModal` | Форма добавления нового домена: id, name, wiki_folder, source_paths с FolderSuggest |
| `FileErrorModal` | Ошибка при обработке файла: Skip / Retry / Stop — возвращает Promise |
| `EditDomainModal` | Полная форма редактирования домена: entity_types (cards/JSON), source_paths, language_notes |

### `FolderSuggest`

`AbstractInputSuggest<TFolder>` — автодополнение папок vault при вводе source_paths. Используется в `AddDomainModal`.

### `EditDomainModal` — режимы entity_types

Поддерживает два режима просмотра/редактирования entity_types:
- **cards** — карточки с визуальным представлением (`type`, `wiki_subfolder`, `description`, `extraction_cues`, `min_mentions_for_page`)
- **json** — raw JSON-textarea с валидацией при переключении обратно в cards

### `FileErrorModal`

Единственный Modal с асинхронным интерфейсом: конструктор создаёт `Promise<"skip" | "retry" | "stop">`, resolve вызывается при клике кнопки или закрытии (default: "skip").

## Связанные концепции

- [[domain-entry]] — структура редактируемого домена
- [[entity-type]] — тип сущности, отображаемый в cards-режиме EditDomainModal
