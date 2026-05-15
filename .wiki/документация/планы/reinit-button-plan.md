---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-15-reinit-button.md
  - docs/superpowers/specs/2026-05-15-reinit-button-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [plan, ui, view, init, i18n]
---

# Re-init Button Plan

Реализационный план [[reinit-button-design]]: кнопка `⟳` в `domainRow` боковой панели [[llm-wiki-view]], запускающая `controller.init(id, false, sourcePaths|undefined)` для выбранного домена.

## Цель

Только UI: `src/view.ts` + 4 новых i18n-ключа в `src/i18n.ts` (en, ru, es). Никаких изменений в `controller.ts`, `agent-runner.ts`, фазах, типах.

`runReinit()`:

1. Берёт `domainId = domainSelect.value`.
2. Загружает `entry` через `plugin.controller.loadDomains()` (тихо выходит, если не найден).
3. Считает md-файлы в `entry.sourcePaths`.
4. Показывает `ConfirmModal` с динамическим body (есть/нет sourcePaths).
5. По подтверждению — `controller.init(entry.id, false, sourcePaths.length ? sourcePaths : undefined)`.

`disabled`-состояние синхронизируется в `change` / `refreshDomains` / `setRunning` / `finish`.

## Затрагиваемые файлы

| Файл | Изменение |
|---|---|
| `src/i18n.ts` | 4 ключа: `view.reinitTitle`, `modal.reinitConfirmTitle`, `modal.reinitConfirmBody(id, files, srcCount)`, `modal.reinitConfirmBodyNoSources(id)` — в en, ru, es |
| `src/view.ts` | поле `reinitBtn?: HTMLButtonElement`; создание в `domainRow` после `refreshBtn`; `change`-handler на `domainSelect`; синхронизация `disabled` в `refreshDomains` / `setRunning` / `finish`; метод `runReinit()` |
| `package.json`, `src/manifest.json` | patch-bump `0.1.96 → 0.1.97` (CLAUDE.md rule) |

Unit-тестов для `view.ts` нет (DOM-mock не настроен) → автоматическая проверка — `npm run build` + `npx tsc --noEmit`; функциональная — manual из спеки.

## Задачи

### Task 1: i18n-ключи

Вставить в `src/i18n.ts` после соответствующих блоков (`refreshTitle`, `initConfirmBody`) в каждой из трёх локалей.

**EN.**

```ts
// в en.view
reinitTitle: "Re-init selected domain",

// в en.modal
reinitConfirmTitle: "Re-init — confirm",
reinitConfirmBody: (id: string, files: number, srcCount: number) =>
  `Domain «${id}». ${files} md-files across ${srcCount} source paths. Re-run init?`,
reinitConfirmBodyNoSources: (id: string) =>
  `Domain «${id}». No source paths — only metadata refresh (entity_types, language_notes).`,
```

**RU.**

```ts
reinitTitle: "Повторный init выбранного домена",
reinitConfirmTitle: "Re-init — подтвердите",
reinitConfirmBody: (id, files, srcCount) =>
  `Домен «${id}». ${files} md-файлов в ${srcCount} sourcePaths. Запустить повторный init?`,
reinitConfirmBodyNoSources: (id) =>
  `Домен «${id}». sourcePaths пусты — будут обновлены только метаданные (entity_types, language_notes).`,
```

**ES.** Аналогично; тип `I18n = typeof en` ловит любой пропуск через `tsc --noEmit`.

### Task 2: Поле `reinitBtn` и создание кнопки

В блоке field-declarations (~line 45) после `private initBtn?: HTMLButtonElement;`:

```ts
private reinitBtn?: HTMLButtonElement;
```

В `onOpen()` после создания `refreshBtn` (~line 120-121):

```ts
this.reinitBtn = domainRow.createEl("button", {
  text: "⟳",
  attr: { title: T.view.reinitTitle },
});
this.reinitBtn.disabled = true;
this.reinitBtn.addEventListener("click", () => void this.runReinit());
this.domainSelect.addEventListener("change", () => {
  if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect!.value;
});
```

Initial `disabled = true` корректен: при создании `domainSelect.value` пуст; `refreshDomains()` приведёт состояние в соответствие.

### Task 3: Синхронизация `disabled`

- `refreshDomains()` — в конце, после восстановления value:
  ```ts
  if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect.value;
  ```
- `setRunning(...)` — после `formatBtn.disabled = true`:
  ```ts
  if (this.reinitBtn) this.reinitBtn.disabled = true;
  ```
- `finish(...)` — после `formatBtn.disabled = false`:
  ```ts
  if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);
  ```

Пре-существующие безусловные присваивания других кнопок не трогать (out of scope).

### Task 4: `runReinit()`

Приватный async-метод, размещён после `openAddDomain()`:

```ts
private async runReinit(): Promise<void> {
  if (!this.domainSelect) return;
  const domainId = this.domainSelect.value;
  if (!domainId) return;

  let entry: DomainEntry | undefined;
  try {
    const domains = await this.plugin.controller.loadDomains();
    entry = domains.find((d) => d.id === domainId);
  } catch {
    return;
  }
  if (!entry) return;

  const T = i18n().modal;
  const sourcePaths = entry.sourcePaths ?? [];
  const hasSources = sourcePaths.length > 0;

  let body: string;
  if (hasSources) {
    const mdFiles = this.app.vault.getFiles().filter(
      (f) => f.extension === "md" && sourcePaths.some((p) => f.path.startsWith(p)),
    );
    body = T.reinitConfirmBody(entry.id, mdFiles.length, sourcePaths.length);
  } else {
    body = T.reinitConfirmBodyNoSources(entry.id);
  }

  new ConfirmModal(
    this.app,
    T.reinitConfirmTitle,
    [body],
    () => void this.plugin.controller.init(
      entry!.id,
      false,
      hasSources ? sourcePaths : undefined,
    ),
  ).open();
}
```

`DomainEntry` и `ConfirmModal` уже импортированы в начале `src/view.ts`. `controller.init(domain, dryRun, sourcePaths?)` — сигнатура `src/controller.ts:308`. Single-flight, Notice on busy, инжекция `--sources` — внутри `controller.init` (см. [[wiki-controller]], [[single-flight-guard]]).

### Task 5: Version bump + manual verification

- Bump patch `0.1.96 → 0.1.97` в `package.json` и `src/manifest.json`.
- `npm run build` → `main.js`.
- Manual в Obsidian (5 кейсов из спеки § Testing).

## Self-Review

**Покрытие спеки:**

- UI кнопка — Task 2.
- `disabled` во всех четырёх моментах (change / refreshDomains / setRunning / finish) — Tasks 2-3.
- `runReinit` с обеими ветками sourcePaths — Task 4.
- i18n-ключи — Task 1.
- Edge cases (domain исчез, empty sourcePaths, mobile отсутствие) — закрыты ранними `return` + проверкой `if (this.reinitBtn)` и mobile-веткой создания `domainRow`.
- 5 manual-кейсов — Task 5 Step 3.

**Type consistency.** Ключи `view.reinitTitle`, `modal.reinitConfirmTitle`, `modal.reinitConfirmBody(id, files, srcCount)`, `modal.reinitConfirmBodyNoSources(id)` идентичны между Task 1 и Task 4 call sites. Сигнатура `controller.init` подтверждена.

**Без placeholder'ов:** все steps содержат точный код или команды.

## Связанные страницы

- [[reinit-button-design]] — спецификация
- [[llm-wiki-view]] — модифицируемый компонент
- [[init-operation]] — диспатчируемая операция
- [[wiki-controller]] — `controller.init` с single-flight
- [[single-flight-guard]] — паттерн
