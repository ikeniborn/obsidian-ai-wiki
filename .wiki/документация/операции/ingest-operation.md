---
wiki_status: developing
wiki_sources:
  - README.md
  - "[[docs/superpowers/specs/2026-05-17-mobile-query-seed-design.md]]"
  - "[[prompts/ingest.md]]"
  - "[[docs/superpowers/plans/2026-05-19-agent-stability-audit.md]]"
wiki_updated: 2026-05-20
wiki_domain: документация
wiki_keywords: [ingest, extraction, parseWithRetry, WikiPagesOutputSchema, reasoning, annotation, upsertIndexAnnotation, wiki-keywords]
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

После [[agent-stability-audit-design]] промпт возвращает `{reasoning, pages}` вместо сырого массива:

```json
{
  "reasoning": "Обоснование: какие сущности извлечены и почему",
  "pages": [{
    "path": "!Wiki/<domain>/<type>/EntityName.md",
    "content": "---\nwiki_keywords: [токен1, токен2]\n...\n---\n# EntityName\n...",
    "annotation": "Краткое описание сущности для поиска по смыслу"
  }]
}
```

Функция `parseWithRetry` с `WikiPagesOutputSchema` валидирует структуру через Zod. Поле `reasoning` отдаётся пользователю как `{ kind: "assistant_text", isReasoning: true }` до начала записи страниц. Старая `parseJsonPages()` сохранена только для тестов.

## Правило путей

Путь каждой статьи = `!Wiki/<domain>/<type>/<Article>.md` — ровно 4 сегмента. Домен в пути не дублируется.

## Обновление индекса

После записи каждой wiki-страницы вызывается `upsertIndexAnnotation` ([[wiki-index]]), которая добавляет/обновляет строку `PageId: annotation` в `_index.md`. Это используется фазой [[query-operation]] для Jaccard seed selection.

## Промпт (`prompts/ingest.md`)

Ключевые правила промпта:
- `wiki_keywords: [5-10 ключевых токенов домена, строчные, дефис-вместо-пробела]`
- `wiki_sources` каждый элемент в формате `[[path/to/source]]` (тип Links в Obsidian)
- CREATE / UPDATE / SKIP логика: создать если сущность новая и упоминаний >= min_mentions, обновить если страница существует (не удалять старое), пропустить при недостаточном количестве упоминаний
- Раздел "## Основные характеристики" обязателен на каждой странице
- Синтез, не копирование

## Валидация вывода (Agent Stability Audit)

`parseWithRetry` с `WikiPagesOutputSchema` (`callSite: "ingest.pages"`) заменяет стриминг + `parseJsonPages`:
- Bufers полный ответ LLM перед парсингом
- При Zod-ошибке — retry (до `opts.structuredRetries` раз)
- При финальной ошибке — yield `{ kind: "error" }`, операция завершается

## Ограничения платформы

Только desktop. На мобильных устройствах операция отклоняется с Notice.

## История изменений

- **2026-05-14** — создана страница.
- **2026-05-17** — обновлено по [[mobile-query-seed-design]]: parseJsonPages с annotation?, upsertIndexAnnotation per page, удалён updateIndex.
- **2026-05-20** — обновлено по [[agent-stability-audit-design]]: промпт возвращает `{reasoning, pages}`, `parseJsonPages` заменена на `parseWithRetry(WikiPagesOutputSchema)`.

## Связанные страницы

- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[agent-runner]]
- [[wiki-index]]
- [[mobile-query-seed-design]]
- [[agent-stability-audit-design]]
- [[structured-output-retry]]
- [[parse-with-retry]]
