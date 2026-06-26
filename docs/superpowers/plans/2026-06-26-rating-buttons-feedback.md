---
review:
  plan_hash: 432afd93538c4884
  spec_hash: d0e5bc69dacb3f5e
  last_run: 2026-06-26
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-26-rating-buttons-feedback-design.md
---

# Dev-mode Rating Buttons Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev-mode 👍/👎 rating buttons in the sidebar give visible selected-state feedback and persist the rating reliably to `eval.jsonl`.

**Architecture:** Two coupled changes. (A) Add CSS for the rating buttons so the `is-active` selected state is visible (green 👍 / red 👎 fill, dimmed unselected). (B) Replace the optimistic UI-only `is-active` toggle with a write-then-render flow: `updateEvalRating` returns the persisted `Rating`, `rateRun` forwards it, and `renderRatingRow` renders `is-active` from the value actually written — so the UI can never diverge from the file.

**Tech Stack:** TypeScript (strict), Obsidian plugin API, esbuild, ESLint. No unit-test runner in this repo — the per-task automated gate is `npx tsc --noEmit` + `npm run lint` + `npm run build`; UI behavior is verified manually in Obsidian (final task).

## Global Constraints

- Language: code comments in English; this is an Obsidian plugin loaded from `dist/`.
- No new i18n strings — reuse existing `ratingUp/ratingDown/ratingAnswer/ratingFormatting/ratingRecognition` (`src/i18n.ts`).
- Theme-safe colors only — use Obsidian CSS variables (`--color-green`, `--color-red`, `--text-muted`, `--background-secondary`, `--background-modifier-border`). No hardcoded hex.
- The build does NOT copy into the vault. Deploy target: `/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/` (`main.js`, `styles.css`, `manifest.json`), then reload the plugin in Obsidian.
- Branch: `dev-fix-rating-buttons` (already created from `master`, in-place).

---

### Task 1: Rating button CSS

**Files:**
- Modify: `src/styles.css` (append at end, currently 362 lines)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes targeted by Task 2 — `.ai-wiki-rating-row`, `.ai-wiki-rating-label`, `.ai-wiki-rating-btn`, modifiers `.is-up` / `.is-down`, selected state `.is-active`. Safe no-op until Task 2 adds `is-up`/`is-down` to the buttons.

- [ ] **Step 1: Append the rating CSS to `src/styles.css`**

Add these rules at the end of the file:

```css

/* Dev-mode rating buttons (👍/👎) */
.ai-wiki-rating-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.ai-wiki-rating-label { color: var(--text-muted); font-size: 0.85em; }
.ai-wiki-rating-btn {
  cursor: pointer;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-secondary);
  padding: 2px 8px;
  font-size: 1em;
  line-height: 1.4;
  opacity: 0.5;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
.ai-wiki-rating-btn:hover { opacity: 0.85; }
.ai-wiki-rating-btn.is-active { opacity: 1; }
.ai-wiki-rating-btn.is-up.is-active {
  background: color-mix(in srgb, var(--color-green) 25%, var(--background-secondary));
  border-color: var(--color-green);
}
.ai-wiki-rating-btn.is-down.is-active {
  background: color-mix(in srgb, var(--color-red) 25%, var(--background-secondary));
  border-color: var(--color-red);
}
```

- [ ] **Step 2: Verify the build copies the CSS**

Run: `npm run build`
Expected: console prints `dist/ updated: main.js, manifest.json, styles.css; root manifest.json synced`, exit 0. Confirm the new rules are present:

Run: `grep -c 'ai-wiki-rating-btn' dist/styles.css`
Expected: `4` (or higher — non-zero confirms the copy happened).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css dist/styles.css dist/main.js dist/manifest.json manifest.json
git commit -m "feat(styles): add dev-mode rating button selected-state CSS"
```

---

### Task 2: Write-then-render persistence + is-up/is-down classes

**Files:**
- Modify: `src/eval-log.ts` (`updateEvalRating`, lines 76-101)
- Modify: `src/controller.ts` (`rateRun`, lines 195-198; import line 30)
- Modify: `src/view.ts` (`renderRatingRow`, lines 822-844)

**Interfaces:**
- Consumes: CSS classes from Task 1 (`is-up`, `is-down`, `is-active`).
- Produces:
  - `updateEvalRating(...) => Promise<Rating | undefined>` — the persisted value (`"up" | "down" | null`), or `undefined` when the file/record is missing or a write throws.
  - `Controller.rateRun(runId, axis, rating) => Promise<Rating | undefined>` — forwards the above (or `undefined` when dev mode is off).
  - `renderRatingRow` buttons carry `is-up`/`is-down`; click handler sets `is-active` from the returned value.

- [ ] **Step 1: Make `updateEvalRating` return the persisted `Rating`**

In `src/eval-log.ts`, replace the whole `updateEvalRating` function (lines 76-101) with:

```ts
/**
 * Update one record's rating in place, matched by runId. Re-clicking flips the
 * value (a second identical click clears it back to null). No duplicate rows.
 * Returns the resulting Rating, or undefined when no record matched / the write
 * failed (so the caller can avoid showing a state that was not persisted).
 */
export async function updateEvalRating(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
  axis: RatingAxis,
  rating: "up" | "down",
): Promise<Rating | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      const field = axis === "recognition" ? "recognitionRating" : "rating";
      const next: Rating = rec[field] === rating ? null : rating; // flip / toggle off
      rec[field] = next;
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return next;
    }
    return undefined; // no record matched runId
  } catch { return undefined; /* never block the UI */ }
}
```

- [ ] **Step 2: Forward the value through `rateRun`**

In `src/controller.ts`, line 30, add the `Rating` type to the import:

```ts
import { updateEvalRating, type RatingAxis, type Rating } from "./eval-log";
```

Then replace `rateRun` (lines 195-198) with:

```ts
  /** Set a 👍/👎 label on a finished run's eval.jsonl record (dev mode only). Returns the persisted rating, or undefined when off / not written. */
  async rateRun(runId: string, axis: RatingAxis, rating: "up" | "down"): Promise<Rating | undefined> {
    if (!this.plugin.settings.devMode?.enabled) return undefined;
    return updateEvalRating(this.app.vault.adapter, this.pluginDir(), runId, axis, rating);
  }
```

- [ ] **Step 3: Render `is-active` from the persisted value in `renderRatingRow`**

In `src/view.ts`, replace `renderRatingRow` (lines 822-844) with:

```ts
  private renderRatingRow(
    parent: HTMLElement,
    runId: string,
    axis: import("./eval-log").RatingAxis,
    label: string,
  ): void {
    if (!this.plugin.settings.devMode?.enabled) return;
    const T = i18n();
    const row = parent.createDiv("ai-wiki-rating-row");
    row.createSpan({ text: label, cls: "ai-wiki-rating-label" });
    const up = row.createEl("button", { text: "👍", cls: "ai-wiki-rating-btn is-up", attr: { "aria-label": T.view.ratingUp } });
    const down = row.createEl("button", { text: "👎", cls: "ai-wiki-rating-btn is-down", attr: { "aria-label": T.view.ratingDown } });
    const render = (rating: "up" | "down" | null) => {
      up.toggleClass("is-active", rating === "up");
      down.toggleClass("is-active", rating === "down");
    };
    const handle = (rating: "up" | "down") => async () => {
      const result = await this.plugin.controller.rateRun(runId, axis, rating);
      if (result !== undefined) render(result); // reflect what was actually persisted
    };
    up.addEventListener("click", () => void handle("up")());
    down.addEventListener("click", () => void handle("down")());
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors. (Catches a missing `Rating` import or signature mismatch.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0, no errors for `src/eval-log.ts`, `src/controller.ts`, `src/view.ts`.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: exit 0, prints the `dist/ updated: ...` line.

- [ ] **Step 7: Commit**

```bash
git add src/eval-log.ts src/controller.ts src/view.ts dist/main.js dist/styles.css dist/manifest.json manifest.json
git commit -m "fix(view): reflect persisted rating in 👍/👎 buttons; updateEvalRating returns Rating"
```

---

### Task 3: Deploy to vault and verify manually

**Files:**
- No source changes. Copies build artifacts into the Work vault.

**Interfaces:**
- Consumes: built `dist/main.js`, `dist/styles.css`, `dist/manifest.json` from Tasks 1–2.
- Produces: a verified, working feature (SC1–SC4 from the spec).

- [ ] **Step 1: Deploy the build to the vault plugin dir**

Run:

```bash
cp dist/main.js dist/styles.css dist/manifest.json \
  "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/"
```

Expected: exit 0. Confirm the CSS landed:

Run: `grep -c 'ai-wiki-rating-btn' "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/styles.css"`
Expected: non-zero (4+).

- [ ] **Step 2: Reload the plugin in Obsidian**

Manual: in Obsidian, toggle the AI Wiki plugin off then on (Settings → Community plugins), or reload the app. This is required for the new `main.js`/`styles.css` to load. Ensure dev mode is enabled in the plugin settings.

- [ ] **Step 3: Verify SC1–SC3 (visual feedback + reselection)**

Manual, in the AI Wiki sidebar:
1. Run a `query` and wait for the result. The 👍/👎 row appears (`Оцените ответ:`).
2. Click 👍 → button shows a green fill (full opacity); 👎 stays dimmed. **(SC1)**
3. Click 👎 → 👎 shows a red fill; 👍 returns to dimmed. **(SC2)**
4. Click 👎 again → both dimmed (selection cleared). **(SC3)**

- [ ] **Step 4: Verify SC4 (persistence)**

After each click in Step 3, inspect the record. Replace `<runId>` with the run's id (shown in history / it is the latest record):

Run:
```bash
tail -1 "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/eval.jsonl" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print("rating=",r.get("rating"))'
```
Expected progression across the three clicks: `up` → `down` → `None`. **(SC4)**

- [ ] **Step 5: Final commit (if any deploy notes / no code change)**

No code change in this task. If Steps 1–4 pass, the feature is done; nothing to commit. If a defect was found, return to Task 1 or 2.

---

## Notes for the implementer

- `color-mix(in srgb, ...)` is supported by Obsidian's Chromium runtime; no fallback needed.
- `toggleClass(cls, boolean)` and `createEl/createDiv/createSpan` are Obsidian's `HTMLElement` extensions (already used throughout `view.ts`).
- The recognition axis (`recognitionRating`) reuses the same `renderRatingRow`, so it gets the same fix for free.
- Re-clicking the active button returns `null` from `rateRun`; `render(null)` clears both buttons — this is the "changed my mind / deselect" path and is the visible counterpart of the existing flip in `updateEvalRating`.
