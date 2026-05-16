---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-16-mobile-domain-selector-design.md
  - docs/TODO.md
wiki_updated: 2026-05-16
wiki_domain: документация
tags: [spec, mobile, view, i18n, ui, domain-selector, query]
---

# Mobile Domain Selector Design

Спецификация: показать селектор домена на mobile-варианте [[llm-wiki-view]] для [[query-operation]], чтобы пользователь мог ограничить запрос конкретным доменом с мобильного устройства.

## Проблема

Mobile-вариант `LlmWikiView` скрывает весь блок выбора домена (`src/view.ts:108`, под `if (!isMobile)`). `submitQuery` шлёт `this.domainSelect?.value || undefined` — на mobile всегда `undefined` → query идёт по всем доменам. Скрытие селектора было неоправданным: query на mobile работает, но без возможности scope'ить.

Дополнительно: `finish()` присваивает `.disabled = false` для `initBtn`/`ingestBtn`/`lintBtn`/`formatBtn` без guard'а. На mobile эти поля `undefined` → потенциальный TypeError при завершении query.

## Цель

На mobile показать селектор домена для query. Создание домена / ingest / lint / format / reinit остаются скрытыми (по решению `controller.ts:212` и `main.ts:214` — out of scope).

## Non-goals

- Не включать ingest/lint/format/reinit/init на mobile.
- Не менять mobile-gating в `controller.ts` и `main.ts`.
- Не persist'ить последний выбранный домен.
- Не менять desktop-разметку и desktop-поведение.

## Подход

Извлечь построение domain-row в приватный helper `buildDomainRow(parent, opts)` внутри `LlmWikiView`. Параметр `withActions: boolean`:

- `true` (desktop): `select` + refresh + `reinitBtn` + action-row (ingest/lint/format).
- `false` (mobile): только `select` + refresh.

Изменения только в `src/view.ts` и `src/i18n.ts` (новый ключ `view.sectionDomainMobile`).

## Архитектура

### Структура `onOpen` после изменений

```
header
if (!isMobile):
  section "sectionCreate" + init-btn
  section "sectionDomain" + buildDomainRow(parent, { withActions: true })
else:
  section "sectionDomainMobile" + buildDomainRow(parent, { withActions: false })
section "sectionQuery" + ask-row  // без изменений
progress / result / history       // без изменений
```

### Helper `buildDomainRow`

```ts
private buildDomainRow(parent: HTMLElement, opts: { withActions: boolean }): void {
  const T = i18n();
  const domainBox = parent.createDiv("ai-wiki-domain");
  const domainRow = domainBox.createDiv("ai-wiki-domain-row");
  domainRow.createSpan({ cls: "muted", text: "Domain:" });
  this.domainSelect = domainRow.createEl("select", { cls: "ai-wiki-domain-select" });
  const refreshBtn = domainRow.createEl("button", { text: "↻", attr: { title: T.view.refreshTitle } });
  refreshBtn.addEventListener("click", () => void this.refreshDomains());

  if (opts.withActions) {
    this.reinitBtn = domainRow.createEl("button", { attr: { title: T.view.reinitTitle } });
    setIcon(this.reinitBtn, "recycle");
    this.reinitBtn.disabled = true;
    this.reinitBtn.addEventListener("click", () => void this.runReinit());
    this.domainSelect.addEventListener("change", () => {
      if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect!.value;
    });

    const actionRow = domainBox.createDiv("ai-wiki-domain-actions");
    this.ingestBtn = actionRow.createEl("button", { text: T.view.ingest });
    this.lintBtn = actionRow.createEl("button", { text: T.view.lint });
    this.formatBtn = actionRow.createEl("button", { text: T.view.format });
    // ... обработчики ingest/lint/format
  }

  void this.refreshDomains();
}
```

## Поведение

- `submitQuery` без изменений: `this.domainSelect?.value || undefined`. На mobile пользователь выберет домен → query пойдёт по нему. По умолчанию option `"all domains"` (value="") → старое поведение.
- `refreshDomains` уже идемпотентен и guard'ит `if (!this.domainSelect) return` — работает на обеих ветках.
- `setRunning`, `onTimerTick`, прочие методы обращаются к `reinitBtn`/`ingestBtn`/`lintBtn`/`formatBtn` через `if (...)`; на mobile они `null`/`undefined` → no-op.
- **`finish()` guard**: добавить `if (this.xxxBtn)` перед каждым `.disabled = false` (зеркалит стиль `setRunning` lines 329-333) — иначе TypeError на mobile.

## i18n

Новый ключ `view.sectionDomainMobile`:

| Локаль | Значение |
|---|---|
| en | "Domain" |
| ru | "Домен" |
| es | "Dominio" |

Существующий `view.sectionDomain` ("Наполнение / Fill / Maintain") звучит неуместно на mobile (только query) — отсюда отдельный ключ.

## Затрагиваемые файлы

- `src/view.ts` — извлечь helper, добавить mobile-ветку, guard `finish()`.
- `src/i18n.ts` — добавить ключ `view.sectionDomainMobile` (en/ru/es).

## Тестирование

- Unit (опционально): mocked `Platform.isMobile=true` → проверить наличие `select.ai-wiki-domain-select` и отсутствие `ai-wiki-domain-actions`.
- Manual: Obsidian mobile / dev-tools mobile emulation — открыть AIWiki view, проверить селектор, выбрать домен, запустить query, убедиться что `controller.query` получает правильный `domainId`.

## Риски

- `Platform.isMobile` true и на phone, и на tablet. Селект достаточно компактен для обоих.
- CSS `.ai-wiki-domain-row` рассчитан на desktop-ширину с тремя кнопками. На mobile в row остаётся select+refresh — должен ужаться. Если нет — media-query или mobile-modifier (follow-up).

## Out of scope / follow-ups

- Persist последний выбранный домен между сессиями.
- Inline-compact dropdown в query-row.
- Mobile-специфичное UX для длинных списков доменов (search inside select).
- Native агент не работает на mobile (отдельная задача из TODO).

## Связи

- Затрагивает: [[llm-wiki-view]]
- Реализуется: [[mobile-domain-selector-plan]]
- Используется в: [[query-operation]]
