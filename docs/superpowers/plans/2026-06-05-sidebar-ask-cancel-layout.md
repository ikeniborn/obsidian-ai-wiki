# Sidebar Ask/Cancel Button Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition sidebar buttons so cancel sits on the far left and ask on the far right, separated by flex space.

**Architecture:** Two surgical changes — swap DOM creation order in `src/view.ts` so cancel precedes ask, then replace flex gap/wrap with `justify-content: space-between` in `src/styles.css`.

**Tech Stack:** TypeScript (Obsidian plugin), CSS

---

### Task 1: Swap button DOM order in view.ts

**Files:**
- Modify: `src/view.ts:179-180`

- [ ] **Step 1: Edit `src/view.ts` lines 179-180 — create cancelBtn before askBtn**

Replace:
```ts
    this.askBtn = askRow.createEl("button", { text: T.view.ask });
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
```
With:
```ts
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
    this.askBtn = askRow.createEl("button", { text: T.view.ask });
```

Lines 181-183 (`cancelBtn.disabled`, event listeners) are unchanged — just the creation order swaps.

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -5
```
Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): swap ask/cancel button DOM order — cancel left, ask right"
```

---

### Task 2: Update CSS layout rule

**Files:**
- Modify: `src/styles.css:27`

- [ ] **Step 1: Edit `src/styles.css` line 27 — replace gap/wrap with space-between**

Replace:
```css
.ai-wiki-ask-row { display: flex; gap: 6px; flex-wrap: wrap; }
```
With:
```css
.ai-wiki-ask-row { display: flex; justify-content: space-between; }
```

Line 28 (`.ai-wiki-ask-row button { flex: 0 0 auto; }`) is unchanged.

- [ ] **Step 2: Run build to verify**

```bash
npm run build 2>&1 | tail -5
```
Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "fix(styles): ask-row space-between layout, remove flex-wrap"
```

---

### Task 3: Visual verification

**Files:** none (manual check)

- [ ] **Step 1: Load plugin in Obsidian dev vault, open sidebar**

Verify layout: `[cancel]───────────────────[ask]` — cancel flush left, ask flush right, one line, no wrap.

- [ ] **Step 2: Run tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 3: Update lat.md if needed**

Check if `lat.md/architecture.md` section `Sidebar View` references button order or layout — update if it describes the old arrangement.

```bash
lat check
```
Expected: no errors.
