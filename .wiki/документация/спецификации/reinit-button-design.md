---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-15-reinit-button-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [spec, ui, view, init, i18n]
---

# Re-init Button Design

Спецификация кнопки `⟳` в боковой панели [[llm-wiki-view]], запускающей повторный [[init-operation]] для текущего выбранного домена с сохранёнными `sourcePaths`.

## Назначение

Боковая панель содержит кнопку `↻` для рефреша списка доменов в `domainRow` (`view.ts:117`). Init (наполнение домена из sources) сейчас доступен только при создании нового домена через `AddDomainModal` (`view.ts:231 openAddDomain`) или из format-flow (`controller.ts:113 suggestIngestForWikiFile`). Повторный init существующего домена не предусмотрен — пользователь вынужден пересоздавать домен.

Цель — добавить рядом с `refreshBtn` кнопку, диспатчащую `controller.init(id, false, sourcePaths|undefined)` для выбранного домена.

## Non-goals

- Изменение API `controller.init` или фазы `runInit`.
- Редактирование `sourcePaths` домена (отдельная задача через AddDomainModal в edit-режиме).
- Dry-run режим.

## Scope

Только UI: `src/view.ts`, `src/i18n.ts`, `src/styles.css` (если нужен размер). Никаких изменений в `controller.ts`, `agent-runner.ts`, фазах, типах.

## UI

В `domainRow` после `refreshBtn` создаётся `reinitBtn` с символом `⟳` и `title = T.view.reinitTitle`. Клик вызывает приватный `runReinit()`.

**Состояние `disabled`:**

| Момент | Значение |
|---|---|
| Создание (`onOpen`) | `true` (нет выбранного домена) |
| `domainSelect.change` | `disabled = domainSelect.value === ""` |
| `refreshDomains()` (после восстановления value) | пересчёт по текущему value |
| `setRunning(op, args)` | `true` (как остальные action-кнопки) |
| `setIdle()` / `finish()` | пересчёт по текущему value (не безусловный `false`, чтобы `(all domains)` оставалась disabled) |

## Обработчик `runReinit()`

```
domainId = this.domainSelect.value
if !domainId return
entry = (await controller.loadDomains()).find(d => d.id === domainId)
if !entry return                  // domain исчез между loadDomains и кликом — тихо
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

- проверяет `isBusy` (single-flight) и показывает Notice — см. [[single-flight-guard]];
- обрабатывает пустой `sourcePaths` (не добавляет `--sources`);
- регистрирует `onFileError` при наличии sourcePaths.

## i18n

В `src/i18n.ts` для всех локалей:

| Ключ | RU | EN |
|---|---|---|
| `view.reinitTitle` | Повторный init выбранного домена | Re-init selected domain |
| `modal.reinitConfirmTitle` | Re-init — подтвердите | Re-init — confirm |
| `modal.reinitConfirmBody(id, fileCount, srcCount)` | `Домен «${id}». ${fileCount} md-файлов в ${srcCount} sourcePaths. Запустить повторный init?` | `Domain «${id}». ${fileCount} md-files across ${srcCount} source paths. Re-run init?` |
| `modal.reinitConfirmBodyNoSources(id)` | `Домен «${id}». sourcePaths пусты — будут обновлены только метаданные (entity_types, language_notes).` | `Domain «${id}». No source paths — only metadata refresh (entity_types, language_notes).` |

Тип `I18n = typeof en` — любой пропущенный ключ в `ru`/`es` ловится `tsc --noEmit`.

## Поток

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
| `domainSelect.value === ""` (all domains) | Кнопка disabled, клик игнорируется |
| Домен удалён между `loadDomains` и кликом | `find` вернёт `undefined`, метод тихо return |
| `sourcePaths` пустой | Init без `--sources`, тело confirm — `reinitConfirmBodyNoSources` |
| Параллельная операция | `controller.dispatch` показывает Notice "operation running"; UI не должен допустить клик через `setRunning` |
| Mobile | `domainRow` не создаётся (`if (!isMobile)`), кнопка не существует |

## Testing

Unit-тесты для `view.ts` отсутствуют (DOM-mock не настроен). Verification — manual:

1. Открыть боковую панель, выбрать домен с непустыми sourcePaths → клик `⟳` → ConfirmModal показывает счётчик md-файлов → подтверждение → события `init_start` / `init_step` появляются в Progress.
2. Выбрать `(all domains)` → кнопка серая, клик не реагирует.
3. Выбрать домен без `sourcePaths` → ConfirmModal показывает «только метаданные» → init завершается без `--sources`.
4. Запустить init, во время выполнения проверить что `reinitBtn` disabled.
5. Cancel запущенного init → `reinitBtn` снова active, если домен выбран.

## Files

- `src/view.ts` — поле `reinitBtn`, создание кнопки, `runReinit()`, обновления `disabled` в `refreshDomains` / `setRunning` / `setIdle` / `finish` / `change`-handler.
- `src/i18n.ts` — 4 новых ключа в RU, EN, ES секциях.

## Связанные страницы

- [[reinit-button-plan]] — реализационный план
- [[llm-wiki-view]] — целевой UI-компонент
- [[init-operation]] — диспатчируемая операция
- [[wiki-controller]] — `controller.init` с single-flight
- [[single-flight-guard]] — паттерн защиты от параллельных запусков
