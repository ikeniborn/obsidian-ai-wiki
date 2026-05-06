---
wiki_sources: [docs/superpowers/plans/2026-05-05-domain-form-ux.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [EditDomainModal, модалы]
---
# src/modals.ts

Содержит модальные диалоги плагина: `EditDomainModal`, `WikiQuestionModal` (interactive mode), `AddDomainModal`.

## EditDomainModal (Domain Form UX)

После рефакторинга `EditDomainModal` хранит состояние в трёх полях:

- `entityTypesMode: "cards" | "json"` — текущий режим отображения
- `entityTypesList: EntityType[]` — parsed список в card-режиме
- `sourcePathsList: string[]` — список путей (поддерживает пути с пробелами)

Методы:
- `renderEntityTypes(container)` — рендер карточек или textarea; перерисовывает себя при переключении
- `renderEntityTypeCard(container, et)` — одна карточка с type, subfolder, description, cues, min_mentions
- `renderSourcePaths(container)` — список с удалением + поле добавления
- `handleSave()` — маршрутизирует по `entityTypesMode`, собирает `DomainEntry` и вызывает `onSave`

## Валидация handleSave в json-mode

- `JSON.parse()` + проверка что результат является `Array`
- Проверка что каждый элемент — объект (не массив, не примитив)
- При ошибке: показывается inline-сообщение, `onSave` не вызывается
