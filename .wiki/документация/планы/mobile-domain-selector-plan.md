---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-16-mobile-domain-selector.md
  - docs/superpowers/specs/2026-05-16-mobile-domain-selector-design.md
wiki_updated: 2026-05-16
wiki_domain: документация
tags: [plan, mobile, view, i18n, refactor, domain-selector]
---

# Mobile Domain Selector Implementation Plan

План реализации [[mobile-domain-selector-design]]: показать селектор домена на mobile для query-операции через extract helper-метода и mobile-ветку в `onOpen`.

## Цель

Show domain selector on mobile for query operation so user can scope queries to a specific domain.

## Архитектура

Extract `domain-row` markup from `onOpen` into private helper `buildDomainRow(parent, { withActions })`.

- Desktop: `withActions: true` (full — select + refresh + reinit + ingest/lint/format actions).
- Mobile: `withActions: false` (only select + refresh).

Дополнительно: fix latent crash in `finish()` где mobile-undefined кнопки получали `.disabled` без guard'а.

## Tech Stack

TypeScript, Obsidian Plugin API (`Platform.isMobile`, `ItemView`), esbuild, vitest.

## Затрагиваемые файлы

- `src/view.ts` — extract helper, replace desktop block, add mobile branch, guard `finish()`.
- `src/i18n.ts` — add `view.sectionDomainMobile` (en/ru/es).

## Задачи

### Task 1: Добавить i18n-ключ `sectionDomainMobile`

Три блока локалей в `src/i18n.ts` (en ~line 92, ru ~line 298, es ~line 502). Значения: `"Domain"` / `"Домен"` / `"Dominio"`.

Verify: `npx tsc --noEmit`. `I18n` type выводится из `en`, ru/es должны соответствовать форме.

### Task 2: Извлечь helper `buildDomainRow` (pure refactor)

Insert после `onClose()` (~line 224). Desktop branch `onOpen` теперь содержит только секцию "sectionCreate" + initBtn и секцию "sectionDomain" + `buildDomainRow(root, { withActions: true })`.

Note: внутри closures используется `this.domainSelect!.value` (с non-null assertion), т.к. поле типа `HTMLSelectElement | undefined`.

Verify: typecheck, `npm run build`, `npm test` (все desktop-тесты должны проходить — это pure refactor).

### Task 3: Добавить mobile-ветку

Добавить `else` к `if (!isMobile)` в `onOpen`:

```ts
} else {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomainMobile });
  this.buildDomainRow(root, { withActions: false });
}
```

### Task 4: Guard `finish()` против undefined

Pre-existing latent crash: `finish()` (`src/view.ts:604-617`) присваивает `.disabled` на `initBtn`/`ingestBtn`/`lintBtn`/`formatBtn` без null-check. На mobile эти поля `undefined` → TypeError.

Замена:

```ts
if (this.initBtn) this.initBtn.disabled = false;
if (this.ingestBtn) this.ingestBtn.disabled = false;
if (this.lintBtn) this.lintBtn.disabled = false;
if (this.formatBtn) this.formatBtn.disabled = false;
```

Стиль зеркалит `setRunning` (lines 329-333), который уже использует guards.

### Task 5: Manual verification

1. Bump patch в `package.json` и `src/manifest.json`.
2. `npm run build`.
3. Symlink install (если ещё не).
4. **Desktop**: UI без изменений — "Create" + "Fill/Maintain" + domain row (select/↻/♻) + actions row (Ingest/Lint/Format) + Query. Выбор домена → reinit включается. Run query → `finish()` re-enable без crash.
5. **Mobile**: UI = header + "Domain/Домен/Dominio" + select+↻ + Query (textarea + Ask/AskSave/Cancel). Нет Create, нет actions row. Выбрать домен → запустить query → убедиться, что `controller.query` получил правильный `domainId`. Переключиться на `(all)` → re-run.
6. CSS sanity на mobile: row из select+↻ должен ужаться без overflow.
7. Commit version bump.

## Verification

Каждая задача завершается типчеком, билдом и/или тестами; финальная manual-проверка на desktop и mobile подтверждает goal: domain selector виден на mobile, query scope'ится по выбранному домену, `finish()` не падает.

## Self-Review

- Spec coverage 100%: goal (Task 3), helper extraction (Task 2), i18n key (Task 1), `submitQuery` no-change (confirmed), mobile gating in `controller.ts`/`main.ts` no-change (confirmed), CSS risk (Task 5 Step 6).
- `finish()` crash не упомянут явно в spec как dedicated section, но обозначен в Behaviour spec'а и добавлен как Task 4 (blocks mobile use).
- Метод-имена консистентны: `buildDomainRow` везде.

## Связи

- Реализует: [[mobile-domain-selector-design]]
- Затрагивает: [[llm-wiki-view]]
- Контекст: [[query-operation]]
