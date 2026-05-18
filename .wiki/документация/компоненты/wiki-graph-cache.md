---
wiki_status: stub
wiki_sources:
  - CLAUDE.md
wiki_updated: 2026-05-16
wiki_domain: документация
tags: [компонент, cache, graph, performance]
---

# GraphCache

In-memory кеш графа wiki, используемый фазами `query` и `lint` для ускорения чтения связей между страницами без повторного парсинга.

## Назначение

`GraphCache` (`src/wiki-graph-cache.ts`) — per-domain, hash-keyed кеш в памяти процесса. Хранит структуру графа wiki (страницы и WikiLinks) по доменам, инвалидируется контроллером после write-операций (ingest/init/fix/query-save).

## Ключевые свойства

- **In-memory** — живёт в течение жизни процесса плагина.
- **Per-domain** — отдельный слот на каждый wiki-домен.
- **Hash-keyed** — ключ включает хеш состояния домена для дешёвой проверки актуальности.
- **Controller-managed invalidation** — `WikiController` сбрасывает кеш после операций, изменяющих wiki.

## Где используется

- `phases/query` — `graphCache.get(domain)` перед выбором seed-страниц.
- `phases/lint` — `graphCache.get(domain)` для CT-003 (мёртвые WikiLinks) и CT-004 (orphan-страницы).

## Связанные страницы

- [[wiki-seeds]]
- [[query-operation]]
- [[lint-operation]]
- [[wiki-controller]]
