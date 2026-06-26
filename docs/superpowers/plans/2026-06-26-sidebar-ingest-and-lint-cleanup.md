---
review:
  plan_hash: 05ba29e1390514e6
  spec_hash: 13c8a1b679a0f267
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
  spec: docs/superpowers/specs/2026-06-26-sidebar-ingest-and-lint-cleanup-design.md
result_check:
  verdict: OK
  plan_hash: 05ba29e1390514e6
  last_run: 2026-06-26
---

# Sidebar Ingest Gating & Lint Empty-Type Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable the sidebar Ingest button on wiki articles, default empty entity types OFF in the Lint modal, and have lint delete empty entity types (folder + config) so they stop reappearing.

**Architecture:** Three small surgical edits plus one helper. UI gating in `view.ts` (R1); modal default selection in `modals.ts` (R2a); a deterministic post-step in `runLint` (`phases/lint.ts`) that counts files per entity-type subfolder, deletes empty folders via a new `vaultTools.rmdir` wrapper (S1), and emits a `domain_updated` event so the controller strips the type from the domain config (R2b).

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, eslint.

**Testing note:** This project has **no functional test suite** (vitest/pytest were intentionally removed — do not re-add). Verification gates are: `npx tsc --noEmit` (real type check — neither lint nor build type-checks), `npm run lint` (eslint), `npm run build` (esbuild), and manual verification in Obsidian (final task). Source-only tasks commit without `dist/`; `dist/main.js` is regenerated and committed once in the final task.

**Spec:** `docs/superpowers/specs/2026-06-26-sidebar-ingest-and-lint-cleanup-design.md`

---

### Task 1: Add `rmdir` wrapper to VaultTools (S1)

Foundation for Task 4. The adapter already exposes `rmdir`; `VaultTools` only wraps `remove` (files) and `removeSubfolders` (children), so add a wrapper to remove one specific folder.

**Files:**
- Modify: `src/vault-tools.ts` (after the `async remove` method, ~line 219-221)

- [ ] **Step 1: Add the wrapper method**

Locate the existing `remove` method:

```ts
  async remove(vaultPath: string): Promise<void> {
    await this.adapter.remove?.(vaultPath);
  }
```

Add immediately after it:

```ts
  async rmdir(vaultPath: string, recursive: boolean): Promise<void> {
    await this.adapter.rmdir?.(vaultPath, recursive);
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/vault-tools.ts
git commit -m "feat(vault-tools): add rmdir wrapper for removing a specific folder"
```

---

### Task 2: Gate the Ingest button on wiki articles (R1)

**Files:**
- Modify: `src/view.ts`, `updateButtonAvailability()` (~line 404-419)

`isWikiArticlePath` is already imported (`src/view.ts:9`).

- [ ] **Step 1: Edit `updateButtonAvailability`**

Current code:

```ts
  private updateButtonAvailability(): void {
    const hasDomain = !!(this.domainSelect?.value);
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const domain = this.domains.find((d) => d.id === this.domainSelect?.value);
    const isSource = !!activeFile && !!domain && isSourceFile(activeFile.path, domain);
    const canFormat = !!activeFile && activeFile.extension === "md"
      && !isWikiArticlePath(activeFile.path);

    if (this.askBtn)       this.askBtn.disabled       = !hasDomain;
    if (this.ingestBtn)    this.ingestBtn.disabled    = !hasDomain;
    if (this.lintBtn)      this.lintBtn.disabled      = !hasDomain;
```

Replace it with (adds `onWikiArticle` and uses it for the ingest button only):

```ts
  private updateButtonAvailability(): void {
    const hasDomain = !!(this.domainSelect?.value);
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const domain = this.domains.find((d) => d.id === this.domainSelect?.value);
    const isSource = !!activeFile && !!domain && isSourceFile(activeFile.path, domain);
    const onWikiArticle = !!activeFile && isWikiArticlePath(activeFile.path);
    const canFormat = !!activeFile && activeFile.extension === "md"
      && !isWikiArticlePath(activeFile.path);

    if (this.askBtn)       this.askBtn.disabled       = !hasDomain;
    if (this.ingestBtn)    this.ingestBtn.disabled    = !hasDomain || onWikiArticle;
    if (this.lintBtn)      this.lintBtn.disabled      = !hasDomain;
```

(The remaining lines of the method — `formatBtn`, `deleteBtn`, `reinitBtn`, `addSourceBtn` — are unchanged.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (no unused variable — `onWikiArticle` is consumed by the ingest line).

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): disable Ingest button on wiki articles"
```

---

### Task 3: Default empty entity types OFF in the Lint modal (R2a)

**Files:**
- Modify: `src/modals.ts`, `LintOptionsModal` constructor (~line 799-802)

- [ ] **Step 1: Edit the constructor's filter initialization**

Current code:

```ts
    super(app);
    this.useLlm = defaultUseLlm;
    this.entityTypeFilter = (domain.entity_types ?? []).map(e => e.type);
```

Replace the last line so only types with a non-zero article count start selected (`articleCounts` is the constructor parameter already in scope):

```ts
    super(app);
    this.useLlm = defaultUseLlm;
    this.entityTypeFilter = (domain.entity_types ?? [])
      .filter(e => (articleCounts.get(e.type) ?? 0) > 0)
      .map(e => e.type);
```

No other change is needed: the per-type toggle already renders from `this.entityTypeFilter.includes(et.type)` (`src/modals.ts:844`), and the "Add all" button still sets the filter to every type (`src/modals.ts:829-832`).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): default empty entity types to OFF in Lint modal"
```

---

### Task 4: Strip empty entity types after lint (R2b)

A deterministic post-step in `runLint` that runs in **both** `useLlm` modes, after the LLM block and the actualize step, using the final `pages` map. Requires `vaultTools.rmdir` from Task 1.

**Files:**
- Modify: `src/phases/lint.ts` — three edits inside the `for (const domain of targets)` loop. `EntityType` is already imported (`src/phases/lint.ts:3`).

- [ ] **Step 1: Declare the effective-types variable before the `if (useLlm)` block**

Current code (~line 284-288):

```ts
    const deletedRefs: { deletedName: string; redirectName: string | null }[] = [];
    const writtenPaths: string[] = [];
    const skippedArticles: string[] = [];

    if (useLlm) {
```

Replace with (adds one line):

```ts
    const deletedRefs: { deletedName: string; redirectName: string | null }[] = [];
    const writtenPaths: string[] = [];
    const skippedArticles: string[] = [];
    let effectiveEntityTypes: EntityType[] = domain.entity_types ?? [];

    if (useLlm) {
```

- [ ] **Step 2: Capture the actualize patch's entity types**

Current code (~line 495-501) inside the `if (useLlm)` block:

```ts
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }

    if (signal.aborted) return;
```

Replace with (adds the capture after the existing `if (patch)` block):

```ts
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }
    if (patch?.entity_types) effectiveEntityTypes = patch.entity_types;

    if (signal.aborted) return;
```

- [ ] **Step 3: Insert the empty-type cleanup after the `if (useLlm)` block**

Current code (~line 502-505):

```ts
    if (signal.aborted) return;
    } // end if (useLlm)

    // Bucket repair: remove wrong-bucket stems from wiki_sources / wiki_outgoing_links
```

Replace with (inserts the cleanup block between the `} // end if (useLlm)` line and the bucket-repair comment):

```ts
    if (signal.aborted) return;
    } // end if (useLlm)

    // Empty-type cleanup (deterministic, runs in both LLM modes): an entity type whose
    // wiki subfolder holds zero article files is removed — its folder is deleted and the
    // type is stripped from the domain config so it no longer appears in the lint modal.
    const survivingTypes: EntityType[] = [];
    const removedTypes: EntityType[] = [];
    for (const et of effectiveEntityTypes) {
      const sub = et.wiki_subfolder;
      const count = sub
        ? [...pages.keys()].filter((p) => p.startsWith(`${wikiVaultPath}/${sub}/`)).length
        : 0;
      if (count > 0) { survivingTypes.push(et); continue; }
      removedTypes.push(et);
      if (sub) {
        try { await vaultTools.rmdir(`${wikiVaultPath}/${sub}`, true); } catch { /* folder already gone */ }
      }
    }
    if (removedTypes.length > 0) {
      yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: survivingTypes } };
      reportParts.push(`Removed empty entity types: ${removedTypes.map((e) => e.type).join(", ")}`);
      yield {
        kind: "info_text",
        icon: "🗑️",
        summary: `Removed ${removedTypes.length} empty entity type(s): ${removedTypes.map((e) => e.type).join(", ")}`,
      };
    }

    // Bucket repair: remove wrong-bucket stems from wiki_sources / wiki_outgoing_links
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `effectiveEntityTypes`, `vaultTools.rmdir`, and the `domain_updated` patch shape `{ entity_types }` all type-check.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): delete empty entity types (folder + config) after lint"
```

---

### Task 5: Build, regenerate dist, and verify in Obsidian

**Files:**
- Modify (generated): `dist/main.js`

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds, `dist/main.js` regenerated.

- [ ] **Step 2: Manual verification in Obsidian**

Load the plugin (point an Obsidian test vault at this repo's `dist/`, or copy `dist/main.js` + `manifest.json` into `<vault>/.obsidian/plugins/ai-wiki/`), then verify:

- **R1 (Ingest gating):**
  - Open a file under `!Wiki/...` with a domain selected → Ingest button is **disabled**.
  - Open a source `.md` file (outside `!Wiki`) with a domain selected → Ingest button is **enabled**.
  - Deselect the domain → Ingest button is **disabled**.
- **R2a (modal defaults):** With a domain that has an entity type showing `(0)`, open the Lint modal → that type's toggle is **OFF**; types with count `> 0` are **ON**.
- **R2b (empty-type cleanup):** With a domain that has at least one empty type (count `0`), run Lint (either LLM on or off):
  - The empty type's subfolder under `!Wiki/<wiki_folder>/` is deleted.
  - The type is removed from the domain config (reopen the Lint modal — it no longer lists that type).
  - Non-empty types and their counts are intact.

- [ ] **Step 3: Commit the build**

```bash
git add dist/main.js
git commit -m "chore(build): rebuild dist for sidebar ingest gating & lint empty-type cleanup"
```

---

## Self-Review

**Spec coverage:**
- R1 (Ingest gating) → Task 2. ✓
- R2a (modal default toggles) → Task 3. ✓
- R2b (empty-type cleanup) → Task 4 (depends on Task 1). ✓
- S1 (`vaultTools.rmdir`) → Task 1. ✓
- Verification gates (tsc/eslint/build) → every task; manual Obsidian checks → Task 5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code.

**Type consistency:** `effectiveEntityTypes`, `survivingTypes`, `removedTypes` typed `EntityType[]`; `vaultTools.rmdir(path: string, recursive: boolean)` matches Task 1's signature; `domain_updated` patch `{ entity_types }` matches `RunEvent` (`src/types.ts:67`) and `applyDomainEvent` (`src/domain.ts:95`, replaces the array).
