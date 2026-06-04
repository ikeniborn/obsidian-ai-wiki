---
review:
  spec_hash: 6071a239b0bf92d0
  last_run: 2026-06-04
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "3d. Article count display"
      section_hash: b20f8645fb9b682a
      text: "Два альтернативных способа отображения счётчика (setName vs muted span) без указания приоритета — нет DoD"
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-002
      phase: clarity
      severity: INFO
      section: "3b. Modal layout (top to bottom)"
      section_hash: 06b3a428abe57dc3
      text: "\"Label 'Entity types:'\" — не указан тип DOM-элемента (h4, p, Setting). Нет критерия приёмки"
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-003
      phase: clarity
      severity: INFO
      section: "4. Controller"
      section_hash: 38e48b146c29ff35
      text: "Задача §4 — только «verify/confirm», нет DoD: что именно подтверждает реализацию"
      verdict: fixed
      verdict_at: 2026-06-04
    - id: F-004
      phase: clarity
      severity: WARNING
      section: "Out of scope"
      section_hash: ada5c83d9f3b44df
      text: "Секция «Out of scope» содержит i18n — «add to i18n.ts as part of implementation». Противоречие: если добавляется при реализации, это in scope"
      verdict: fixed
      verdict_at: 2026-06-04
chain:
  intent: null
---

# Lint Modal UX Redesign

**Date:** 2026-06-04  
**Scope:** `src/modals.ts`, `src/view.ts`, `src/settings.ts`

## Summary

Refactor the Lint modal and sidebar button availability logic:
- Remove `lintUseLlm` toggle from plugin settings UI
- Redesign `LintOptionsModal`: use pre-selected domain from sidebar, move toggle to top, add select-all/deselect-all, show article counts per entity type
- Add smart button availability based on domain selection and active file

---

## 1. Settings (`src/settings.ts`)

Remove the Lint settings UI block (lines 652–665):

```ts
// REMOVE:
new Setting(containerEl).setName(T.settings.h3_lint).setHeading();
new Setting(containerEl)
  .setName(T.settings.lintUseLlm_name)
  .setDesc(T.settings.lintUseLlm_desc)
  .addToggle(...);
```

Keep `lintOptions.useLlm` in the `PluginSettings` type and default — it is still used as the initial value for the modal toggle and preserves backward compatibility with saved settings.

---

## 2. View (`src/view.ts`)

### 2a. Button availability helper

Add `updateButtonAvailability()` method. Called from:
- `domainSelect` `change` event handler
- `workspace.on("file-open", ...)` registered in `onOpen()`
- End of idle state (replaces unconditional `disabled = false` for ingest/lint/format in lines 835–838)

Rules (when no operation is running):

| Button | Available when |
|---|---|
| `initBtn` | always |
| `askBtn` | `domainSelect.value !== ""` |
| `ingestBtn` | `domainSelect.value !== ""` |
| `lintBtn` | `domainSelect.value !== ""` |
| `formatBtn` | active file exists AND `!file.path.startsWith("!Wiki/")` |
| `reinitBtn` | `domainSelect.value !== ""` |
| `addSourceBtn` | `domainSelect.value !== ""` |

```ts
private updateButtonAvailability(): void {
  const hasDomain = !!(this.domainSelect?.value);
  const activeFile = this.plugin.app.workspace.getActiveFile();
  const canFormat = !!activeFile && !activeFile.path.startsWith("!Wiki/");

  if (this.askBtn)    this.askBtn.disabled     = !hasDomain;
  if (this.ingestBtn) this.ingestBtn.disabled = !hasDomain;
  if (this.lintBtn)   this.lintBtn.disabled   = !hasDomain;
  if (this.formatBtn) this.formatBtn.disabled  = !canFormat;
  if (this.reinitBtn) this.reinitBtn.disabled  = !hasDomain;
  if (this.addSourceBtn) this.addSourceBtn.disabled = !hasDomain;
  // initBtn: always enabled (no change needed)
}
```

The existing `onRunning()` / `onIdle()` methods still disable/enable all buttons wholesale while an operation runs. `onIdle()` calls `updateButtonAvailability()` at the end instead of unconditionally enabling.

### 2b. Lint button handler

Replace `domains[]` + default useLlm args with:
1. Find `DomainEntry` from `this.domains` by `domainSelect.value`
2. Compute `articleCounts: Map<string, number>` — for each entity type with `wiki_subfolder`: count `.md` files via `app.vault.getMarkdownFiles()`
3. Open modal with single domain

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

## 3. Lint Modal (`src/modals.ts`)

### 3a. Constructor signature change

```ts
// BEFORE:
constructor(
  app: App,
  private domains: DomainEntry[],
  private defaultUseLlm: boolean,
  private onSubmit: (domain: string, opts: { useLlm: boolean; entityTypeFilter: string[] }) => void,
)

// AFTER:
constructor(
  app: App,
  private domain: DomainEntry,
  private defaultUseLlm: boolean,
  private articleCounts: Map<string, number>,
  private onSubmit: (opts: { useLlm: boolean; entityTypeFilter: string[] }) => void,
)
```

`this.domain` is fixed — no `"all"` case needed (lint button disabled when no domain selected).

### 3b. Modal layout (top to bottom)

1. `h3` title
2. **Use LLM toggle** (moved from bottom to top)
3. Entity types section:
   - `createEl("p", { text: "Entity types:" })` plain paragraph label
   - Row: **[Убрать все]** **[Добавить все]** buttons
   - List of entities: `toggle | EntityType.type | (N articles)` — count shown in muted span if `wiki_subfolder` is set
4. `▶ Run` button

### 3c. Select all / Deselect all

Store `ToggleComponent[]` refs. On click:
```ts
// Убрать все
toggles.forEach(t => t.setValue(false));
this.entityTypeFilter = [];

// Добавить все
toggles.forEach(t => t.setValue(true));
this.entityTypeFilter = entityTypes.map(e => e.type);
```

i18n: add `lintDeselectAll` and `lintSelectAll` keys to `i18n.ts`; use them for button labels.

### 3d. Article count display

Render count as a muted `<span>` appended to the setting name element:

```ts
const countVal = this.articleCounts.get(et.type);
setting.setName(et.type);
if (countVal !== undefined) {
  setting.nameEl.createEl("span", {
    text: ` (${countVal})`,
    cls: "ai-wiki-count-muted",
  });
}
```

DoD: each entity type row shows `TypeName (N)` in muted style when `wiki_subfolder` is set; shows `TypeName` only when count unavailable.

### 3e. `submit()` change

Remove `domain` from callback — it is no longer a parameter:
```ts
private submit(): void {
  this.onSubmit({
    useLlm: this.useLlm,
    entityTypeFilter: [...this.entityTypeFilter],
  });
}
```

---

## 4. Controller (`src/controller.ts`)

Verify `lint(domainId, opts)` signature — `domainId` is now always a real domain id (never `"all"`).

DoD: grep `src/controller.ts` for `"all"` branch in `lint()` → none found. No code changes required; task is complete when confirmed.

---

## 5. Query result — selectable text and MarkdownRenderer (`src/view.ts`, `src/styles.css`)

### 5a. Text selection (`src/styles.css`)

Obsidian applies `user-select: none` to the entire sidebar panel. Query results rendered in `.ai-wiki-final` are unselectable as a result.

Fix: add `user-select: text` to all text output containers:

```css
.ai-wiki-final,
.ai-wiki-chat-msg,
.ai-wiki-eval-result {
  user-select: text;
}
```

### 5b. MarkdownRenderer for `eval_result` (`src/view.ts`)

Currently `eval_result` uses `.setText()` — plain text, no markdown. Switch to `MarkdownRenderer.render()`:

```ts
// BEFORE:
const el = this.stepsEl.createEl("div", { cls: "ai-wiki-eval-result" });
el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);

// AFTER:
const el = this.stepsEl.createEl("div", { cls: "ai-wiki-eval-result" });
const text = `**[eval: ${ev.score}/10]** ${ev.reasoning}`;
const comp = new Component();
void MarkdownRenderer.render(this.app, text, el, "", comp);
```

---

## Files changed

| File | Change |
|---|---|
| `src/settings.ts` | Remove Lint UI section (~14 lines) |
| `src/view.ts` | Add `updateButtonAvailability()`, update lint button handler, register `file-open` listener |
| `src/modals.ts` | Refactor `LintOptionsModal`: new constructor, reorder UI, add select-all/deselect-all, article counts |
| `src/view.ts` (eval_result) | Switch `eval_result` rendering from `.setText()` to `MarkdownRenderer.render()` |
| `src/styles.css` | Add `user-select: text` to `.ai-wiki-final`, `.ai-wiki-chat-msg`, `.ai-wiki-eval-result` |

## Out of scope

- Styling of article count span — use existing `muted` class or `ai-wiki-*` CSS
