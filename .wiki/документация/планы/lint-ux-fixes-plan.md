---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-18-lint-ux-fixes.md
  - docs/superpowers/specs/2026-05-18-lint-ux-fixes-design.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [plan, lint, ux, tdd, view, i18n, clipboard]
wiki_outgoing_links:
  - "[[lint-ux-fixes-design]]"
  - "[[lint-operation]]"
  - "[[llm-wiki-view]]"
---

# Lint UX Fixes — Implementation Plan

Реализационный план [[lint-ux-fixes-design]]: пять независимых улучшений операции lint и слоя view.

**Цель:** Пять независимых фиксов — append `_log.md`, дедуп dead-links, lint-chat domain fallback, кнопка копирования, улучшения progress panel.

**Архитектура:** Все изменения изолированы — два source-файла (`lint.ts`, `view.ts`), один i18n-файл, один CSS. Новых модулей нет. Fix 5b добавляет три приватных поля и три приватных метода в `LlmWikiView`; остальные фиксы — правки на месте.

**Tech Stack:** TypeScript, Obsidian API (`setIcon`, `Notice`, `navigator.clipboard`), Vitest.

## Карта файлов

| Файл | Задачи |
|---|---|
| `src/phases/lint.ts` | Task 1 (appendLintLog), Task 2 (dedup links) |
| `src/view.ts` | Task 3 (domain fallback), Task 4 (copy btn), Task 5a (truncation), Task 5b (waiting) |
| `src/i18n.ts` | Task 3 (selectDomainFirst) |
| `src/styles.css` | Task 4 (copy btn CSS) |
| `tests/phases/lint.test.ts` | Tasks 1, 2 |

## Task 1: Lint appends to `_log.md`

**Файлы:** `src/phases/lint.ts`, `tests/phases/lint.test.ts`

TDD: написать failing тест на запись `_log.md` → убедиться в провале → добавить `tryRead` и `appendLintLog` после константы `META_FILES` → вызвать `appendLintLog` в `runLint` после `writtenPaths` → зелёные тесты.

Commit: `feat(lint): append run entry to _log.md after each domain fix pass`

## Task 2: Дедупликация dead-link отчётов

**Файлы:** `src/phases/lint.ts` (строка ~228), `tests/phases/lint.test.ts`

TDD: написать failing тест — `[[Missing]]` повторяется дважды в файле, ожидаем один issue → убедиться в провале → добавить `new Set(...)` к извлечению links в `checkStructure` → зелёные тесты.

Экспортировать `checkStructure` для unit-тестирования.

Commit: `fix(lint): deduplicate dead-link reports per file in checkStructure`

## Task 3: lint-chat domain fallback + i18n

**Файлы:** `src/view.ts` (~строки 694-717), `src/i18n.ts`

1. Добавить `selectDomainFirst` в `src/i18n.ts` (en/ru/es объекты `view`).
2. Убедиться что build проходит (TypeScript проверит соответствие).
3. В submit closure в `showChatSection()` — резолвить domain из `ctx.domainId ?? this.domainSelect?.value`, при `undefined` — `new Notice` + return.

Commit: `fix(view): resolve domain from domainSelect when lint-chat context has no domainId`

## Task 4: Кнопка копирования на чат-сообщениях

**Файлы:** `src/view.ts` (~строки 721-733), `src/styles.css`

1. Добавить CSS: `.ai-wiki-chat-msg { position: relative }` + `.ai-wiki-copy-btn` с hover-reveal.
2. В `addChatBubble()` добавить `copyBtn` с `setIcon("copy")`, click handler через `navigator.clipboard.writeText`, иконка flip `copy → check → copy`.

Commit: `feat(view): add copy-to-clipboard button on chat message bubbles`

## Task 5a: Убрать ASSISTANT_TEXT_MAX

**Файл:** `src/view.ts` (~строки 39, 527, 543)

Удалить константу `ASSISTANT_TEXT_MAX = 600`. Убрать `truncate(..., ASSISTANT_TEXT_MAX)` из RAF-callback ветки `reasoning` и ветки `assistant_text`. TypeScript укажет оставшиеся использования.

Commit: `fix(view): remove ASSISTANT_TEXT_MAX truncation from progress panel text`

## Task 5b: Индикатор ожидания в progress panel

**Файл:** `src/view.ts`

1. Добавить три приватных поля: `waitingStep`, `waitingTickHandle`, `waitingStartedAt`.
2. Добавить три приватных метода: `startWaiting()`, `stopWaiting()`, `scheduleWaitingTick()`.
3. Wiring в `appendEvent()`:
   - `tool_result` → `startWaiting()`
   - `tool_use` → `stopWaiting()` (начало блока)
   - `assistant_text` → `stopWaiting()` (начало ветки)
   - `result` / `error` → `stopWaiting()`
4. `stopWaiting()` в `setRunning()` после cleanup `tickHandle`.
5. `stopWaiting()` в `onClose()` рядом с другими cleanup-вызовами.

Commit: `feat(view): add waiting indicator between tool_result and next LLM event`

## Покрытие спецификации

| Требование | Task | Статус |
|---|---|---|
| Fix 1 — `_log.md` append | Task 1 | covered |
| Fix 2 — dedup dead links | Task 2 | covered |
| Fix 3 — lint-chat domain fallback + i18n `selectDomainFirst` | Task 3 | covered |
| Fix 4 — copy button (user + assistant, hover-reveal CSS) | Task 4 | covered |
| Fix 5a — убрать `ASSISTANT_TEXT_MAX` (assistant + reasoning) | Task 5a | covered |
| Fix 5b — `startWaiting` / `stopWaiting` wiring, reset в `setRunning`/`onClose` | Task 5b | covered |

`PREVIEW_INLINE = 140` (tool_result preview) не трогается.

## Связанные страницы

- [[lint-ux-fixes-design]] — спецификация
- [[lint-operation]] — операция lint
- [[llm-wiki-view]] — LlmWikiView, addChatBubble, appendEvent
- [[security-audit-fixes-plan]] — предыдущий план (паттерн структуры)
