---
review:
  plan_hash: 4c1e0fe3de2d156b
  spec_hash: 2cc29f507da2037c
  last_run: 2026-06-22
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-22-format-button-domain-design.md
result_check:
  verdict: OK
  plan_hash: 4c1e0fe3de2d156b
  last_run: 2026-06-22
---
# Format Button Activation Decoupled From Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI Wiki **Format** button active for any non-wiki markdown file regardless of domain membership, while keeping the **Delete source** button gated on `isSource`.

**Architecture:** Introduce one pure predicate `isWikiArticlePath(path)` in `src/wiki-path.ts`. Reuse it in `isSourceFile` (de-duplication) and in `view.ts` `updateButtonAvailability()` to compute a dedicated `canFormat` for the format button. The controller (`format()`) remains the final enforcement gate.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild (bundling + out-of-vault headless evals), ESLint.

## Global Constraints

- Branch: `dev/format-button-domain` (already created from `master`). PR targets `master`.
- `src/wiki-path.ts` must stay obsidian-free (pure module) so the headless eval bundles without an obsidian stub.
- Lint clean: `npm run lint` (eslint `src/**/*.ts`) — no new errors in touched files. Remove any import made unused by the change.
- tsc: gate on NEW errors in touched files only (a pre-existing baseline of ~135 unrelated tsc errors exists; do not chase those).
- Behavior of `isSourceFile` must be unchanged (de-dup only) — guarded by `eval/source-deletion/run.ts`.
- `WIKI_ROOT` constant value is `"!Wiki"`; every domain wiki folder is `` `${WIKI_ROOT}/${subfolder}` ``.

---

### Task 1: Add `isWikiArticlePath` helper + headless eval

**Files:**
- Modify: `src/wiki-path.ts` (add one exported function after `domainWikiFolder`, ~line 10)
- Create: `eval/format-button/run.ts`
- Create (build artifact, committed): `eval/format-button/run.cjs`

**Interfaces:**
- Produces: `isWikiArticlePath(path: string): boolean` — `true` iff `path === WIKI_ROOT` or `path` starts with `` `${WIKI_ROOT}/` ``. Consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing eval**

Create `eval/format-button/run.ts`:

```typescript
/**
 * Out-of-vault eval for isWikiArticlePath. Exercises the REAL pure function
 * from src/wiki-path.ts against synthetic paths. No vault, no LLM, no DOM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/format-button/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/format-button/run.cjs
 *   node eval/format-button/run.cjs
 */
import { isWikiArticlePath } from "../../src/wiki-path";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

console.log("\n=== isWikiArticlePath ===");
check("wiki root exactly is wiki", isWikiArticlePath("!Wiki") === true);
check("domain wiki article is wiki", isWikiArticlePath("!Wiki/Alpha/Page.md") === true);
check("wiki config file is wiki", isWikiArticlePath("!Wiki/_config/_index.md") === true);
check("plain source file is not wiki", isWikiArticlePath("Sources/doc.md") === false);
check("note outside wiki is not wiki", isWikiArticlePath("notes/x.md") === false);
check("prefix without slash boundary is not wiki", isWikiArticlePath("!WikiOther/z.md") === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
```

- [ ] **Step 2: Run the eval to verify it fails**

Run:
```bash
node_modules/.bin/esbuild eval/format-button/run.ts --bundle --platform=node --format=cjs --outfile=eval/format-button/run.cjs
```
Expected: esbuild **fails** with an error like `No matching export in "src/wiki-path.ts" for import "isWikiArticlePath"` (the function does not exist yet).

- [ ] **Step 3: Implement the helper**

In `src/wiki-path.ts`, add immediately after the `domainWikiFolder` function (after line 10):

```typescript
/** True if `path` is inside the wiki tree (every domain's wiki lives under WIKI_ROOT). */
export function isWikiArticlePath(path: string): boolean {
  return path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`);
}
```

- [ ] **Step 4: Run the eval to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/format-button/run.ts --bundle --platform=node --format=cjs --outfile=eval/format-button/run.cjs && node eval/format-button/run.cjs
```
Expected: all 6 checks `PASS`, final line `6 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-path.ts eval/format-button/run.ts eval/format-button/run.cjs
git commit -m "feat(wiki-path): add isWikiArticlePath predicate with headless eval"
```

---

### Task 2: De-duplicate `isSourceFile` to reuse the helper

**Files:**
- Modify: `src/source-deletion.ts` (import line 2; `isSourceFile` line 74)

**Interfaces:**
- Consumes: `isWikiArticlePath` from Task 1.
- Produces: no signature change — `isSourceFile(path, domain)` behavior identical.

- [ ] **Step 1: Run the existing eval to capture the green baseline**

Run:
```bash
node_modules/.bin/esbuild eval/source-deletion/run.ts --bundle --platform=node --format=cjs --outfile=eval/source-deletion/run.cjs && node eval/source-deletion/run.cjs
```
Expected: PASS, including `isSourceFile` cases (`wiki page is not a source`, `file under source folder is a source`, etc.). Note the passing count.

- [ ] **Step 2: Swap the import**

In `src/source-deletion.ts`, replace line 2:

```typescript
import { WIKI_ROOT } from "./wiki-path";
```

with:

```typescript
import { isWikiArticlePath } from "./wiki-path";
```

(`WIKI_ROOT` is used only inside `isSourceFile` in this file — line 74 — so it becomes unused after Step 3 and must be dropped to keep lint clean.)

- [ ] **Step 3: Use the helper in `isSourceFile`**

In `src/source-deletion.ts`, replace the first line of the `isSourceFile` body (line 74):

```typescript
  if (path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`)) return false;
```

with:

```typescript
  if (isWikiArticlePath(path)) return false;
```

- [ ] **Step 4: Re-run the eval to verify identical behavior**

Run:
```bash
node_modules/.bin/esbuild eval/source-deletion/run.ts --bundle --platform=node --format=cjs --outfile=eval/source-deletion/run.cjs && node eval/source-deletion/run.cjs
```
Expected: same passing count as Step 1, 0 failures.

- [ ] **Step 5: Lint the touched file**

Run: `npm run lint`
Expected: no new errors for `src/source-deletion.ts` (specifically no `WIKI_ROOT is defined but never used`).

- [ ] **Step 6: Commit**

```bash
git add src/source-deletion.ts eval/source-deletion/run.cjs
git commit -m "refactor(source-deletion): reuse isWikiArticlePath in isSourceFile"
```

---

### Task 3: Decouple the Format button predicate in `view.ts`

**Files:**
- Modify: `src/view.ts` (import line 9; `updateButtonAvailability` lines 403-416)

**Interfaces:**
- Consumes: `isWikiArticlePath` from Task 1.
- Produces: UI behavior — `formatBtn.disabled` driven by `canFormat`; `deleteBtn.disabled` unchanged (`!isSource`).

- [ ] **Step 1: Add the import**

In `src/view.ts`, replace line 9:

```typescript
import { domainWikiFolder, domainLogPath, domainIndexPath } from "./wiki-path";
```

with:

```typescript
import { domainWikiFolder, domainLogPath, domainIndexPath, isWikiArticlePath } from "./wiki-path";
```

- [ ] **Step 2: Compute `canFormat` and rewire the format button**

In `src/view.ts`, replace the body of `updateButtonAvailability` (lines 403-416):

```typescript
  private updateButtonAvailability(): void {
    const hasDomain = !!(this.domainSelect?.value);
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const domain = this.domains.find((d) => d.id === this.domainSelect?.value);
    const isSource = !!activeFile && !!domain && isSourceFile(activeFile.path, domain);

    if (this.askBtn)       this.askBtn.disabled       = !hasDomain;
    if (this.ingestBtn)    this.ingestBtn.disabled    = !hasDomain;
    if (this.lintBtn)      this.lintBtn.disabled      = !hasDomain;
    if (this.formatBtn)    this.formatBtn.disabled    = !isSource;
    if (this.deleteBtn)    this.deleteBtn.disabled    = !isSource;
    if (this.reinitBtn)    this.reinitBtn.disabled    = !hasDomain;
    if (this.addSourceBtn) this.addSourceBtn.disabled = !hasDomain;
  }
```

with:

```typescript
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
    if (this.formatBtn)    this.formatBtn.disabled    = !canFormat;
    if (this.deleteBtn)    this.deleteBtn.disabled    = !isSource;
    if (this.reinitBtn)    this.reinitBtn.disabled    = !hasDomain;
    if (this.addSourceBtn) this.addSourceBtn.disabled = !hasDomain;
  }
```

- [ ] **Step 3: Lint + tsc the touched file**

Run: `npm run lint`
Expected: no new errors for `src/view.ts`.

Run (new-error gate only): `node_modules/.bin/tsc --noEmit 2>&1 | grep "src/view.ts" || echo "no view.ts errors"`
Expected: `no view.ts errors` (or only pre-existing baseline lines unrelated to this change — compare against `master` if unsure).

- [ ] **Step 4: Build the plugin bundle**

Run: `npm run build`
Expected: esbuild completes, no errors, `main.js` (dist bundle) regenerated.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts main.js
git commit -m "fix(view): keep Format button active for any non-wiki markdown file"
```

---

### Task 4: Docs, lint sweep, manual verification, finalize

**Files:**
- Update: affected `docs/wiki/` page(s) via iwiki for `src/wiki-path.ts`, `src/source-deletion.ts`, `src/view.ts`.

**Interfaces:** none (wrap-up).

- [ ] **Step 1: Regenerate wiki docs for changed sources**

Invoke the `iwiki:iwiki-ingest` skill for the changed sources (`src/view.ts`, `src/wiki-path.ts`, `src/source-deletion.ts`). Let it update/create the affected `docs/wiki/` pages describing the button-availability logic and the new predicate.

- [ ] **Step 2: Lint the wiki graph**

Invoke the `/iwiki-lint` skill (or `iwiki:iwiki-lint`).
Expected: no broken `[[refs]]`, no orphan or stale pages.

- [ ] **Step 3: Full lint sweep**

Run: `npm run lint`
Expected: no new errors across the touched files.

- [ ] **Step 4: Manual verification in Obsidian (acceptance matrix)**

Load the rebuilt plugin in the dev vault, open the AI Wiki view with a domain selected, and verify the **Format** button state matches the spec acceptance matrix:

| Active file | Format button | Delete button |
|---|---|---|
| markdown source NOT in `domain.source_paths` | **enabled** (the fix) | disabled |
| markdown source IN `domain.source_paths` | enabled | enabled |
| wiki article under `!Wiki/...` | disabled | disabled |
| non-markdown file (e.g. `.png`) | disabled | disabled |
| no active file | disabled | disabled |

Also click **Format** on a source file outside the domain → it should dispatch formatting (no longer greyed out). Click **Format** on a wiki article (if reachable) → controller shows the "action forbidden" InfoModal.

- [ ] **Step 5: Commit any doc changes**

```bash
git add docs/wiki
git commit -m "docs(wiki): document Format button availability and isWikiArticlePath"
```

- [ ] **Step 6: Open the PR**

Push the branch and open a PR targeting `master` (use the git-workflow / finishing-a-development-branch flow). Version bump/release (`publish-version`) happens per the project's release convention at merge time.

---

## Notes for the implementer

- The four "buttons disabled by `!hasDomain`" lines (ask/ingest/lint/reinit/addSource) are intentionally untouched — only the format predicate changes.
- Do NOT add a `!hasDomain` guard to the format button: `controller.format()` does not require a selected domain; it scans all domains for wiki membership and formats otherwise.
- If `eval/*/run.cjs` artifacts feel noisy in the diff, follow the existing `eval/rerun-domain/` precedent (both `run.ts` and `run.cjs` committed) rather than introducing a new `.gitignore` convention.
