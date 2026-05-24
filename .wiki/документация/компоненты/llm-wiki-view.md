---
wiki_status: developing
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - src/view.ts
  - docs/superpowers/specs/2026-05-16-mobile-domain-selector-design.md
  - docs/superpowers/plans/2026-05-16-mobile-domain-selector.md
  - docs/TODO.md
  - "[[docs/superpowers/specs/2026-05-19-live-response-ux-design.md]]"
  - "[[docs/superpowers/plans/2026-05-19-live-response-ux.md]]"
  - "[[docs/superpowers/specs/2026-05-19-live-status-ux-design.md]]"
  - "[[docs/superpowers/plans/2026-05-19-live-status-ux.md]]"
  - docs/superpowers/specs/2026-05-23-ux-cleanup-design.md
  - docs/superpowers/plans/2026-05-23-ux-cleanup.md
wiki_updated: 2026-05-24
wiki_domain: документация
tags: [компонент, view, ui, obsidian, security, mobile, i18n]
---

# LlmWikiView

Боковая панель Obsidian (ItemView). Рендерит прогресс операций в реальном времени, историю запусков, чат и preview форматирования.

## Назначение

`LlmWikiView` (`src/view.ts`) получает события `RunEvent` через `appendEvent()` и немедленно обновляет DOM. Не хранит состояние операции — только рендер.

## Ключевые UI-блоки

| Блок | Описание |
|---|---|
| Domain select + action row | Выбор домена, кнопки Ingest/Lint/Format |
| Progress section | Шаги операции (Read, Write, thinking) |
| Result block | Итоговый текст и метрики |
| Format preview | Отчёт об изменениях + Apply/Cancel/Refine chat |
| Chat section | Чат-сессия после lint/ingest/query |
| History | Список предыдущих запусков (лимит 20) |

## XSS-защита: sanitizeLinks

После каждого `MarkdownRenderer.render(…)` вызывается `sanitizeLinks(el)`:

```ts
function sanitizeLinks(el: HTMLElement): void {
  el.querySelectorAll("a[href]").forEach((a) => {
    if (/^javascript:/i.test((a.getAttribute("href") ?? "").trim())) {
      a.removeAttribute("href");
    }
  });
}
```

Удаляет `href` у всех ссылок с `javascript:` схемой. Применяется к: `finalEl` (result), чат-пузырям (`addChatBubble`), `currentChatBubble` при `finishChat`, format preview (`reportEl`, `formatPreviewSection`), history-записям.

## registerLinkHandler

Перехватывает клики по `.internal-link` и открывает через `app.workspace.openLinkText()`. Применяется к `finalEl` и format preview, чтобы WikiLinks открывались в Obsidian, а не как стандартные ссылки браузера.

## Mobile UI gating (v0.1.68)

На mobile не создаются элементы: `domainSelect`, `initBtn`, `ingestBtn`, `lintBtn`, `formatBtn`. Весь код использует optional chaining (`this.formatBtn?.disabled = true`). Секции «Создание домена» и «Наполнение/Актуализация» обёрнуты `if (!Platform.isMobile)`. На mobile остаются только Query-блок, чат и история.

### Mobile domain selector (planned)

По [[mobile-domain-selector-design]] / [[mobile-domain-selector-plan]] mobile-ветка получает упрощённый блок выбора домена: только `select` + refresh, без reinit/ingest/lint/format. Реализация через приватный helper `buildDomainRow(parent, { withActions })` — desktop вызывает с `withActions: true`, mobile с `false`. Дополнительно `finish()` получает guard'ы (`if (this.xxxBtn) ...`) против TypeError на mobile, где соответствующие поля `undefined`. Новый i18n-ключ `view.sectionDomainMobile` (`Domain` / `Домен` / `Dominio`).

## Format preview

При событии `format_preview` вызывается `renderFormatPreview(tempPath, report, missingTokens)`:
- Ссылка на temp-файл (`!Temp/<name>.formatted.md`)
- Markdown-отчёт об изменениях (через `MarkdownRenderer.render` + `sanitizeLinks`)
- Warning с раскрываемым `<details>` если `missingTokens.length > 0`
- Кнопки Apply Replace / Apply Keep / Cancel
- Чат-textarea для refine

## Отображение скорости генерации (v0.1.x)

После завершения операции показывается скорость генерации `tok/s` в двух местах:

| Место | Поле | Поведение |
|---|---|---|
| Progress header (`progressCount`) | `lastTokPerSec` | `steps N, 42.1s · 150 tok/s` (после `updateMetrics()` в `finish()`) |
| Result section header | `resultSpeedEl` (HTMLElement span) | ` 150 tok/s` — пустая строка если нет данных |

Поток: `appendEvent(result)` → вычислить `lastTokPerSec` → `finish()` записывает оба места → `setRunning()` сбрасывает. Значение НЕ хранится в `RunHistoryEntry`.

## Copy-to-clipboard (v, коммит ba9f192)

На каждом чат-пузыре (`addChatBubble`) добавлена кнопка копирования в буфер обмена. При нажатии копирует текстовое содержимое пузыря через `navigator.clipboard.writeText`. Кнопка отображается в правом верхнем углу пузыря.

## Waiting indicator между tool_result и LLM-событием (v, коммит 5547cc2)

В прогрессе между событием `tool_result` и следующим LLM-ответом отображается индикатор ожидания — показывает пользователю, что процесс активен и ждёт ответа от модели. Решает UX-проблему: без индикатора прогресс-секция выглядела «замёрзшей» на предыдущем шаге.

## Live Response UX (v0.1.110)

По [[live-response-ux-design]]: первый non-reasoning `assistant_text` → авто-коллапс Progress, коллапс reasoning-блока с `(collapsed)`, открытие Result section со streaming markdown через `MarkdownRenderer`. Debounce 150ms (`scheduleAssistantRender()`).

## Live Status UX (v0.1.111)

По [[live-status-ux-design]]: заменяет live-response-ux. Progress остаётся открытым. Компактный **Status-блок** (`.ai-wiki-live-status`) под стepsEl показывает текущую активность одной строкой:

| Событие | Иконка | Текст |
|---|---|---|
| tool_use | 🔧 | `{name}  {arg}` |
| waiting | ⏳ | `{elapsed}s` |
| reasoning | 🧠 | `Analysing...` |
| assistant_text | 💬 | `Forming response...` |
| finish() | — | Status скрыт |

Удалены: `assistantStarted`, `assistantBuffer`, `assistantRenderHandle`, `assistantFinalComp`, `scheduleAssistantRender()`.
Добавлены: `liveStatusSection`, `liveStatusIconEl`, `liveStatusTextEl`.

## Известные проблемы (docs/TODO.md)

| # | Статус | Описание |
|---|---|---|
| 20 | `[]` | Убрать отображение времени на каждом шаге прогресса — достаточно общего времени операции. |
| 23 | `[!]` | При запуске операции шаг формирования response появляется в конце, а рассуждение — вверху записей. Пока не пошёл ответ — не показывать избыточные шаги. При генерации ответа сразу отображать в читаемом виде, а не в JSON. |
| 30 | `[!]` → спец/план | Убрать кнопку "Ask and save" (`askSaveBtn`) из боковой панели; оставить только "Ask". Удалить `query-save` из `CHAT_OPS`. `submitQuery()` упростить (убрать `save` param). См. [[ux-cleanup-design]], [[ux-cleanup-plan]]. |
| 31 | `[!]` → спец/план | После формирования результата автоматически сворачивать секцию Progress (`stepsOpen=false`, `ai-wiki-hidden`, toggle `▶`). При запуске — раскрывать. Реализация в `finish()`. См. [[ux-cleanup-design]], [[ux-cleanup-plan]]. |
| 33 | `[]` | Добавить хранение последнего выбранного домена; при открытии показывать его. Сохранять в `local.json`. |

## Связанные страницы

- [[wiki-controller]]
- [[format-operation]]
- [[async-generator-events]]
- [[fix-operation]]
- [[generation-speed-design]]
- [[mobile-domain-selector-design]]
- [[mobile-domain-selector-plan]]
- [[live-response-ux-design]]
- [[live-status-ux-design]]
- [[live-status-ux-plan]]
- [[ux-cleanup-design]]
- [[ux-cleanup-plan]]
