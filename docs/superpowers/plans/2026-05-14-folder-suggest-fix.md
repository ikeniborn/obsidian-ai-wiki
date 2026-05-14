# Folder Suggest Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken custom `attachFolderDropdown` with Obsidian-native `AbstractInputSuggest` so vault folder search works in `sourcePaths` inputs of domain modals.

**Architecture:** Delete `attachFolderDropdown` (~40 lines) and its CSS (~19 lines). Add `FolderInputSuggest` class (~15 lines) extending `AbstractInputSuggest<TFolder>`. Replace 2 call sites. No tests — no DOM environment in test suite.

**Tech Stack:** TypeScript, Obsidian Plugin API (`AbstractInputSuggest` since 1.4.10), esbuild

---

### Task 1: Replace import line and add FolderInputSuggest class

**Files:**
- Modify: `src/modals.ts:1` (import line)
- Modify: `src/modals.ts:128-167` (replace `attachFolderDropdown` with new class)

- [ ] **Step 1: Update the import line**

Replace line 1 of `src/modals.ts`:

```typescript
// old:
import { App, Modal, Setting, TFolder, activeDocument } from "obsidian";
// new:
import { AbstractInputSuggest, App, Modal, Setting, TFolder } from "obsidian";
```

- [ ] **Step 2: Replace `attachFolderDropdown` with `FolderInputSuggest`**

Delete lines 128–167 of `src/modals.ts` (the entire `attachFolderDropdown` function):

```typescript
function attachFolderDropdown(app: App, inputEl: HTMLInputElement, onSelect: (path: string) => void): void {
  let dropEl: HTMLElement | null = null;
  ...
  inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") hideDropdown();
  });
}
```

Replace with:

```typescript
class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, input: HTMLInputElement, onPick: (path: string) => void) {
    super(app, input);
    this.onSelect((folder) => {
      this.setValue(folder.path + "/");
      onPick(folder.path + "/");
    });
  }
  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter(f => f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }
  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path + "/");
  }
}
```

- [ ] **Step 3: Replace call site in `AddDomainModal.renderSourcePaths` (~line 260)**

Find (after the deletion above, line numbers shift — search for the string):

```typescript
    attachFolderDropdown(this.app, inputEl, addPath);
```

Replace with:

```typescript
    new FolderInputSuggest(this.app, inputEl, addPath);
```

- [ ] **Step 4: Replace call site in `EditDomainModal.renderSourcePaths` (~line 467)**

Find:

```typescript
    attachFolderDropdown(this.app, input, addPath);
```

Replace with:

```typescript
    new FolderInputSuggest(this.app, input, addPath);
```

---

### Task 2: Remove dead CSS

**Files:**
- Modify: `src/styles.css:212-230`

- [ ] **Step 1: Delete the three CSS blocks (lines 212–230)**

Remove the following from `src/styles.css`:

```css
.ai-wiki-folder-dropdown {
  position: fixed;
  z-index: 1000;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  max-height: 200px;
  overflow-y: auto;
}
.ai-wiki-folder-dropdown-item {
  padding: 5px 10px;
  font-family: var(--font-monospace);
  font-size: 12px;
  cursor: pointer;
}
.ai-wiki-folder-dropdown-item:hover {
  background: var(--background-modifier-hover);
}
```

---

### Task 3: Build, verify, commit

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/manifest.json` (version bump)

- [ ] **Step 1: Bump patch version**

Read current version from `package.json` (currently `0.1.92`), increment to `0.1.93`.

In `package.json`, change:
```json
"version": "0.1.92",
```
to:
```json
"version": "0.1.93",
```

In `src/manifest.json`, change the `"version"` field to `"0.1.93"` as well.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors. If TypeScript errors appear in `modals.ts`, check that `AbstractInputSuggest` is imported and call sites use `new FolderInputSuggest(...)`.

- [ ] **Step 3: Verify no references to deleted symbols remain**

```bash
grep -n "attachFolderDropdown\|activeDocument\|ai-wiki-folder-dropdown" src/modals.ts src/styles.css
```

Expected: no output (all references removed).

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts src/styles.css package.json src/manifest.json
git commit -m "fix(modals): replace attachFolderDropdown with AbstractInputSuggest

Vault folder search in sourcePaths inputs stopped working due to
z-index/positioning issues with custom dropdown. AbstractInputSuggest
handles rendering natively.
"
```
