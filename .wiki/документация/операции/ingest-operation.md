---
wiki_status: developing
wiki_sources:
  - README.md
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
wiki_updated: 2026-05-17
wiki_domain: документация
wiki_keywords: [ingest, extraction, parseJsonPages, annotation, upsertIndexAnnotation, wiki-keywords]
tags: [операция, ingest, extraction]
---

# Ingest Operation

Разбирает файл-источник (заметку), извлекает именованные сущности (люди, технологии, процессы, термины) и создаёт или обновляет wiki-страницы.

## Назначение

Ключевая операция накопления знаний: каждый ingest обогащает wiki новыми фактами и связями. Источники не изменяются — только читаются.

## UX-поток

1. Пользователь открывает заметку в Obsidian.
2. `Command Palette` → `AI Wiki: Ingestion активного файла`.
3. Прогресс шагов агента виден в реальном времени в боковой панели.
4. После завершения — новые wiki-страницы появляются в папке домена.

## Выходной формат LLM (JSON)

```json
[{
  "path": "wiki/Domain/EntityName.md",
  "content": "---\nwiki_keywords: [токен1, токен2]\n...\n---\n# EntityName\n...",
  "annotation": "Краткое описание сущности для поиска по смыслу"
}]
```

Функция `parseJsonPages` возвращает `{ path, content, annotation? }[]`.

## Обновление индекса

После записи каждой wiki-страницы вызывается `upsertIndexAnnotation` ([[wiki-index]]), которая добавляет/обновляет строку `PageId: annotation` в `_index.md`. Это используется фазой [[query-operation]] для Jaccard seed selection.

## Промпт (`prompts/ingest.md`)

Содержит правило: `wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]` и инструкцию добавлять поле `annotation` в JSON-ответ.

## Ограничения платформы

Только desktop. На мобильных устройствах операция отклоняется с Notice.

## История изменений

- **2026-05-14** — создана страница.
- **2026-05-17** — обновлено по [[mobile-query-seed-design]]: parseJsonPages с annotation?, upsertIndexAnnotation per page, удалён updateIndex.

## Связанные страницы

- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[agent-runner]]
- [[wiki-index]]
- [[mobile-query-seed-design]]
