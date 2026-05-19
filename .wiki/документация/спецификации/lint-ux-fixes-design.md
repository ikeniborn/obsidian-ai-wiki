---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-18-lint-ux-fixes-design.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [спецификация, lint, ux, view, i18n, clipboard]
wiki_outgoing_links:
  - "[[lint-operation]]"
  - "[[llm-wiki-view]]"
  - "[[lint-ux-fixes-plan]]"
---

# Lint UX Fixes — Design Spec

Дата: 2026-05-18. Спецификация пяти независимых UX-улучшений операции lint и слоя view.

## Scope

1. Lint записывает результат в `_log.md`
2. Дедупликация dead-link отчётов
3. Исправление ошибки "lint-chat без домена"
4. Кнопка копирования на чат-сообщениях
5. Progress panel: убрать обрезание текста LLM + индикатор ожидания

## Fix 1 — Lint appends to `_log.md`

**Файл:** `src/phases/lint.ts`

Добавить `appendLintLog()` в конец `runLint`, вызывается один раз на домен после вычисления `writtenPaths`.

Вспомогательная `tryRead` (аналогично паттерну в `ingest.ts`) — безопасное чтение с fallback на пустую строку. Запись формата:
```
## YYYY-MM-DD — lint — {domainId}
- Исправлено страниц: N
```

Вызов в `runLint` — после `writtenPaths`, перед переходом к следующему домену.

## Fix 2 — Дедупликация dead-links в `checkStructure`

**Файл:** `src/phases/lint.ts`

Текущий код сообщает по одному issue на каждое вхождение `[[X]]` в файле. Один повторяющийся dead link → несколько одинаковых строк отчёта.

Исправление: дедупликация ссылок по файлу через `new Set`:

```typescript
// до:
const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);

// после:
const links = [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))];
```

Каждая пара `(file, dead-link)` сообщается не более одного раза.

## Fix 3 — lint-chat domain fallback

**Файл:** `src/view.ts`

Когда lint выполняется на «все домены», `lastContext.domainId` равен `undefined`. Существующий `domainSelect` в верхней части панели содержит выбранный пользователем домен.

В `submit()` closure внутри `showChatSection()`: резолвить домен перед dispatch:

```typescript
const domainId = ctx.domainId ?? this.domainSelect?.value || undefined;
if (!domainId) {
  new Notice(i18n().view.selectDomainFirst ?? "Select a domain first");
  return;
}
```

**i18n:** Добавить ключ `selectDomainFirst` в `i18n.ts`:
- English: `"Select a domain first"`
- Russian: `"Выберите домен"`
- Spanish: `"Selecciona un dominio primero"`

## Fix 4 — Copy button на чат-сообщениях

**Файлы:** `src/view.ts`, `src/styles.css`

В `addChatBubble()` после рендера контента добавить кнопку копирования. Применяется ко всем пузырям — user + assistant (намеренно: пользовательские сообщения тоже полезно копировать).

Поведение: при клике — `navigator.clipboard.writeText(text)`, иконка меняется `copy → check`, через 1500ms возвращается в `copy`. Кнопка скрыта (`opacity: 0`), показывается при hover через CSS.

CSS: `.ai-wiki-chat-msg { position: relative }` + `.ai-wiki-copy-btn` с absolute-позиционированием top-right, hover-reveal через `.ai-wiki-chat-msg:hover .ai-wiki-copy-btn { opacity: 1 }`.

## Fix 5 — Progress panel: обрезание и индикатор ожидания

**Файл:** `src/view.ts`

### 5a. Убрать ASSISTANT_TEXT_MAX

Удалить константу `ASSISTANT_TEXT_MAX = 600`. В ветках `assistant_text` и `reasoning` в `appendEvent()` убрать вызов `truncate(..., ASSISTANT_TEXT_MAX)` — использовать буфер напрямую.

`PREVIEW_INLINE = 140` (для tool_result preview) остаётся.

### 5b. Индикатор ожидания

Новые поля: `waitingStep`, `waitingTickHandle`, `waitingStartedAt`.

Логика в `appendEvent()`:
- На `tool_result` → `startWaiting()` (показать таймер «⏳ 0.0s»)
- На `tool_use`, `assistant_text`, `reasoning` → `stopWaiting()`
- На `result` / `error` → `stopWaiting()`

`stopWaiting()` также вызывается в `setRunning()` (сброс при новой операции) и `onClose()`.

Таймер обновляется каждые 100ms через `scheduleWaitingTick()`.

## Затронутые файлы

| Файл | Изменения |
|---|---|
| `src/phases/lint.ts` | Fix 1 (`appendLintLog`), Fix 2 (dedup links) |
| `src/view.ts` | Fix 3 (domain fallback), Fix 4 (copy btn), Fix 5 (truncation + waiting) |
| `src/i18n.ts` | Fix 3 (`selectDomainFirst` key) |
| `src/styles.css` | Fix 4 (copy btn CSS) |

Не затрагивает: `controller.ts`, `agent-runner.ts`, phase-файлы кроме `lint.ts`.

## Связанные страницы

- [[lint-ux-fixes-plan]] — реализационный план
- [[lint-operation]] — операция lint
- [[llm-wiki-view]] — LlmWikiView и addChatBubble
- [[security-audit-fixes-design]] — предыдущий цикл фиксов
