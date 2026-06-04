---
review:
  plan_hash: "e17ffade94238498"
  spec_hash: "6071a239b0bf92d0"
  last_run: 2026-06-04
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Task 5: Rewrite lintBtn click handler"
      section_hash: "d9ce8e91a28fd756"
      text: "Самоссылка: «This task depends on Task 5 (modals.ts)» — должно быть Task 6. Противоречие с той же строкой: «it will compile once Task 6 is done»."
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-003
      phase: verifiability
      severity: INFO
      section: "Task 3: Add CSS — user-select and count muted style"
      section_hash: "4d296522cfd5cebe"
      text: "Task 3 не содержит команды верификации. Нет grep-проверки, что CSS-правила добавлены корректно. DoD неполный."
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-004
      phase: verifiability
      severity: INFO
      section: "Task 5: Rewrite lintBtn click handler"
      section_hash: "d9ce8e91a28fd756"
      text: "Task 5 не имеет шага verify/compile — делегирует проверку Task 6. Явно оговорено в тексте, но нет шага 'Verify' с ожидаемым выводом внутри Task 5."
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-002
      phase: dependencies
      severity: WARNING
      section: "Task 5: Rewrite lintBtn click handler"
      section_hash: "d9ce8e91a28fd756"
      text: "Task 5 использует новую сигнатуру LintOptionsModal из Task 6 (M=6 > N=5). Нарушение M < N. Признано в тексте задачи, но порядок выполнения должен быть Task 6 → Task 5 или слиты в одну задачу."
      verdict: fixed
      verdict_at: 2026-06-04
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-04-lint-modal-ux-design.md
---

# Lint Modal UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Lint modal to use the sidebar's pre-selected domain, reorder its UI, add select-all/deselect-all, show article counts, and enable smart button availability in the sidebar panel.

**Architecture:** Remove the settings UI toggle for lint (keep the setting value); add `updateButtonAvailability()` to view for domain/file-aware button state; refactor `LintOptionsModal` to accept a single `DomainEntry` instead of a list; add i18n keys for new buttons; fix `eval_result` rendering and text selectability.

**Tech Stack:** TypeScript, Obsidian API (`Setting`, `ToggleComponent`, `MarkdownRenderer`, `Component`, `vault.getMarkdownFiles()`), CSS custom properties

---

## File Map

| File | Change |
|---|---|
| `src/i18n.ts` | Add `lintSelectAll` / `lintDeselectAll` to all 3 locales (en/ru/es) in modal section |
| `src/settings.ts` | Remove lines 652–663 (Lint heading + useLlm toggle) |
| `src/styles.css` | Add `user-select: text` to 3 selectors; add `.ai-wiki-count-muted` |
| `src/view.ts` | Add `updateButtonAvailability()`; hook `domainSelect.change` + `file-open`; fix `finish()`; rewrite lint button handler; fix `eval_result` |
| `src/modals.ts` | Refactor `LintOptionsModal`: new constructor signature, reordered layout, select-all/deselect-all, article counts, updated `submit()` |
| `src/controller.ts` | Verify only — grep for `"all"` in `lint()` to confirm no change needed |

---

## Task 1: Add i18n keys for select-all / deselect-all buttons

**Files:**
- Modify: `src/i18n.ts` — lines 180, 414, 646 (after `lint_title` in each locale's modal section)

- [ ] **Step 1: Open i18n.ts and locate the three `lint_title` lines**

```bash
grep -n "lint_title" src/i18n.ts
```

Expected output shows 3 lines: ~180 (en), ~414 (ru), ~646 (es).

- [ ] **Step 2: Add keys after `lint_title` in English locale (line ~180)**

In `src/i18n.ts`, after `lint_title: "Lint Wiki",`:

```ts
    lint_title: "Lint Wiki",
    lintDeselectAll: "Убрать все",
    lintSelectAll: "Добавить все",
```

- [ ] **Step 3: Add keys after `lint_title` in Russian locale (line ~414)**

```ts
    lint_title: "Lint Wiki",
    lintDeselectAll: "Убрать все",
    lintSelectAll: "Добавить все",
```

- [ ] **Step 4: Add keys after `lint_title` in Spanish locale (line ~646)**

```ts
    lint_title: "Lint Wiki",
    lintDeselectAll: "Quitar todos",
    lintSelectAll: "Añadir todos",
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add lintSelectAll and lintDeselectAll keys"
```

---

## Task 2: Remove Lint settings UI block

**Files:**
- Modify: `src/settings.ts` — remove lines 652–663

- [ ] **Step 1: Verify the block to remove**

```bash
sed -n '648,668p' src/settings.ts
```

Expected: lines 652–663 contain `h3_lint` heading + `lintUseLlm_name` toggle + closing paren. Lines 648–651 and 665–668 are adjacent sections.

- [ ] **Step 2: Remove the Lint settings UI block**

In `src/settings.ts`, delete these 12 lines (652–663):

```ts
    // ── Lint settings ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_lint).setHeading();

    new Setting(containerEl)
      .setName(T.settings.lintUseLlm_name)
      .setDesc(T.settings.lintUseLlm_desc)
      .addToggle((t) =>
        t.setValue(s.lintOptions.useLlm)
          .onChange(async (v) => {
            s.lintOptions.useLlm = v;
            await this.plugin.saveSettings();
          }),
      );
```

Leave `// ── Graph settings ──...` block untouched.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (i18n keys for settings still present in type — that's fine, they're used in the type definition but no longer referenced in settings.ts UI).

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): remove Lint UI section from settings panel"
```

---

## Task 3: Add CSS — user-select and count muted style

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Find `.ai-wiki-final` in styles.css**

```bash
grep -n "ai-wiki-final\|ai-wiki-chat-msg {" src/styles.css
```

Expected: `.ai-wiki-final` at line ~70, `.ai-wiki-chat-msg {` at line ~74.

- [ ] **Step 2: Add user-select rules after existing .ai-wiki-final block**

Find the `.ai-wiki-final { ... }` line (~70) and append after it:

```css
.ai-wiki-final,
.ai-wiki-chat-msg,
.ai-wiki-eval-result {
  user-select: text;
}
```

- [ ] **Step 3: Add .ai-wiki-count-muted style**

After the `user-select` block, add:

```css
.ai-wiki-count-muted {
  color: var(--text-muted);
  font-size: 0.9em;
}
```

- [ ] **Step 4: Verify CSS rules added**

```bash
grep -n "user-select: text\|ai-wiki-count-muted" src/styles.css
```

Expected: 2 matches — `user-select: text` and `.ai-wiki-count-muted`.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "feat(styles): add user-select text for query results, add ai-wiki-count-muted"
```

---

## Task 4: Add `updateButtonAvailability()` and hook it to domainSelect + file-open + finish()

**Files:**
- Modify: `src/view.ts`

Context: `AiWikiView` class. `askBtn` is declared at line ~82. `domainSelect` at ~83. `lintBtn` ~86. `formatBtn` ~87. `reinitBtn` ~88. `addSourceBtn` ~89. The `domainSelect.change` listener is at line ~248 (only saves lastDomain). The `finish()` method starts at ~830; lines ~834–840 unconditionally re-enable buttons.

- [ ] **Step 1: Add the `updateButtonAvailability()` method to AiWikiView**

Find the `private async refreshDomains()` method (line ~359). Insert this new method immediately before it:

```ts
private updateButtonAvailability(): void {
  const hasDomain = !!(this.domainSelect?.value);
  const activeFile = this.plugin.app.workspace.getActiveFile();
  const canFormat = !!activeFile && !activeFile.path.startsWith("!Wiki/");

  if (this.askBtn)       this.askBtn.disabled       = !hasDomain;
  if (this.ingestBtn)    this.ingestBtn.disabled    = !hasDomain;
  if (this.lintBtn)      this.lintBtn.disabled      = !hasDomain;
  if (this.formatBtn)    this.formatBtn.disabled    = !canFormat;
  if (this.reinitBtn)    this.reinitBtn.disabled    = !hasDomain;
  if (this.addSourceBtn) this.addSourceBtn.disabled = !hasDomain;
}
```

- [ ] **Step 2: Call updateButtonAvailability() from domainSelect change handler**

The existing handler at line ~248:

```ts
this.domainSelect.addEventListener("change", () => {
  void this.plugin.localConfigStore.save({ lastDomain: this.domainSelect!.value });
});
```

Change to:

```ts
this.domainSelect.addEventListener("change", () => {
  void this.plugin.localConfigStore.save({ lastDomain: this.domainSelect!.value });
  this.updateButtonAvailability();
});
```

- [ ] **Step 3: Register file-open listener in onOpen()**

Find where `onOpen()` sets up the view. Look for the call to `refreshDomains()` at the end of `onOpen()` (~line 356). Register the workspace listener before that call:

```ts
this.registerEvent(
  this.plugin.app.workspace.on("file-open", () => this.updateButtonAvailability()),
);
```

- [ ] **Step 4: Replace unconditional enables in finish() with updateButtonAvailability()**

In `finish()` (~line 830), find these lines and update:

```ts
// BEFORE (lines ~834-840):
this.askBtn.disabled = false;
if (this.initBtn) this.initBtn.disabled = false;
if (this.ingestBtn) this.ingestBtn.disabled = false;
if (this.lintBtn) this.lintBtn.disabled = false;
if (this.formatBtn) this.formatBtn.disabled = false;
if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);
if (this.addSourceBtn) this.addSourceBtn.disabled = !(this.domainSelect && this.domainSelect.value);
```

```ts
// AFTER:
if (this.initBtn) this.initBtn.disabled = false;
this.updateButtonAvailability();
if (this.reinitBtn) this.reinitBtn.disabled = !(this.domainSelect && this.domainSelect.value);
if (this.addSourceBtn) this.addSourceBtn.disabled = !(this.domainSelect && this.domainSelect.value);
```

Note: `reinitBtn` and `addSourceBtn` are already handled by `updateButtonAvailability()`. After this change they are redundant but harmless — leave them for now (surgical change only).

Actually, they ARE handled by `updateButtonAvailability()` so simply do:

```ts
// AFTER:
if (this.initBtn) this.initBtn.disabled = false;
this.updateButtonAvailability();
```

The `reinitBtn`/`addSourceBtn` lines are now covered by `updateButtonAvailability()` — remove the duplicates.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add updateButtonAvailability, hook domain-select and file-open"
```

---

## Task 5: Rewrite lintBtn click handler

**Files:**
- Modify: `src/view.ts` — lines ~346–353

**⚠️ Execute after Task 6.** This task depends on Task 6 (modals.ts) introducing the new `LintOptionsModal` constructor signature. Write the code here first, then complete Task 6 — compilation verify is in Task 6 Step 3, which covers both files.

- [ ] **Step 1: Replace the existing lintBtn click handler**

Current code at line ~346:

```ts
this.lintBtn.addEventListener("click", () => {
  new LintOptionsModal(
    this.plugin.app,
    this.domains,
    this.plugin.settings.lintOptions.useLlm,
    (domain, opts) => void this.plugin.controller.lint(domain, opts),
  ).open();
});
```

Replace with:

```ts
this.lintBtn.addEventListener("click", () => {
  const domainEntry = this.domains.find(d => d.id === this.domainSelect!.value);
  if (!domainEntry) return;

  const counts = new Map<string, number>();
  const allMd = this.plugin.app.vault.getMarkdownFiles();
  for (const et of domainEntry.entity_types ?? []) {
    if (!et.wiki_subfolder) continue;
    const prefix = `${domainEntry.wiki_folder}/${et.wiki_subfolder}/`;
    counts.set(et.type, allMd.filter(f => f.path.startsWith(prefix)).length);
  }

  new LintOptionsModal(
    this.plugin.app,
    domainEntry,
    this.plugin.settings.lintOptions.useLlm,
    counts,
    (opts) => void this.plugin.controller.lint(domainEntry.id, opts),
  ).open();
});
```

---

## Task 6: Refactor LintOptionsModal

**Files:**
- Modify: `src/modals.ts` — lines 673–763 (full `LintOptionsModal` class)

- [ ] **Step 1: Replace the class definition**

Replace the entire `LintOptionsModal` class (lines 673–763) with:

```ts
export class LintOptionsModal extends Modal {
  private useLlm: boolean;
  private entityTypeFilter: string[];

  constructor(
    app: App,
    private domain: DomainEntry,
    private defaultUseLlm: boolean,
    private articleCounts: Map<string, number>,
    private onSubmit: (opts: { useLlm: boolean; entityTypeFilter: string[] }) => void,
  ) {
    super(app);
    this.useLlm = defaultUseLlm;
    this.entityTypeFilter = (domain.entity_types ?? []).map(e => e.type);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.lint_title });

    // Use LLM toggle — top
    new Setting(contentEl)
      .setName("Use LLM")
      .addToggle(t => t.setValue(this.useLlm).onChange(v => { this.useLlm = v; }));

    // Entity types section
    const entityTypes = this.domain.entity_types ?? [];
    if (entityTypes.length) {
      contentEl.createEl("p", { text: "Entity types:" });

      const btnRow = contentEl.createDiv({ cls: "ai-wiki-lint-btn-row" });
      const toggles: ToggleComponent[] = [];

      const deselectBtn = btnRow.createEl("button", { text: T.lintDeselectAll });
      const selectBtn   = btnRow.createEl("button", { text: T.lintSelectAll });

      deselectBtn.addEventListener("click", () => {
        toggles.forEach(t => t.setValue(false));
        this.entityTypeFilter = [];
      });
      selectBtn.addEventListener("click", () => {
        toggles.forEach(t => t.setValue(true));
        this.entityTypeFilter = entityTypes.map(e => e.type);
      });

      for (const et of entityTypes) {
        const setting = new Setting(contentEl).setName(et.type);
        const countVal = this.articleCounts.get(et.type);
        if (countVal !== undefined) {
          setting.nameEl.createEl("span", {
            text: ` (${countVal})`,
            cls: "ai-wiki-count-muted",
          });
        }
        setting.addToggle(t => {
          t.setValue(this.entityTypeFilter.includes(et.type));
          t.onChange(checked => {
            if (checked) {
              if (!this.entityTypeFilter.includes(et.type)) this.entityTypeFilter.push(et.type);
            } else {
              this.entityTypeFilter = this.entityTypeFilter.filter(x => x !== et.type);
            }
          });
          toggles.push(t);
        });
      }
    }

    // Run button
    new Setting(contentEl)
      .addButton(b =>
        b.setButtonText(`▶ ${T.run}`)
          .setCta()
          .onClick(() => {
            this.close();
            this.submit();
          }),
      );
  }

  private submit(): void {
    this.onSubmit({
      useLlm: this.useLlm,
      entityTypeFilter: [...this.entityTypeFilter],
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Verify `ToggleComponent` is imported in modals.ts**

```bash
grep "ToggleComponent" src/modals.ts | head -3
```

If not found, add to the import from `"obsidian"`:

```ts
import { App, Modal, Setting, ToggleComponent } from "obsidian";
```

- [ ] **Step 3: Verify TypeScript compiles (both view.ts and modals.ts together)**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts src/modals.ts
git commit -m "feat(modal): refactor LintOptionsModal — single domain, reorder UI, select-all, article counts"
```

---

## Task 7: Verify controller.ts — no "all" branch needed

**Files:**
- Read only: `src/controller.ts`

- [ ] **Step 1: Grep for "all" branch in lint()**

```bash
grep -n '"all"' src/controller.ts
```

Expected output:

```
190:    const args = domain === "all" ? [] : [domain];
```

With the new flow, `domain` passed to `lint()` is always a real domain ID (lint button is disabled when `domainSelect.value === ""`). The `"all"` branch is now unreachable from the UI.

- [ ] **Step 2: Decision — leave or remove**

Per the spec (§4), no code change required. The `"all"` path is dead UI-wise but harmless — removing it would be out of scope. Task is complete.

- [ ] **Step 3: Commit (empty — just note in git log)**

No files to change. Task complete by verification.

---

## Task 8: Fix eval_result — switch to MarkdownRenderer

**Files:**
- Modify: `src/view.ts` — lines ~755–757

- [ ] **Step 1: Locate eval_result handler**

```bash
grep -n "eval_result\|setText.*eval" src/view.ts
```

Expected: lines ~755–757 in the `processEvent()` method.

- [ ] **Step 2: Replace setText with MarkdownRenderer.render**

Current code (~line 755):

```ts
} else if (ev.kind === "eval_result") {
  const el = this.stepsEl.createEl("div", { cls: "ai-wiki-eval-result" });
  el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);
}
```

Replace with:

```ts
} else if (ev.kind === "eval_result") {
  const el = this.stepsEl.createEl("div", { cls: "ai-wiki-eval-result" });
  const text = `**[eval: ${ev.score}/10]** ${ev.reasoning}`;
  const comp = new Component();
  void MarkdownRenderer.render(this.app, text, el, "", comp);
}
```

`MarkdownRenderer` and `Component` are already imported (line 1 of view.ts confirms both).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): render eval_result with MarkdownRenderer for markdown support"
```

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §1 Remove settings UI | Task 2 |
| §2a updateButtonAvailability | Task 4 |
| §2b Lint button handler | Task 5 |
| §3a Constructor signature | Task 6 |
| §3b Modal layout | Task 6 |
| §3c Select all / Deselect all | Tasks 1 + 6 |
| §3d Article count display | Task 6 |
| §3e submit() change | Task 6 |
| §4 Controller verify | Task 7 |
| §5a user-select CSS | Task 3 |
| §5b eval_result MarkdownRenderer | Task 8 |

All spec sections covered.

### Placeholder scan

No TBDs, no "similar to Task N" references, no steps without code. All type names consistent (`DomainEntry`, `ToggleComponent`, `Map<string, number>`).

### Type consistency

- `LintOptionsModal` constructor: `(App, DomainEntry, boolean, Map<string, number>, (opts: {...}) => void)` — matches call site in Task 5.
- `this.domain.entity_types` used in modal — `DomainEntry.entity_types` is `EntityType[]` type per existing codebase usage (verified at modals.ts:733 before refactor).
- `et.wiki_subfolder`, `domainEntry.wiki_folder` — used consistently in Task 5 and Task 6.
