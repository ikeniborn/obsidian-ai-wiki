# Fix: folder suggest in domain modals

**Date:** 2026-05-14  
**Status:** approved

## Problem

Substring search for vault folders stopped working in `sourcePaths` input of `AddDomainModal` and `EditDomainModal`. The custom `attachFolderDropdown` function appends a `<div>` to `activeDocument.body` with `position: fixed; z-index: 1000`, which may be hidden behind Obsidian's modal overlay or mispositioned.

## Solution

Replace custom `attachFolderDropdown` with a `FolderInputSuggest` class that extends Obsidian's `AbstractInputSuggest<TFolder>`. Obsidian handles z-index, positioning, and keyboard navigation internally.

## Architecture

### New class: `FolderInputSuggest` (in `modals.ts`)

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

### Removed: `attachFolderDropdown` (modals.ts:128–167)

Entire function deleted. Both call sites replaced:

| File | Line | Old | New |
|------|------|-----|-----|
| `modals.ts` | ~260 | `attachFolderDropdown(this.app, inputEl, addPath)` | `new FolderInputSuggest(this.app, inputEl, addPath)` |
| `modals.ts` | ~467 | `attachFolderDropdown(this.app, input, addPath)` | `new FolderInputSuggest(this.app, input, addPath)` |

### Removed: CSS (styles.css:212–230)

`.ai-wiki-folder-dropdown` and `.ai-wiki-folder-dropdown-item` blocks deleted — no longer used.

### Import change

Add `AbstractInputSuggest` to the obsidian import in `modals.ts`. Remove `activeDocument` if no longer used elsewhere.

## Scope

- Only `sourcePaths` input in `AddDomainModal` and `EditDomainModal`
- `wikiFolder` field: not changed
- Tests: none added (no DOM environment in test suite)

## Change summary

~20 lines added, ~55 lines deleted (net negative).
