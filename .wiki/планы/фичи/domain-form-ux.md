---
wiki_sources: [docs/superpowers/plans/2026-05-05-domain-form-ux.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [edit-domain-modal, ux-карточки]
---
# Domain Form UX (EditDomainModal)

Фича улучшает UX редактирования домена: entity_types отображаются как карточки (вместо сырого JSON), source_paths — как список с кнопкой удаления, language_notes — как многострочное поле.

## Основные характеристики

- `EditDomainModal` получает поля: `entityTypesMode: "cards"|"json"`, `entityTypesList: EntityType[]`, `sourcePathsList: string[]`
- `renderEntityTypes(container)` — перерисовывает секцию при переключении режима, кнопка-переключатель «Редактировать JSON» / «← Карточки»
- `renderSourcePaths(container)` — список строк с кнопкой `×` удаления + поле добавления нового пути
- `handleSave()` маршрутизирует: в card-mode берёт `entityTypesList`, в json-mode парсит `entityTypesVal`
- Пути с пробелами хранятся корректно (массив строк, без разбивки по пробелу)
- CSS-классы: `llm-wiki-et-card`, `llm-wiki-sp-row` и другие — добавляются в `styles.css`

## Режим карточки entity_type

Каждая карточка показывает: тип, subfolder, описание, extraction_cues (теги), min_mentions. Переключение в JSON-режим сериализует текущий `entityTypesList`. Переключение обратно валидирует и парсит JSON.
