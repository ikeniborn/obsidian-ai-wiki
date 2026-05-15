---
title: Re-init Button Implementation Plan
date: 2026-05-15
spec: docs/superpowers/specs/2026-05-15-reinit-button-design.md
review:
  plan_hash: 16bde93d18d6c82c
  spec_hash: a608236bc9f11d81
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Re-init Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `⟳` button to the sidebar `domainRow` that re-runs `controller.init` for the currently selected domain with its stored `sourcePaths`.

**Architecture:** UI-only change in `src/view.ts` + 4 new i18n keys in `src/i18n.ts`. New private method `runReinit()` loads the domain entry, counts matching `.md` files in `sourcePaths`, shows a `ConfirmModal`, then delegates to existing `controller.init(id, false, sourcePaths|undefined)`. Disabled state of the button is synchronized with `domainSelect.value` and `setRunning`/`finish` transitions. No changes to controller, agent-runner, phases, or types.

**Tech Stack:** TypeScript, Obsidian API, esbuild. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-15-reinit-button-design.md`.

---

## File Structure

| File | Change |
|---|---|
| `src/i18n.ts` | Add 4 keys to `view`/`modal` sections in `en`, `ru`, `es` locales. |
| `src/view.ts` | Add `reinitBtn` field, create button in `domainRow`, register `change` handler on `domainSelect`, sync `disabled` in `refreshDomains`/`setRunning`/`finish`, add `runReinit()` method. |
| `package.json`, `src/manifest.json` | Patch bump on build (CLAUDE.md rule). |

Project has no DOM-mock for view; manual verification only (see spec § Testing). TypeScript build + `tsc --noEmit` are the automated gates.

---

### Task 1: Add i18n keys

**Files:**
- Modify: `src/i18n.ts` (en `view` ~line 84, en `modal` ~line 148, ru `view` ~line 280, ru `modal` ~line 345, es `view` ~line 475, es `modal` ~line 540)

- [ ] **Step 1: Add `reinitTitle` to `en.view`**

Insert after `refreshTitle: "Refresh domains",` line:

```ts
    reinitTitle: "Re-init selected domain",
```

- [ ] **Step 2: Add `reinitConfirm*` keys to `en.modal`**

Insert after `initConfirmBody: (files: number, folders: number) => ...,` block (just before `fileErrorTitle`):

```ts
    reinitConfirmTitle: "Re-init — confirm",
    reinitConfirmBody: (id: string, files: number, srcCount: number) =>
      `Domain «${id}». ${files} md-files across ${srcCount} source paths. Re-run init?`,
    reinitConfirmBodyNoSources: (id: string) =>
      `Domain «${id}». No source paths — only metadata refresh (entity_types, language_notes).`,
```

- [ ] **Step 3: Mirror keys in `ru.view`**

Insert after `refreshTitle: "Обновить домены",`:

```ts
    reinitTitle: "Повторный init выбранного домена",
```

- [ ] **Step 4: Mirror keys in `ru.modal`**

Insert after `initConfirmBody: (files: number, folders: number) => ...,` block:

```ts
    reinitConfirmTitle: "Re-init — подтвердите",
    reinitConfirmBody: (id: string, files: number, srcCount: number) =>
      `Домен «${id}». ${files} md-файлов в ${srcCount} sourcePaths. Запустить повторный init?`,
    reinitConfirmBodyNoSources: (id: string) =>
      `Домен «${id}». sourcePaths пусты — будут обновлены только метаданные (entity_types, language_notes).`,
```

- [ ] **Step 5: Mirror keys in `es.view`**

Insert after `refreshTitle: "Actualizar dominios",`:

```ts
    reinitTitle: "Re-init del dominio seleccionado",
```

- [ ] **Step 6: Mirror keys in `es.modal`**

Insert after the `initConfirmBody` block:

```ts
    reinitConfirmTitle: "Re-init — confirmar",
    reinitConfirmBody: (id: string, files: number, srcCount: number) =>
      `Dominio «${id}». ${files} archivos md en ${srcCount} rutas fuente. ¿Re-ejecutar init?`,
    reinitConfirmBodyNoSources: (id: string) =>
      `Dominio «${id}». Sin rutas fuente — solo refresco de metadatos (entity_types, language_notes).`,
```

- [ ] **Step 7: Verify type signature matches across locales**

Run: `npx tsc --noEmit`

Expected: No errors. `ru` and `es` typed as `I18n` (= `typeof en`), so any missing key will fail compile.

- [ ] **Step 8: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add reinit button strings (view.reinitTitle, modal.reinitConfirm*)"
```

---

### Task 2: Declare `reinitBtn` field and create it in `domainRow`

**Files:**
- Modify: `src/view.ts` (field declarations near line 45, `onOpen` `domainRow` block at ~line 117-121)

- [ ] **Step 1: Add field**

In the field-declarations block (after `private initBtn?: HTMLButtonElement;` near line 45), insert:

```ts
  private reinitBtn?: HTMLButtonElement;
```

- [ ] **Step 2: Create button after `refreshBtn`**

In `onOpen()`, after these lines (around 120-121):

```ts
      const refreshBtn = domainRow.createEl("button", { text: "↻", attr: { title: T.view.refreshTitle } });
      refreshBtn.addEventListener("click", () => void this.refreshDomains());
```

insert:

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

Initial `disabled = true` is correct: at creation `domainSelect.value` is empty (no options populated yet); `refreshDomains()` will reconcile it once domains load.

- [ ] **Step 3: Build to verify syntax**

Run: `npm run build`

Expected: build succeeds (`main.js` regenerated). No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add reinitBtn to domainRow with change-handler disabled sync"
```

---

### Task 3: Sync `reinitBtn.disabled` in `refreshDomains`/`setRunning`/`finish`

**Files:**
- Modify: `src/view.ts` (`refreshDomains` ~line 215-229, `setRunning` ~line 276-325, `finish` ~line 547-583)

- [ ] **Step 1: Sync in `refreshDomains`**

At the end of `refreshDomains()`, after the `if (previous && ...)` block (line 226-228), append:

```ts
    if (this.reinitBtn) this.reinitBtn.disabled = !this.domainSelect.value;
```

- [ ] **Step 2: Disable in `setRunning`**

In `setRunning(...)`, after `if (this.formatBtn) this.formatBtn.disabled = true;` (line 287), insert:

```ts
    if (this.reinitBtn) this.reinitBtn.disabled = true;
```

- [ ] **Step 3: Re-sync in `finish`**

In `finish(...)`, after `this.formatBtn.disabled = false;` (line 556), insert:

```ts
    if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);
```

The pre-existing four lines above (`initBtn`/`ingestBtn`/`lintBtn`/`formatBtn`) are unguarded, but `reinitBtn` is created only on desktop (mobile skips the whole `!isMobile` block), so the `if` guard matches the field's optional type. Do not "fix" the pre-existing unguarded lines — that is out of scope.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): sync reinitBtn disabled with domain selection and op state"
```

---

### Task 4: Implement `runReinit()` method

**Files:**
- Modify: `src/view.ts` (new private method placed near other private handlers, e.g. after `openAddDomain` at ~line 266)

- [ ] **Step 1: Add the method**

Insert the following private method directly after `openAddDomain()` closes (before `submitQuery` at line 268):

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

Notes:
- Imports `DomainEntry` and `ConfirmModal` already exist at the top of `src/view.ts` (lines 2, 5).
- `controller.init(domain, dryRun, sourcePaths?)` signature confirmed at `src/controller.ts:308`.
- Single-flight, Notice on busy, and `--sources` injection are handled inside `controller.init` — do not duplicate.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): runReinit — confirm modal + controller.init for selected domain"
```

---

### Task 5: Version bump and manual verification

**Files:**
- Modify: `package.json`, `src/manifest.json`

- [ ] **Step 1: Bump patch (CLAUDE.md rule: every build → patch bump)**

Read current versions, bump `0.1.96` → `0.1.97` in both files.

- [ ] **Step 2: Final build**

Run: `npm run build`

Expected: `main.js` regenerated, no errors.

- [ ] **Step 3: Manual verification (5 cases from spec § Testing)**

Reload Obsidian and verify in the sidebar:

1. Domain with non-empty `sourcePaths` selected → click `⟳` → ConfirmModal shows md-file count + sourcePaths count → confirm → Progress shows `init_start`/`init_step` events.
2. `(all)` selected → `⟳` is greyed; click does nothing.
3. Domain with empty `sourcePaths` selected → ConfirmModal body reads "only metadata refresh" → init runs without `--sources`.
4. Start any init → during run `⟳` is greyed alongside other action buttons.
5. Cancel the running init → after `finish()`, `⟳` re-enables (since a domain is still selected).

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore(release): 0.1.97 — re-init button in side panel"
```

---

## Self-Review Notes

- **Spec coverage:** UI button (Task 2), disabled state in all four moments — change/refresh/setRunning/finish (Tasks 2-3), `runReinit` logic with both source-path branches (Task 4), i18n keys (Task 1), edge cases (covered by `runReinit` early returns + `ConfirmModal` callback + controller's own guards). All 5 manual verification cases mapped (Task 5 § Step 3).
- **No placeholders:** every step has exact code or commands.
- **Type consistency:** key names — `view.reinitTitle`, `modal.reinitConfirmTitle`, `modal.reinitConfirmBody(id, files, srcCount)`, `modal.reinitConfirmBodyNoSources(id)` — identical across Task 1 and Task 4 call sites. `controller.init(domain, dryRun, sourcePaths?)` signature matches `src/controller.ts:308`.
