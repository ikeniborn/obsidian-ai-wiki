---
title: Re-init button in side panel
date: 2026-05-15
status: draft
review:
  spec_hash: a608236bc9f11d81
  last_run: 2026-05-15
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
---

# Re-init button in side panel

## Problem

Боковая панель содержит кнопку `↻` для рефреша списка доменов рядом с `domainSelect`. Init (наполнение домена из sources) сейчас запускается только при создании нового домена через `AddDomainModal` (`view.ts:231 openAddDomain`) или из format-flow (`controller.ts:113 suggestIngestForWikiFile`). Повторный init существующего домена недоступен — пользователь вынужден пересоздавать домен.

## Goal

Добавить кнопку в `domainRow`, запускающую `controller.init` для текущего выбранного домена с его сохранёнными `sourcePaths`.

## Non-goals

- Изменение API `controller.init` или фазы `runInit`.
- Редактирование `sourcePaths` домена (это делается через AddDomainModal в режиме edit, отдельная задача).
- Dry-run режим.

## Scope

Только UI: `src/view.ts`, `src/i18n.ts`, `src/styles.css` (если нужен размер). Никаких изменений в `controller.ts`, `agent-runner.ts`, фазах, типах.

## Design

### UI

В `domainRow` (`view.ts:117`) после `refreshBtn` добавляется `reinitBtn`:

```ts
this.reinitBtn = domainRow.createEl("button", {
  text: "⟳",
  attr: { title: T.view.reinitTitle },
});
this.reinitBtn.addEventListener("click", () => void this.runReinit());
```

Состояние `disabled`:
- При создании: `disabled = true` (нет выбранного домена).
- На `domainSelect.change`: `disabled = domainSelect.value === ""`.
- В `refreshDomains()` после восстановления `value`: пересчёт по текущему value.
- В `setRunning(op, args)`: `disabled = true` (как остальные action-кнопки).
- В `setIdle()` / завершении: пересчёт по текущему value (не безусловный `false`, чтобы "all domains" оставалась disabled).

### Обработчик

Новый приватный метод `runReinit()`:

```
domainId = this.domainSelect.value
if !domainId return
entry = (await controller.loadDomains()).find(d => d.id === domainId)
if !entry return                            // domain исчез — тихо
mdFiles = entry.sourcePaths.length
  ? app.vault.getFiles().filter(f =>
      f.extension === "md" &&
      entry.sourcePaths.some(p => f.path.startsWith(p)))
  : []
body = entry.sourcePaths.length
  ? T.modal.reinitConfirmBody(entry.id, mdFiles.length, entry.sourcePaths.length)
  : T.modal.reinitConfirmBodyNoSources(entry.id)
new ConfirmModal(app, T.modal.reinitConfirmTitle, [body],
  () => void controller.init(entry.id, false,
    entry.sourcePaths.length ? entry.sourcePaths : undefined),
).open()
```

`controller.init` уже:
- проверяет `isBusy` и показывает Notice.
- обрабатывает пустой `sourcePaths` (не добавляет `--sources`).
- регистрирует `onFileError` при наличии sourcePaths.

### i18n

В `src/i18n.ts` для обеих локалей:

| Ключ | RU | EN |
|---|---|---|
| `view.reinitTitle` | "Повторный init выбранного домена" | "Re-init selected domain" |
| `modal.reinitConfirmTitle` | "Re-init — подтвердите" | "Re-init — confirm" |
| `modal.reinitConfirmBody(id, fileCount, srcCount)` | `` `Домен «${id}». ${fileCount} md-файлов в ${srcCount} sourcePaths. Запустить повторный init?` `` | `` `Domain «${id}». ${fileCount} md-files across ${srcCount} source paths. Re-run init?` `` |
| `modal.reinitConfirmBodyNoSources(id)` | `` `Домен «${id}». sourcePaths пусты — будет обновлены только метаданные (entity_types, language_notes).` `` | `` `Domain «${id}». No source paths — only metadata refresh (entity_types, language_notes).` `` |

### Поток

```
click reinitBtn
  → runReinit()
  → loadDomains() → find entry
  → count md files in sourcePaths
  → ConfirmModal
  → controller.init(id, false, sourcePaths|undefined)
  → dispatch("init", args) → существующий init-flow
  → события init_start / step / result рендерятся в panel
```

## Edge cases

| Случай | Поведение |
|---|---|
| `domainSelect.value === ""` ("all domains") | Кнопка disabled, клик игнорируется. |
| Домен удалён между `loadDomains` и кликом | `find` вернёт `undefined`, метод тихо return. |
| `sourcePaths` пустой | Init без `--sources`, тело confirm — `reinitConfirmBodyNoSources`. |
| Другая операция выполняется | `controller.dispatch` показывает Notice "operation running"; UI уже не должен допустить через `setRunning`. |
| Mobile | `domainRow` не создаётся (`if (!isMobile)`), кнопка не существует. |

## Testing

Unit-тесты для `view.ts` отсутствуют в проекте (DOM-mock не настроен). Verification — manual:

1. Открыть боковую панель, выбрать домен с непустыми sourcePaths → клик ⟳-init → ConfirmModal показывает счётчик md-файлов → подтверждение → events `init_start`/`init_step` появляются в Progress.
2. Выбрать "all domains" → кнопка серая, клик не реагирует.
3. Выбрать домен без sourcePaths → ConfirmModal показывает "только метаданные" → init завершается без `--sources`.
4. Запустить init, затем во время выполнения проверить что reinitBtn disabled.
5. Cancel запущенного init → reinitBtn снова active, если домен выбран.

## Files

- `src/view.ts` — добавить поле `reinitBtn`, создание кнопки, `runReinit()`, обновления disabled в `refreshDomains` / `setRunning` / `setIdle` / `change`-handler.
- `src/i18n.ts` — 4 новых ключа в RU и EN секциях.
