# Mobile domain selector — design

## Problem

Mobile-вариант `LlmWikiView` скрывает весь блок выбора домена (`src/view.ts:108`, под `if (!isMobile)`). `submitQuery` шлёт `this.domainSelect?.value || undefined` — на mobile всегда `undefined` → query идёт по всем доменам. Пользователь не может ограничить запрос конкретным доменом с мобильного устройства.

## Goal

На mobile показать селектор домена для query-операции. Создание домена / ingest / lint / format / reinit остаются скрытыми (как сейчас, по решению `controller.ts:212` и `main.ts:214`).

## Non-goals

- Не включать ingest/lint/format/reinit/init на mobile.
- Не менять mobile-gating в `controller.ts` и `main.ts`.
- Не persist'ить последний выбранный домен (отдельная фича, не в scope).
- Не менять desktop-разметку и desktop-поведение.

## Approach

Извлечь построение domain-row в приватный helper `buildDomainRow(parent, opts)` внутри `LlmWikiView`. Параметр `withActions: boolean`:
- `true` (desktop): `select` + refresh + `reinitBtn` + action-row (ingest/lint/format).
- `false` (mobile): только `select` + refresh.

Изменения только в `src/view.ts` и `src/i18n.ts` (один новый ключ для секции на mobile, либо переиспользование существующего `sectionDomain`).

## Architecture

### Структура `onOpen` после изменений

```
header
section_label (создание/домен)
  if (!isMobile):
    section "sectionCreate" + init-btn
    section "sectionDomain" + buildDomainRow(parent, { withActions: true })
  else:
    section "sectionDomain" + buildDomainRow(parent, { withActions: false })
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
    this.formatBtn.addEventListener("click", () => void this.plugin.controller.format());
    this.ingestBtn.addEventListener("click", () => { /* существующий код */ });
    this.lintBtn.addEventListener("click", () => { /* существующий код */ });
  }

  void this.refreshDomains();
}
```

### Использование в `onOpen`

```ts
if (!isMobile) {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionCreate });
  const createRow = root.createDiv("ai-wiki-create-row");
  this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "ai-wiki-init-btn" });
  this.initBtn.addEventListener("click", () => this.openAddDomain());

  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
  this.buildDomainRow(root, { withActions: true });
} else {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
  this.buildDomainRow(root, { withActions: false });
}
```

## Behaviour

- `submitQuery` без изменений: `this.domainSelect?.value || undefined`. На mobile пользователь выберет домен → query пойдёт по нему. По умолчанию option `"all domains"` (value="") → старое поведение.
- `refreshDomains` уже идемпотентен и guard'ит `if (!this.domainSelect) return` — работает на обеих ветках.
- `setRunning`, `onTimerTick`, прочие методы обращаются к `reinitBtn`/`ingestBtn`/`lintBtn`/`formatBtn` через `if (...)`; на mobile они `null` → no-op.
- `openAddDomain` / `runReinit` доступны только через desktop-кнопки → не вызываются на mobile.

## i18n

Использовать существующий ключ `view.sectionDomain` ("Наполнение" / "Domain" / …). Если текст "Наполнение" звучит неуместно на mobile (только query), добавить отдельный ключ `view.sectionDomainMobile` ("Домен" / "Domain" / "Dominio"). **Решение:** добавить `sectionDomainMobile` для ясности UX — на mobile секция не про "наполнение", а про выбор.

## Files touched

- `src/view.ts` — извлечь helper, добавить mobile-ветку.
- `src/i18n.ts` — добавить ключ `view.sectionDomainMobile` (en/ru/es).

## Testing

- Unit: если есть `tests/view.*` — добавить кейс с mocked `Platform.isMobile=true`, проверить наличие `select.ai-wiki-domain-select` и отсутствие `ai-wiki-domain-actions`.
- Manual: Obsidian mobile (или Developer Tools mobile emulation) — открыть AIWiki view, проверить наличие селектора, выбрать домен, запустить query, убедиться что в `controller.query` приходит правильный `domainId`.

## Risks

- `Platform.isMobile` true и на phone, и на tablet. Дизайн работает на обоих — селект достаточно компактен.
- Список доменов читается через `DomainStore` → vault adapter → работает на mobile (уже используется в существующем mobile-gated коде нет, но `loadDomains` сам по себе vault-API safe).
- CSS `.ai-wiki-domain-row` мог быть рассчитан на desktop-ширину с тремя кнопками. На mobile в row остаётся только select+refresh — должен корректно ужаться. Проверить визуально; если нужно — добавить media-query или mobile-modifier класс.

## Out of scope / follow-ups

- Persist последний выбранный домен между сессиями.
- Inline-compact dropdown в query-row для экономии места.
- Mobile-специфичное UX для длинных списков доменов (search inside select).
