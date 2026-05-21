# Design: Manage Sources Button + Init Rename

**Date:** 2026-05-21  
**Status:** Approved

---

## Summary

Add a "Manage Sources" button (`⊕`) to the domain row in the sidebar, left of the existing reinit (`↻`) button. The button opens a modal for adding/removing source paths for the selected domain. After saving, it optionally cleans up wiki articles from removed sources and launches ingest for added sources.

Rename the "Init new domain" button to just "Init" (all 3 locales).

---

## Scope

**In scope:**
- New `ManageSourcesModal` in `modals.ts`
- New `addSourceBtn` in `LlmWikiView.buildDomainRow`
- New `controller.cleanupRemovedSources()` method
- New `IngestScopeModal` (3-button confirm) in `modals.ts`
- i18n updates (en/ru/es): rename `view.init`, add modal strings
- `view.ts`: manage `addSourceBtn` disabled state in `setRunning`/`finish`

**Out of scope:**
- Mobile (already hidden — `!isMobile` gate in `buildDomainRow`)
- Rename of wiki pages when source path changes

---

## Architecture

### 1. UI Changes — `view.ts`

**`buildDomainRow` (`withActions: true` branch):**

Add `addSourceBtn` field to `LlmWikiView`:
```typescript
private addSourceBtn?: HTMLButtonElement;
```

Insert button between refresh and reinit:
```
[Domain: dropdown] [↻ refresh] [⊕ add-source] [↺ reinit]
```

```typescript
this.addSourceBtn = domainRow.createEl("button", { attr: { title: T.view.addSourceTitle } });
setIcon(this.addSourceBtn, "folder-plus");
this.addSourceBtn.disabled = true;
this.addSourceBtn.addEventListener("click", () => void this.openManageSources());
```

Disable state mirrors `reinitBtn` — both gated on `this.domainSelect!.value`.

Update `domainSelect.addEventListener("change")` to also update `addSourceBtn.disabled`.

Update `setRunning()`: `if (this.addSourceBtn) this.addSourceBtn.disabled = true;`

Update `finish()`: `if (this.addSourceBtn) this.addSourceBtn.disabled = !(this.domainSelect && this.domainSelect.value);`

**Rename init button:**  
`view.init` string in all 3 locales: `"Init new domain"` / `"Init — новый домен"` / `"Init — nuevo dominio"` → `"Init"`.

### 2. `openManageSources()` — `view.ts`

```typescript
private async openManageSources(): Promise<void> {
  const domainId = this.domainSelect!.value;
  if (!domainId) return;
  const domains = await this.plugin.controller.loadDomains();
  const entry = domains.find(d => d.id === domainId);
  if (!entry) return;
  new ManageSourcesModal(this.app, entry, (result) => {
    void this.handleManageSourcesResult(entry, result);
  }).open();
}
```

```typescript
private async handleManageSourcesResult(
  original: DomainEntry,
  result: { sourcePaths: string[] }
): Promise<void> {
  const oldPaths = original.source_paths ?? [];
  const newPaths = result.sourcePaths;
  const added = newPaths.filter(p => !oldPaths.includes(p));
  const removed = oldPaths.filter(p => !newPaths.includes(p));

  // 1. Save updated source_paths to domain store
  await this.plugin.controller.updateDomainSources(original.id, newPaths);

  // 2. Cleanup orphan wiki articles from removed sources
  if (removed.length > 0) {
    const deleted = await this.plugin.controller.cleanupRemovedSources(original.id, removed);
    if (deleted > 0) new Notice(`Удалено статей: ${deleted}`);
  }

  // 3. If new sources added — prompt ingest scope
  if (added.length > 0) {
    new IngestScopeModal(this.app, added.length, newPaths.length, (scope) => {
      const paths = scope === "new" ? added : newPaths;
      void this.plugin.controller.init(original.id, false, paths);
    }).open();
  }
}
```

### 3. `ManageSourcesModal` — `modals.ts`

```typescript
export class ManageSourcesModal extends Modal {
  private sourcePathsList: string[];

  constructor(
    app: App,
    private domain: DomainEntry,
    private onSave: (result: { sourcePaths: string[] }) => void,
  ) {
    super(app);
    this.sourcePathsList = [...(domain.source_paths ?? [])];
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.manageSourcesTitle(this.domain.id) });

    const container = contentEl.createDiv();
    this.renderSourcePaths(container);  // same UI as EditDomainModal.renderSourcePaths

    new Setting(contentEl)
      .addButton(b => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton(b => b.setButtonText(T.save).setCta().onClick(() => {
        this.close();
        this.onSave({ sourcePaths: this.sourcePathsList.filter(Boolean) });
      }));
  }

  private renderSourcePaths(container: HTMLElement): void {
    // Identical to EditDomainModal.renderSourcePaths — uses FolderInputSuggest
  }

  onClose(): void { this.contentEl.empty(); }
}
```

### 4. `IngestScopeModal` — `modals.ts`

3-button modal (cannot use existing `ConfirmModal` which has 2 buttons):

```typescript
export class IngestScopeModal extends Modal {
  constructor(
    app: App,
    private addedCount: number,
    private totalCount: number,
    private onChoice: (scope: "new" | "all" | "skip") => void,
  ) { super(app); }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.ingestScopeTitle });
    contentEl.createEl("p", { text: T.ingestScopeBody(this.addedCount, this.totalCount) });
    new Setting(contentEl)
      .addButton(b => b.setButtonText(T.ingestScopeNew(this.addedCount)).setCta().onClick(() => {
        this.close(); this.onChoice("new");
      }))
      .addButton(b => b.setButtonText(T.ingestScopeAll(this.totalCount)).onClick(() => {
        this.close(); this.onChoice("all");
      }))
      .addButton(b => b.setButtonText(T.ingestScopeSkip).onClick(() => {
        this.close(); this.onChoice("skip");
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}
```

### 5. New Controller Methods — `controller.ts`

**`updateDomainSources(domainId, sourcePaths)`** — saves updated source_paths to domain store:
```typescript
async updateDomainSources(domainId: string, sourcePaths: string[]): Promise<void> {
  const domains = await this.domainStore.load();
  const next = domains.map(d => d.id === domainId ? { ...d, source_paths: sourcePaths } : d);
  await this.domainStore.save(next);
}
```

**`cleanupRemovedSources(domainId, removedPaths)`** — deletes orphan wiki articles:
```typescript
async cleanupRemovedSources(domainId: string, removedPaths: string[]): Promise<number> {
  const domains = await this.domainStore.load();
  const entry = domains.find(d => d.id === domainId);
  if (!entry) return 0;

  const wikiFolder = domainWikiFolder(entry.wiki_folder);
  const vault = this.app.vault;
  const files = collectMdInPaths(vault, [wikiFolder]);  // imported from view.ts (extract to shared)
  
  let deleted = 0;
  for (const file of files) {
    const content = await vault.adapter.read(file.path);
    const sources = parseWikiSources(content);  // parses wiki_sources frontmatter
    if (sources.length > 0 && sources.every(s => removedPaths.some(r => s.includes(r) || r.includes(s)))) {
      await vault.adapter.remove(file.path);
      deleted++;
    }
  }
  if (deleted > 0) graphCache.invalidate(domainId);
  return deleted;
}
```

`parseWikiSources(content)` — extracts `wiki_sources` YAML list from frontmatter (regex, same pattern used in `controller.ts:107`).

**Note:** `collectMdInPaths` and `walkFolder` must be extracted from `view.ts` to a shared utility file (e.g., `src/utils/vault-walk.ts`) since `controller.ts` cannot import from `view.ts` (circular dep risk).

### 6. i18n — `i18n.ts`

New strings (en/ru/es):

```typescript
// view
addSourceTitle: "Manage sources for domain",

// modal
manageSourcesTitle: (id: string) => `Sources: «${id}»`,
ingestScopeTitle: "Sources saved — run ingest?",
ingestScopeBody: (added: number, total: number) => `Added ${added} new path(s). Ingest new only or all ${total} path(s)?`,
ingestScopeNew: (n: number) => `New only (${n})`,
ingestScopeAll: (n: number) => `All (${n})`,
ingestScopeSkip: "Skip",
```

Rename `view.init`: `"Init"` (was `"Init new domain"` / `"Init — новый домен"` / `"Init — nuevo dominio"`).

---

## Data Flow

```
User clicks [⊕]
  → openManageSources() loads DomainEntry
  → ManageSourcesModal opens with current source_paths
  → User edits list, clicks Save
  → handleManageSourcesResult():
      1. updateDomainSources() → saves to domain store
      2. cleanupRemovedSources() → deletes orphan wiki articles (if removed)
      3. IngestScopeModal → user picks "new / all / skip"
      4. controller.init(domainId, false, chosenPaths)
```

---

## Error Handling

- `cleanupRemovedSources` catches per-file errors (logs, continues)
- `updateDomainSources` surfaces `DomainCorruptError` via existing pattern
- `IngestScopeModal` "Skip" option — no ingest, no notice

---

## Testing

- `ManageSourcesModal` visual test: open with domain having 2 sources, remove one, add one, save → verify callback args
- `cleanupRemovedSources`: mock vault files with `wiki_sources` frontmatter → verify orphans deleted, cross-ref articles kept
- `updateDomainSources`: verify domain store updated correctly
- `IngestScopeModal`: verify "new" and "all" choices pass correct paths to `controller.init`
- `addSourceBtn` disabled state: verify follows `domainSelect.value` and `setRunning`/`finish` lifecycle

---

## Files Changed

| File | Change |
|------|--------|
| `src/view.ts` | Add `addSourceBtn`, `openManageSources`, `handleManageSourcesResult` |
| `src/modals.ts` | Add `ManageSourcesModal`, `IngestScopeModal` |
| `src/controller.ts` | Add `updateDomainSources`, `cleanupRemovedSources` |
| `src/i18n.ts` | Rename `view.init`, add 6 new strings × 3 locales |
| `src/utils/vault-walk.ts` | Extract `collectMdInPaths` + `walkFolder` from `view.ts` |
| `src/view.ts` | Update import to use `vault-walk.ts` |
