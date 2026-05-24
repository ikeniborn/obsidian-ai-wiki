---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-23-ux-cleanup.md
  - docs/superpowers/specs/2026-05-23-ux-cleanup-design.md
wiki_updated: 2026-05-24
wiki_domain: документация
tags: [план, ux, query-save, shell-consent, progress, view]
aliases: ["ux cleanup plan", "UX Cleanup Plan"]
---

# UX Cleanup Implementation Plan

Реализационный план трёх UX-правок по [[ux-cleanup-design]].

**Цель:** consent modal при каждом переключении, удаление "Ask and save" + `query-save`, авто-коллапс Progress.

**Архитектура:** Хирургические изменения — одно условие в settings, удаление мёртвой операции из 7 файлов, три строки в `finish()`.

---

## Карта файлов

| Файл | Изменение |
|------|-----------|
| `src/settings.ts` | Убрать `&& !this.localCache.shellConsentGiven` (строка 217) |
| `src/types.ts` | Убрать `\| "query-save"` из `WikiOperation` |
| `src/main.ts` | Удалить addCommand query-save; упростить QueryModal call |
| `src/modals.ts` | QueryModal: убрать `save`, заголовок всегда `T.modal.query` |
| `src/controller.ts` | `query()`: убрать `save`; удалить все ветки `query-save` |
| `src/agent-runner.ts` | Убрать remap и `case "query-save"` |
| `src/view.ts` | Убрать `askSaveBtn`; убрать `"query-save"` из `CHAT_OPS`; collapse в `finish()` |
| `src/i18n.ts` | Удалить ключ `querySave` из трёх локалей |
| `tests/controller-cache-invalidation.test.ts` | Заменить `"query-save"` → `"query"` на строке 150 |
| `tests/main-mobile.test.ts` | Убрать `"query-save"` из expected lists (строки 98, 107) |

---

## Task 1: Fix consent modal

**Файлы:** `src/settings.ts:217`

Убрать `&& !this.localCache.shellConsentGiven` из условия:
```typescript
// было
if (v === "claude-agent" && !this.localCache.shellConsentGiven) {
// стало
if (v === "claude-agent") {
```

Commit: `fix(settings): show ShellConsentModal on every native→claude-agent switch`

---

## Task 2: Remove query-save from types and agent-runner

**Файлы:** `src/types.ts:7`, `src/agent-runner.ts:27,80-82`

1. Удалить `| "query-save"` из `WikiOperation` union в `src/types.ts`.
2. Убрать remap в `src/agent-runner.ts` строка 27:
   ```typescript
   // стало
   const key = (op === "chat" || op === "lint-chat" ? "lint" : op) as OpKey;
   ```
3. Удалить `case "query-save"` block (~строки 80–82).

DoD: build выдаёт ошибки только в controller.ts, main.ts, view.ts, modals.ts.

Commit: `refactor: remove query-save from WikiOperation type and agent-runner`

---

## Task 3: Remove query-save from main.ts and simplify QueryModal

**Файлы:** `src/main.ts:78,82-85`, `src/modals.ts:50-58`

1. Удалить addCommand block query-save (строки 82–85).
2. Упростить query command: убрать `false` из `new QueryModal(this.app, false, ...)`.
3. `QueryModal`: убрать `save: boolean` из конструктора; заголовок всегда `T.query`.

Commit: `refactor: remove query-save command and simplify QueryModal`

---

## Task 4: Remove query-save from controller.ts

**Файлы:** `src/controller.ts`

1. `query(q, save, domainId?)` → `query(q, domainId?)`, всегда `"query"`.
2. Убрать `query-save` из mobile check (~строка 219).
3. Удалить строку описания `"query-save": "..."` (~строка 271).
4. Убрать ternary ветку `opKey === "query-save" ? "query"` (~строка 475).
5. Убрать `query-save` из mobile op check (~строка 573).
6. Упростить опытный ternary в computations (~строки 588, 602).
7. Убрать `query-save` из `mutatesWiki` (~строка 687).
8. Удалить auto-open block (~строки 713–719).

Commit: `refactor: remove query-save from controller`

---

## Task 5: Remove query-save from view.ts

**Файлы:** `src/view.ts`

1. Удалить поле `askSaveBtn!: HTMLButtonElement` (~строка 46).
2. Удалить создание и event-listener `askSaveBtn` (~строки 143–147).
3. `submitQuery(save: boolean)` → `submitQuery()`, вызывать `controller.query(q, domainId?)`.
4. Обновить `askBtn.addEventListener` (убрать `false`).
5. Удалить `askSaveBtn.disabled` в `setRunning` и `finish`.
6. Убрать `"query-save"` из `CHAT_OPS` (~строка 763).

Commit: `refactor: remove askSaveBtn and query-save from view`

---

## Task 6: Remove querySave from i18n.ts

**Файлы:** `src/i18n.ts:155,378,599`

Удалить ключ `querySave` из English, Russian и Spanish локалей. Проверить и удалить `askAndSave` если присутствует.

Commit: `refactor: remove querySave i18n keys`

---

## Task 7: Fix tests

**Файлы:** `tests/controller-cache-invalidation.test.ts:150`, `tests/main-mobile.test.ts:98,102,107`

1. `controller-cache-invalidation.test.ts:150` — описание и dispatch `"query-save"` → `"query"`.
2. `main-mobile.test.ts:98,107` — убрать `"query-save"` из expected arrays.
3. `main-mobile.test.ts:102` — обновить описание теста.

DoD: `npm test` — все тесты проходят.

Commit: `test: remove query-save from test expectations`

---

## Task 8: Auto-collapse Progress on finish

**Файлы:** `src/view.ts` — метод `finish()` (~строка 775)

В `finish()`, после `renderHistory()`:
```typescript
this.stepsOpen = false;
this.stepsEl.addClass("ai-wiki-hidden");
this.progressToggle.setText("▶");
```

DoD: 0 ошибок build; все тесты проходят.

Commit: `feat(view): auto-collapse Progress section on operation finish`

---

## Инварианты

- Фаза `runQuery(args, save=false, ...)` — сигнатуру не трогать.
- `shellConsentGiven` в `controller.ts` — остаётся как guard во время операций.

## Связанные страницы

- [[ux-cleanup-design]]
- [[llm-wiki-view]]
- [[settings]]
- [[shell-consent]]
- [[query-operation]]
- [[wiki-controller]]
