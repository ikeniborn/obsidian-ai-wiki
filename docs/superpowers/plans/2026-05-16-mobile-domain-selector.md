---
review:
  plan_hash: 1e59a4355b862f05
  spec_hash: 2d0c99bf5787fa32
  last_run: 2026-05-16
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      severity: WARNING
      phase: coverage
      section: "Task 4"
      section_hash: 2ef9858892787afe
      text: "Task 4 (guard finish() against undefined) not covered by spec."
      verdict: fixed
      resolution: "Spec extended — finish() guard added to Behaviour section (spec_hash bumped c1669c3db977649d → 2d0c99bf5787fa32)."
---

# Mobile domain selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show domain selector on mobile for query operation so user can scope queries to a specific domain.

**Architecture:** Extract `domain-row` markup from `onOpen` into private helper `buildDomainRow(parent, { withActions })`. Desktop uses `withActions: true` (full: select + refresh + reinit + ingest/lint/format actions). Mobile uses `withActions: false` (only select + refresh). Also fix latent crash in `finish()` where mobile-undefined buttons get assigned `.disabled` without guards.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Platform.isMobile`, `ItemView`), esbuild, vitest.

---

## Files touched

- Modify: `src/view.ts` — extract helper, replace desktop block, add mobile branch, guard `finish()`.
- Modify: `src/i18n.ts` — add `view.sectionDomainMobile` to `en`/`ru`/`es`.

---

### Task 1: Add i18n key `sectionDomainMobile`

**Files:**
- Modify: `src/i18n.ts` (three locale blocks: `en` ~line 92, `ru` ~line 298, `es` ~line 502)

- [ ] **Step 1: Add key to `en.view`**

Find `sectionDomain: "Fill / Maintain",` and insert below:

```ts
sectionDomain: "Fill / Maintain",
sectionDomainMobile: "Domain",
```

- [ ] **Step 2: Add key to `ru.view`**

Find `sectionDomain: "Наполнение / Актуализация",` and insert below:

```ts
sectionDomain: "Наполнение / Актуализация",
sectionDomainMobile: "Домен",
```

- [ ] **Step 3: Add key to `es.view`**

Find `sectionDomain: "Rellenar / Mantener",` and insert below:

```ts
sectionDomain: "Rellenar / Mantener",
sectionDomainMobile: "Dominio",
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `I18n` type inferred from `en`; ru/es must match shape — all three must have `sectionDomainMobile`.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add view.sectionDomainMobile for mobile domain selector"
```

---

### Task 2: Extract `buildDomainRow` helper

Pure refactor — desktop behavior unchanged. Move existing markup into private method without changing logic.

**Files:**
- Modify: `src/view.ts` (extract from `onOpen` ~lines 116-156, add helper method)

- [ ] **Step 1: Add `buildDomainRow` method**

Insert after `onClose()` (around line 224), before `refreshDomains()`:

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
      this.ingestBtn.addEventListener("click", () => {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) { new Notice(i18n().view.noActiveFile); return; }
        const domainId = this.domainSelect!.value || undefined;
        new ConfirmModal(this.plugin.app, "Ingest — confirm", [
          `File: ${file.name}`,
          "Claude will read the file, extract entities and update domain wiki pages.",
        ], () => void this.plugin.controller.ingestActive(domainId)).open();
      });
      this.lintBtn.addEventListener("click", () => {
        const d = this.domainSelect!.value;
        const domainLabel = d ? `«${d}»` : "all wiki";
        new ConfirmModal(this.plugin.app, "Lint — confirm", [
          `Domain: ${domainLabel}`,
          "Claude will check wiki pages for quality and update entity_types.",
        ], () => void this.plugin.controller.lint(d || "all")).open();
      });
    }

    void this.refreshDomains();
  }
```

Note: `this.domainSelect.value` becomes `this.domainSelect!.value` inside closures because `domainSelect` field type is `HTMLSelectElement | undefined`. The original inline code had a non-optional local; helper must add the non-null assertion.

- [ ] **Step 2: Replace desktop block in `onOpen`**

Replace the block from `// 2+3. Наполнение / Актуализация` through `void this.refreshDomains();` (current view.ts lines 115-156, inside `if (!isMobile)`) with:

```ts
      // 2+3. Наполнение / Актуализация
      root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
      this.buildDomainRow(root, { withActions: true });
```

So the desktop branch of `if (!isMobile) { ... }` now contains only:
- section label "sectionCreate" + initBtn + handler
- section label "sectionDomain" + `buildDomainRow(root, { withActions: true })`

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds, `main.js` produced.

- [ ] **Step 5: Run existing tests**

Run: `npm test`
Expected: all tests pass (this is pure refactor; no behavior change on desktop).

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "refactor(view): extract buildDomainRow helper from onOpen"
```

---

### Task 3: Add mobile branch — show selector only

**Files:**
- Modify: `src/view.ts` — extend `else` branch of `if (!isMobile)` in `onOpen`

- [ ] **Step 1: Find current mobile branch**

After Task 2, `onOpen` has:

```ts
if (!isMobile) {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionCreate });
  const createRow = root.createDiv("ai-wiki-create-row");
  this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "ai-wiki-init-btn" });
  this.initBtn.addEventListener("click", () => this.openAddDomain());

  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
  this.buildDomainRow(root, { withActions: true });
}
```

No `else` block exists today — comment `// На mobile … Скрываем секции` precedes the `if`. Mobile currently shows nothing for create/domain.

- [ ] **Step 2: Add mobile `else` branch**

Change to:

```ts
if (!isMobile) {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionCreate });
  const createRow = root.createDiv("ai-wiki-create-row");
  this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "ai-wiki-init-btn" });
  this.initBtn.addEventListener("click", () => this.openAddDomain());

  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomain });
  this.buildDomainRow(root, { withActions: true });
} else {
  root.createDiv({ cls: "ai-wiki-section-label", text: T.view.sectionDomainMobile });
  this.buildDomainRow(root, { withActions: false });
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): show domain selector on mobile for query scoping"
```

---

### Task 4: Guard `finish()` button assignments against undefined

Pre-existing latent crash: `finish()` assigns `.disabled` on `initBtn` / `ingestBtn` / `lintBtn` / `formatBtn` without null check. On mobile (after Task 3, query runs and finishes), these fields stay `undefined` and `undefined.disabled = false` throws TypeError.

**Files:**
- Modify: `src/view.ts` (function `finish` ~lines 604-617)

- [ ] **Step 1: Replace unguarded assignments**

Find this block (view.ts lines 610-613):

```ts
    this.initBtn.disabled = false;
    this.ingestBtn.disabled = false;
    this.lintBtn.disabled = false;
    this.formatBtn.disabled = false;
```

Replace with:

```ts
    if (this.initBtn) this.initBtn.disabled = false;
    if (this.ingestBtn) this.ingestBtn.disabled = false;
    if (this.lintBtn) this.lintBtn.disabled = false;
    if (this.formatBtn) this.formatBtn.disabled = false;
```

(Mirrors the `setRunning` style at lines 329-333 which already uses `if (...)`.)

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Prior to this fix, TS likely accepted `this.initBtn.disabled` only because `strictNullChecks` is off or because the field is non-optional. Verify by checking field declarations are `?` — they are: lines 45-49. So `tsc` should have flagged this already; if it didn't, project tsconfig has loose null-checks. Either way, the guards make code correct.)

- [ ] **Step 3: Build + tests**

Run: `npm run build && npm test`
Expected: build succeeds, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): guard finish() button enables against undefined on mobile"
```

---

### Task 5: Manual verification

**Files:** none.

- [ ] **Step 1: Bump patch version**

Per CLAUDE.md, bump patch in `package.json` and `src/manifest.json` before release build. Do NOT commit yet — verification first.

Read current version from `package.json`. Increment patch (`X.Y.Z` → `X.Y.Z+1`). Apply to both files.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `main.js` produced.

- [ ] **Step 3: Install symlink (skip if already linked)**

Per CLAUDE.md install instructions; skip if `~/.config/obsidian/Plugins/obsidian-llm-wiki` already symlinked to `dist`.

- [ ] **Step 4: Verify on desktop**

Open Obsidian (or reload plugin). Open AIWiki sidebar view. Confirm UI unchanged:
- "Создание / Create" section with Init button
- "Наполнение / Fill / Maintain" section label
- Domain row: select, ↻ refresh, ♻ reinit
- Actions row: Ingest, Lint, Format
- "Запрос / Query" section

Pick a domain → reinit button enables. Run a query → confirm `finish()` re-enables all buttons (no crash, no console errors).

- [ ] **Step 5: Verify on mobile**

Two options:
- Obsidian mobile app on a phone with sync.
- Desktop dev tools mobile emulation: enable via `app.isMobile` injection — open developer console, run `window.Platform = { isMobile: true, isDesktop: false }` *before* opening the view (or temporarily edit code). The cleanest path is to test on the actual mobile app.

Expected mobile UI:
- Header
- "Домен / Domain / Dominio" section label
- Domain row: select + ↻ refresh (no reinit, no ingest/lint/format)
- "Запрос / Query" section with textarea + Ask/AskSave/Cancel buttons
- No "Create" section

Test flow:
1. Open select → see `(all)` + list of domains.
2. Select a domain.
3. Type a question → tap "Ask".
4. Confirm query runs, finishes without crash.
5. Verify `domainId` was forwarded: check that result is scoped to selected domain (or, in dev mode, check that `controller.query` was called with the selected id — `agent.jsonl` log).
6. Switch back to `(all)` → re-run → confirm all-domain scope.

- [ ] **Step 6: CSS sanity check on mobile**

Open mobile view in narrow viewport. Domain row has only `select` + `↻`; should fit without overflow. If row breaks awkwardly, note for follow-up (out of scope of this plan).

- [ ] **Step 7: Commit version bump**

```bash
git add package.json src/manifest.json
git commit -m "chore: bump patch version for mobile domain selector"
```

---

## Self-Review notes

- Spec coverage: every section of the spec maps to a task. Goal (mobile selector visible) → Task 3. Helper extraction → Task 2. i18n key → Task 1. `submitQuery` no-change → confirmed (left untouched). Mobile gating in `controller.ts` / `main.ts` no-change → confirmed (not in Files touched). CSS risk → Task 5 Step 6. The latent `finish()` crash is not in spec but blocks mobile use — added as Task 4.
- Method names consistent: `buildDomainRow` used everywhere.
- No placeholders, no TBDs, all code blocks complete.
