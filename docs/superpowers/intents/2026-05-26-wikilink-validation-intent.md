# Intent: WikiLink Validation

**Date:** 2026-05-26
**Status:** draft

## Objective

LLM-генерируемые WikiLinks некорректны при ingest и format: неверный YAML-формат frontmatter, aliases в ссылках, пути вместо bare page ID, рассинхрон между body и `wiki_outgoing_links`, мёртвые ссылки. Исправить сейчас, т.к. граф Obsidian строится по этим полям.

## Desired Outcomes

- `wiki_outgoing_links` и `wiki_sources` всегда YAML блок-список: `- "[[page-name]]"`
- Нет `[[Page|alias]]` нигде — ни в теле, ни в frontmatter
- Нет путей: `[[folder/page]]` → `[[page]]` (bare stem only)
- Ссылки в теле синхронизированы с `wiki_outgoing_links` в frontmatter
- Inline JSON array `["[[page]]"]` → заменяется на блок-список
- При невалидных ссылках после retry — страница сохраняется с предупреждением
- Lint проверяет WikiLinks во всех страницах: формат, aliases, мёртвые ссылки — выводит в lint report

## Health Metrics

- `bfsExpand` в `wiki-graph.ts` резолвит ссылки корректно (граф не ломается)
- Lint report не даёт ложных срабатываний на правильные ссылки
- Скорость ingest/format без регрессий (retry только при реальных ошибках)

## Strategic Context

- Interacts with: `src/phases/ingest.ts`, `src/phases/format.ts`, `src/phases/lint.ts`, `src/wiki-graph.ts`, `src/wiki-index.ts`, `parseWithRetry`, `_wiki_schema.md`, `_format_schema.md`
- Priority trade-off: **trust** — ссылки всегда корректны важнее скорости и стоимости

## Constraints

### Steering (behavioral guidance)

- Валидатор исправляет формат, но не блокирует сохранение при мёртвых ссылках
- Aliases `[[Page|alias]]` запрещены полностью (и в теле, и в frontmatter)
- Улучшить промпты/шаблоны одновременно с кодовой валидацией

### Hard (architectural enforcement)

- Максимум 10 retry в `parseWithRetry` — не превышать
- Сигнатуру `parseWithRetry` менять только через proposal-first (требует одобрения)
- При исчерпании retry (10) — сохранить страницу с предупреждением, не бросать ошибку

## Autonomy Zones

- Full autonomy (reversible, low risk): Zod-схемы в phase-файлах, шаблоны `_wiki_schema.md` / `_format_schema.md`, новый модуль `wiki-link-validator.ts`, lint-проверки WikiLinks, тесты
- Guarded (log + confidence threshold): —
- Proposal-first (needs approval): изменение сигнатуры `parseWithRetry`
- No autonomy (human only): —

## Stop Rules

- Halt if: изменение сигнатуры `parseWithRetry` неизбежно — остановиться, показать proposal
- Escalate if: retry-лимит 10 исчерпан, ссылки всё ещё невалидны — сохранить с предупреждением в output
- Done when: `lat check` зелёный + тесты проходят + ingest/format генерируют корректные `[[links]]` во frontmatter и теле
