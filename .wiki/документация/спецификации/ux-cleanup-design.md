---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-23-ux-cleanup-design.md
  - docs/TODO.md
wiki_updated: 2026-05-24
wiki_domain: документация
tags: [спецификация, ux, query-save, shell-consent, progress]
aliases: ["ux cleanup design", "UX Cleanup"]
---

# UX Cleanup Design

Спецификация трёх UX-правок: consent per-switch, удаление query-save, авто-коллапс Progress.

## Задачи

- **#29** — ShellConsentModal при каждом native→claude-agent switch
- **#30+** — Удалить кнопку "Ask and save" и операцию `query-save` целиком
- **#31** — Авто-коллапс Progress после завершения операции; авто-раскрытие при старте

---

## Task 29 — Consent on every switch

### Проблема

`settings.ts` охраняет `ShellConsentModal` через `!this.localCache.shellConsentGiven`. После первого подтверждения модал больше не показывается — даже при каждом новом переключении native→claude-agent.

### Желаемое поведение

- `ShellConsentModal` показывается при **каждом** переключении native→claude-agent в dropdown настроек.
- `shellConsentGiven` остаётся в `LocalConfig` — [[wiki-controller]] по-прежнему использует его как guard во время операций.
- Выбор бэкенда сохраняется в `local.json`.

### Изменение

**`src/settings.ts`** — убрать `&& !this.localCache.shellConsentGiven` из условия (однострочное изменение).

---

## Task 30+ — Remove query-save completely

### Масштаб

Удалить кнопку "Ask and save" из боковой панели и тип операции `query-save` из всей кодовой базы.

### Изменения по файлам

| Файл | Что |
|------|-----|
| `src/types.ts` | Убрать `\| "query-save"` из `WikiOperation` |
| `src/main.ts` | Удалить addCommand query-save; упростить вызов query (убрать `false`) |
| `src/modals.ts` | `QueryModal`: убрать `save: boolean`; заголовок всегда `T.modal.query` |
| `src/controller.ts` | `query()`: убрать `save`, всегда `"query"`; удалить все ветки `query-save`; удалить auto-open block (~lines 713–719) |
| `src/agent-runner.ts` | Убрать remap `query-save→query`; удалить `case "query-save"` |
| `src/view.ts` | Удалить `askSaveBtn`; убрать `"query-save"` из `CHAT_OPS`; `submitQuery()` без `save` |
| `src/i18n.ts` | Удалить ключ `querySave` из всех трёх локалей |

### Инвариант

`runQuery(args, save=false, ...)` в фазе query — сохранить `save`; всегда вызывается с `false`. Удалять только после подтверждения отсутствия вызовов.

---

## Task 31 — Progress collapse/expand

### Поведение коллапса

- **При старте** (`setRunning()`): Progress раскрывается — уже реализовано, изменений нет.
- **При завершении** (`finish()`): Progress сворачивается.

### Реализация

**`src/view.ts`** — в `finish()`, после `renderHistory()`:
```typescript
this.stepsOpen = false;
this.stepsEl.addClass("ai-wiki-hidden");
this.progressToggle.setText("▶");
```

---

## Тесты к обновлению

- `tests/controller-cache-invalidation.test.ts:150` — заменить `"query-save"` на `"query"`.
- `tests/main-mobile.test.ts:98,102,107` — убрать `"query-save"` из expected command lists.

---

## Out of scope

- Сигнатура фазы `runQuery` — сохраняется с `save`.
- `shellConsentGiven` в `controller.ts` — остаётся как guard во время операции.

## Связанные страницы

- [[ux-cleanup-plan]]
- [[shell-consent]]
- [[llm-wiki-view]]
- [[settings]]
- [[query-operation]]
- [[wiki-controller]]
