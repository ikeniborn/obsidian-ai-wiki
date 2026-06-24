---
review:
  plan_hash: cfd6cc0ab8c6bf6a
  spec_hash: 810e1c64b771bd1f
  last_run: 2026-06-24
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: dependencies
      severity: INFO
      section: "Task 1 (Step 4) / Task 2 (note)"
      section_hash: null
      text: "Task 1's eval calls VaultTools.mtime (Task 2 code); checks 11-13 cannot go green until Task 2 lands, so Task 1 Step 4's DoD 'TOTAL: 13 passed' is unsatisfiable in strict task isolation. Already explicitly acknowledged in the Task 2 note (lines 288-294) and Task 1 Step 2 (expects an esbuild resolve failure). No fix required; flagged for traceability — implement Tasks 1+2 together or accept Task 1's eval greens only after Task 2."
      verdict: open
      verdict_at: null
    - id: F-002
      phase: verifiability
      severity: INFO
      section: "Task 8 Step 3 (Update docs/wiki via iwiki)"
      section_hash: 0ba0ef94fa2f63c3
      text: "iwiki-ingest step has no machine-checkable Expected output; its DoD is effectively the next step's /iwiki-lint clean result. Optional fix: state 'Expected: each ingest writes/updates its wiki page; verified by Step 4 lint clean'."
      verdict: open
      verdict_at: null
    - id: F-003
      phase: consistency
      severity: INFO
      section: "Global Constraints (line 19) / Self-Review (line 988)"
      section_hash: 0ba0ef94fa2f63c3
      text: "Intent says full reinit is 'byte-for-byte unchanged'; plan (mirroring spec) narrows to 'produced artifacts identical, not the event/IO trace'. Deliberate, HUMAN-CHECKPOINT-flagged reconciliation already recorded in the spec (F-003 there); carried faithfully into the plan, not a new contradiction. Recorded for traceability."
      verdict: open
      verdict_at: null
chain:
  intent: docs/superpowers/intents/2026-06-24-incremental-reinit-intent.md
  spec:   docs/superpowers/specs/2026-06-24-incremental-reinit-design.md
---
# Incremental Re-init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an incremental domain re-init mode that re-ingests only the sources whose vault-file mtime is newer than their associated wiki pages (or that have no page yet), chosen via a Full/Incremental selector at reinit start.

**Architecture:** A pure detection module (`computeChangedSources`) keyed only on mtime decides the changed set; the controller gathers mtimes via a new `VaultTools.mtime` accessor and wiki→source links via existing `parseWikiSources`; a `ReinitModeModal` presents Full vs Incremental(N); a new `runInit '--incremental'` branch loops the unchanged `runIngest` over the changed list. The ingest pipeline is reordered (A2) so wiki pages are written **after** the source, guaranteeing `page mtime ≥ source mtime` and keeping the detector honest.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild (build + out-of-vault eval harness), node test via `node eval/<name>/run.cjs`.

**Spec:** [docs/superpowers/specs/2026-06-24-incremental-reinit-design.md](../specs/2026-06-24-incremental-reinit-design.md) — approved, `/check-spec` OK.
**Intent:** [docs/superpowers/intents/2026-06-24-incremental-reinit-intent.md](../intents/2026-06-24-incremental-reinit-intent.md)

## Global Constraints

- **mtime only.** Detection keys solely on file modification time. `wiki_added`, `wiki_updated`, and any frontmatter field are forbidden as the freshness source of truth. `wiki_sources` may be used only for the structural source→page mapping, never as a timestamp.
- **No persisted state.** No "last re-ingest" timestamp; every run compares live mtimes.
- **Detection rule:** include source `S` when `associated` pages is empty, OR any mtime is `null` (trust bias), OR `mtime(S) > min(mtime of associated pages)` — **strict `>`, `min` aggregation**.
- **Full reinit (`--force`) produced artifacts unchanged** — wiki page content, `_index.md`, and the domain entry must be byte-identical. The A2 reorder changes only event order and planned-vs-actual backlinks (accepted, lint-healed); it must not change produced page content.
- **Phase code must not import `obsidian` to read mtime** — it goes through `VaultTools.mtime`.
- **Lint:** `npm run lint` mirrors the Obsidian reviewer; it must pass for touched files. No new `obsidian` runtime imports in phase code; any node builtins must be lazy + desktop-guarded (not needed here — A2 uses no node builtins in `src/`).
- **tsc:** the baseline is not clean (~135 pre-existing errors in untouched files). Gate on **new** errors in touched files, not "tsc clean".
- **Branch:** all work on `dev/incremental-reinit` (worktree `wk/dev/incremental-reinit`); merge to `master` via PR only. No direct commit/push to `master`.
- **Worktree note:** the worktree has no `node_modules` (gitignored). Before any build/lint/eval, symlink it from the main repo (Task 1, Step 0).
- **HUMAN CHECKPOINT:** Task 3 (A2 reorder in `runIngest`) is proposal-first per the intent. Do not merge it without explicit human approval; it touches the shared ingest pipeline used by manual ingest, delete, and full reinit.

---

### Task 1: Pure changed-source detection + eval

**Files:**
- Create: `src/incremental-sources.ts`
- Create: `eval/incremental-sources/run.ts`
- Build artifact: `eval/incremental-sources/run.cjs` (generated, committed — matches the `eval/format-button/` precedent)

**Interfaces:**
- Produces: `computeChangedSources({ sourceFiles: SourceFileInfo[]; wikiPages: WikiPageInfo[] }): { changed: string[] }`; `capList(names: string[], cap?: number): { shown: string[]; overflow: number }`; types `SourceFileInfo { stem: string; path: string; mtime: number | null }`, `WikiPageInfo { path: string; mtime: number | null; sources: string[] }`.
- Consumes: nothing (pure; no `obsidian`, no IO in the module itself — the eval uses `node:fs` for the integration section).

- [ ] **Step 0: Symlink node_modules into the worktree** (one-time, enables esbuild/lint/eval)

Run:
```bash
ln -sfn /home/ikeniborn/Documents/Project/obsidian-ai-wiki/node_modules \
  /home/ikeniborn/Documents/Project/obsidian-ai-wiki/.claude/worktrees/dev+incremental-reinit/node_modules
```
Expected: `node_modules` symlink resolves; `ls node_modules/.bin/esbuild` succeeds.

- [ ] **Step 1: Write the failing eval**

Create `eval/incremental-sources/run.ts`:
```ts
/**
 * Out-of-vault eval for incremental-reinit changed-source detection.
 * Exercises the REAL pure functions from src/ plus a node-fs integration that
 * replays the A2 write order (source written before pages) and asserts the
 * detector returns no changes for an un-edited vault. No Obsidian, no LLM.
 */
import { mkdtempSync, writeFileSync, statSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeChangedSources, capList } from "../../src/incremental-sources";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// =====================================================================
section("computeChangedSources — pure rules");

// 1: unchanged source (newer page) → not flagged (strict >)
check("1 unchanged source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed.length === 0);

// 2: edited source (newer than page) → flagged
check("2 edited source included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 300 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 3: equal mtimes → NOT flagged (strict >)
check("3 equal mtime excluded (strict >)", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 200 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed.length === 0);

// 4: new source, no associated page → flagged (trust bias)
check("4 new source included", computeChangedSources({
  sourceFiles: [{ stem: "b", path: "src/b.md", mtime: 50 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/b.md");

// 5: null source mtime → flagged (trust bias)
check("5 null source mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: null }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 6: null page mtime → flagged (trust bias)
check("6 null page mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: null, sources: ["a"] }],
}).changed[0] === "src/a.md");

// 7: shared page + min aggregation — A unedited vs oldest page
check("7 min aggregation, unedited shared-source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [
    { path: "w/wiki_d_p1.md", mtime: 150, sources: ["a"] },        // a's own page
    { path: "w/wiki_d_p2.md", mtime: 500, sources: ["a", "b"] },   // shared, bumped by b later
  ],
}).changed.length === 0);  // min(150,500)=150 ; 100 > 150? no

// 8: strict subset — only the edited one of two sources
check("8 strict subset", JSON.stringify(computeChangedSources({
  sourceFiles: [
    { stem: "a", path: "src/a.md", mtime: 100 },
    { stem: "b", path: "src/b.md", mtime: 999 },
  ],
  wikiPages: [
    { path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] },
    { path: "w/wiki_d_b.md", mtime: 200, sources: ["b"] },
  ],
}).changed) === JSON.stringify(["src/b.md"]));

// =====================================================================
section("capList");
check("9 capList under cap returns all", (() => {
  const r = capList(["a", "b"], 20); return r.shown.length === 2 && r.overflow === 0;
})());
check("10 capList over cap truncates + overflow", (() => {
  const names = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const r = capList(names, 20); return r.shown.length === 20 && r.overflow === 5;
})());

// =====================================================================
section("node-fs integration — A2 order contract");
{
  const dir = mkdtempSync(join(tmpdir(), "incr-reinit-"));
  try {
    const adapter: VaultAdapter = {
      read: async (p) => "", write: async () => {}, append: async () => {},
      list: async () => ({ files: [], folders: [] }), exists: async () => true,
      mkdir: async () => {},
      stat: async (p) => { try { return { mtime: statSync(join(dir, p)).mtimeMs }; } catch { return null; } },
    };
    const vt = new VaultTools(adapter, dir);

    // A2 write order: source FIRST, then page.
    const srcRel = "a.md", pageRel = "wiki_d_a.md";
    writeFileSync(join(dir, srcRel), "---\ntitle: A\n---\nbody");
    writeFileSync(join(dir, pageRel), "---\nwiki_sources:\n  - a\n---\npage");

    const srcMtime = await vt.mtime(srcRel);
    const pageMtime = await vt.mtime(pageRel);
    check("11 page mtime ≥ source mtime after A2 order", (pageMtime ?? 0) >= (srcMtime ?? 0),
      `src=${srcMtime} page=${pageMtime}`);

    const before = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: srcMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }],
    });
    check("12 un-edited vault → no changes", before.changed.length === 0, JSON.stringify(before));

    // Manual edit: bump source mtime well past the page.
    utimesSync(join(dir, srcRel), new Date(), new Date((pageMtime ?? 0) + 10_000));
    const editedMtime = await vt.mtime(srcRel);
    const after = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: editedMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }],
    });
    check("13 edited source → flagged", after.changed[0] === srcRel, JSON.stringify(after));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Build + run the eval to verify it fails**

Run:
```bash
cd /home/ikeniborn/Documents/Project/obsidian-ai-wiki/.claude/worktrees/dev+incremental-reinit
node_modules/.bin/esbuild eval/incremental-sources/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/incremental-sources/run.cjs
```
Expected: esbuild **fails** — `Could not resolve "../../src/incremental-sources"` (module not created yet).

- [ ] **Step 3: Create the module**

Create `src/incremental-sources.ts`:
```ts
/**
 * Pure changed-source detection for incremental domain re-init.
 *
 * No Obsidian / IO imports — testable out-of-vault (eval/incremental-sources/).
 * Keys ONLY on mtime: a source is "changed" when it has no associated wiki page,
 * when any relevant mtime is unavailable (trust bias: include on ambiguity), or
 * when it is strictly newer than the oldest of its associated pages. It never
 * reads wiki_added / wiki_updated or any timestamp frontmatter field.
 */

export interface SourceFileInfo {
  /** Source filename stem (basename without ".md"). */
  stem: string;
  /** Vault-relative source path; returned verbatim in `changed`. */
  path: string;
  /** Modification time in epoch ms, or null when unavailable. */
  mtime: number | null;
}

export interface WikiPageInfo {
  path: string;
  mtime: number | null;
  /** Bare source stems from the page's wiki_sources frontmatter. */
  sources: string[];
}

export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];
  wikiPages: WikiPageInfo[];
}): { changed: string[] } {
  const { sourceFiles, wikiPages } = input;
  const changed: string[] = [];
  for (const src of sourceFiles) {
    const associated = wikiPages.filter((p) => p.sources.includes(src.stem));
    if (associated.length === 0) { changed.push(src.path); continue; }            // new / unreflected
    if (src.mtime === null || associated.some((p) => p.mtime === null)) {
      changed.push(src.path); continue;                                           // ambiguous → trust bias
    }
    const oldestPage = Math.min(...associated.map((p) => p.mtime as number));
    if (src.mtime > oldestPage) changed.push(src.path);                           // strict >, min aggregation
  }
  return { changed };
}

/**
 * Cap a name list for display: at most `cap` names, plus the overflow count.
 * The caller renders the "+K more" line with its own i18n.
 */
export function capList(names: string[], cap = 20): { shown: string[]; overflow: number } {
  if (names.length <= cap) return { shown: names, overflow: 0 };
  return { shown: names.slice(0, cap), overflow: names.length - cap };
}
```

- [ ] **Step 4: Rebuild + run the eval to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/incremental-sources/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/incremental-sources/run.cjs
node eval/incremental-sources/run.cjs
```
Expected: `TOTAL: 13 passed, 0 failed`.

- [ ] **Step 5: Lint the new source file**

Run: `npm run lint`
Expected: no errors for `src/incremental-sources.ts` (the eval dir is outside the `src/**` lint glob).

- [ ] **Step 6: Commit**

```bash
git add src/incremental-sources.ts eval/incremental-sources/run.ts eval/incremental-sources/run.cjs
git commit -m "feat(incremental): pure changed-source detection + eval

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: mtime accessor (`VaultTools.mtime` + `VaultAdapter.stat`)

**Files:**
- Modify: `src/vault-tools.ts` (extend `VaultAdapter` interface; add `VaultTools.mtime`)
- Test: covered by `eval/incremental-sources/run.ts` Step "node-fs integration" (already exercises `vt.mtime` through a real-fs `stat` adapter in Task 1).

**Interfaces:**
- Produces: `VaultAdapter.stat?(path: string): Promise<{ mtime: number } | null>`; `VaultTools.mtime(vaultPath: string): Promise<number | null>`.
- Consumes: nothing new.

> Note: Task 1's integration section already imports `VaultTools` and calls `vt.mtime`. If Task 1 was implemented before this task, Step 4 of Task 1 would have failed to compile (`stat`/`mtime` missing). Implement this task's code change **with** Task 1 if executing strictly in order — or accept that Task 1's eval only goes green once this task lands. Either way, the verification command below is the gate.

- [ ] **Step 1: Add `stat` to the `VaultAdapter` interface**

In `src/vault-tools.ts`, inside `interface VaultAdapter`, after the `mkdir(path: string): Promise<void>;` line, add:
```ts
  /** File stat; `mtime` is epoch ms. Resolves null when the path has no stat. */
  stat?(path: string): Promise<{ mtime: number } | null>;
```

- [ ] **Step 2: Add the `mtime` method to `VaultTools`**

In `src/vault-tools.ts`, inside `class VaultTools`, after the `exists` method, add:
```ts
  /** Modification time in epoch ms, or null when unavailable (missing file or no stat support). */
  async mtime(vaultPath: string): Promise<number | null> {
    if (!this.adapter.stat) return null;
    const s = await this.adapter.stat(vaultPath);
    return s ? s.mtime : null;
  }
```

- [ ] **Step 3: Rebuild + run the eval (now compiles and passes)**

Run:
```bash
node_modules/.bin/esbuild eval/incremental-sources/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/incremental-sources/run.cjs
node eval/incremental-sources/run.cjs
```
Expected: `TOTAL: 13 passed, 0 failed` (checks 11–13 exercise `VaultTools.mtime` against real fs).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors for `src/vault-tools.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/vault-tools.ts eval/incremental-sources/run.cjs
git commit -m "feat(incremental): add VaultTools.mtime + VaultAdapter.stat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: A2 reorder in `runIngest` — write source before pages (HUMAN CHECKPOINT)

**Files:**
- Modify: `src/phases/ingest.ts` (move the source-frontmatter block before the page-write loop; compute from planned data)
- Regression eval: `eval/format-frontmatter/run.cjs`, `eval/source-deletion/run.cjs`, `eval/wiki-hygiene/run.cjs` (pure helpers, must stay green)

**Interfaces:**
- Consumes: existing `runIngest` internals — `pages` (finalised list after stem-mask + WikiLink fix), `parseResult.value.deletes`, `existingPaths`, and the pure helpers `recoverSourceFrontmatter`, `hasFrontmatterField`, `parseWikiArticlesFromFm`, `upsertRawFrontmatter`, `validateAndRepairSourceFrontmatter`, `stripInvalidWikiArticles`, `filterStaleWikiLinks`, `validateArticlePath`.
- Produces: same observable artifacts (page content, index, domain entry) as before; only event order and planned-vs-actual backlinks change.

> **This is the proposal-first / HUMAN CHECKPOINT task.** It changes the shared ingest pipeline for ALL callers (manual ingest, delete, full reinit). Get explicit human approval before merging. `runIngest` needs an LLM + a vault, so it has no headless automated test; its correctness here is verified by (a) the contract eval (Task 1 checks 11–13), (b) the regression evals staying green, (c) code review confirming source-write precedes page-writes, and (d) the manual e2e in Task 8.

- [ ] **Step 1: Confirm current order (baseline)**

Run:
```bash
grep -n "backlinkToday\|await vaultTools.write(sourceVaultPath\|for (const page of pages)\|const deletes = parseResult.value.deletes" src/phases/ingest.ts
```
Expected: the `for (const page of pages)` page-write loop and the `deletes` read both appear **before** the `await vaultTools.write(sourceVaultPath, …)` source write — confirming the source is currently written last.

- [ ] **Step 2: Hoist `deletes` and compute the planned delete set**

In `src/phases/ingest.ts`, immediately **after** the WikiLink-fix block that finalises `pages` (the `pages = pages.map((p) => { … stripDeadLinks … });` statement, ~line 324) and **before** `const written: string[] = [];`, insert:
```ts
  // --- A2 reorder: the source frontmatter is written BEFORE the wiki pages so
  // that, after ingest, every wiki page's mtime is >= the source's. This keeps
  // incremental re-init honest: an unchanged source is not re-flagged. Backlinks
  // are therefore computed from the PLANNED page/delete sets (results are not yet
  // known). See docs/superpowers/specs/2026-06-24-incremental-reinit-design.md.
  const plannedDeletes = (parseResult.value.deletes ?? []).filter((d) => {
    const hasTraversal = d.path.split("/").some((seg) => seg === ".." || seg === ".");
    return !hasTraversal && validateArticlePath(d.path, wikiVaultPath);
  });
  const plannedDeletePaths = new Set(plannedDeletes.map((d) => d.path));
  const plannedDeleteStems = new Set([...plannedDeletePaths].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
  const plannedPagePaths = pages.map((p) => p.path);

  if (pages.length > 0 || plannedDeletePaths.size > 0) {
    const backlinkToday = new Date().toISOString().slice(0, 10);
    const normalizedSource = recoverSourceFrontmatter(sourceContent);
    const isFirstTime = !hasFrontmatterField(normalizedSource, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(normalizedSource).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !plannedDeleteStems.has(stem);
    });
    const writtenLinks = plannedPagePaths.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(normalizedSource, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    const { content: repairedSource, warnings: sourceWarnings } =
      validateAndRepairSourceFrontmatter(updatedSource);
    const wikiFileStems = new Set(
      [...existingPaths, ...plannedPagePaths]
        .filter((p) => !plannedDeletePaths.has(p) && !p.endsWith("_index.md"))
        .map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
    );
    const { content: wikiArticlesFiltered, warnings: wikiArticlesWarnings } =
      stripInvalidWikiArticles(repairedSource, wikiFileStems);
    const { content: filteredSource, warnings: relatedWarnings } =
      filterStaleWikiLinks(wikiArticlesFiltered, wikiFileStems, ["related"]);
    const allSourceWarnings = [...sourceWarnings, ...wikiArticlesWarnings, ...relatedWarnings];
    if (allSourceWarnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "Source frontmatter repaired", details: allSourceWarnings };
    }
    yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, filteredSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }
    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }
```

- [ ] **Step 3: Remove the now-duplicated old source-frontmatter block**

Delete the original block that ran **after** the delete loop — from the line `const deletedStems = new Set(deletedPaths.map(...));` (just after the summary `yield`) through the end of the old `if (written.length > 0 || deletedPaths.length > 0) { … source write … yield source_path_added }` block, i.e. the section spanning roughly the old lines 492–551. Keep everything after it (the `entity_types_delta` `domain_updated`, `similarity.refreshCache`, `wlFixResult.warnings`, and final `result`).

After removal, the order inside `runIngest` reads: finalise `pages` → **planned source-frontmatter block + source write (new)** → page-write loop → delete loop → index reconciliation → summary → entity_types_delta → refreshCache → result.

> The page-write loop and delete loop are otherwise unchanged. The delete loop still reads `parseResult.value.deletes` and re-validates each path; that is fine and independent of `plannedDeletes`. `appendWikiLog` still uses `logEntries` populated by the loops, unchanged. The `deletedStems` variable used only by the old block is removed with it.

- [ ] **Step 4: Type-check the touched file (no NEW errors)**

Run:
```bash
node_modules/.bin/tsc --noEmit 2>&1 | grep "src/phases/ingest.ts" || echo "no new ingest.ts errors"
```
Expected: `no new ingest.ts errors` (baseline tsc is not clean repo-wide; gate only on `ingest.ts`).

- [ ] **Step 5: Run the ingest-adjacent regression evals**

Run (rebuild each if its `run.cjs` is stale; `format-frontmatter` is the key one — it replicates the backlink helpers):
```bash
node eval/format-frontmatter/run.cjs
node eval/source-deletion/run.cjs 2>/dev/null || (node_modules/.bin/esbuild eval/source-deletion/run.ts --bundle --platform=node --format=cjs --alias:obsidian=./eval/source-deletion/obsidian-stub.ts --outfile=eval/source-deletion/run.cjs && node eval/source-deletion/run.cjs)
node eval/wiki-hygiene/run.cjs 2>/dev/null || echo "wiki-hygiene: build+run if present"
```
Expected: each prints `TOTAL: N passed, 0 failed`. These exercise the pure helpers the reorder reuses; the reorder must not change their behavior.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors for `src/phases/ingest.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/phases/ingest.ts eval/source-deletion/run.cjs
git commit -m "refactor(ingest)!: write source frontmatter before wiki pages (A2)

Pages are now written last so page mtime >= source mtime after every ingest,
keeping incremental re-init detection honest. Source backlinks are computed
from the planned page/delete sets. Produced page content, index, and domain
entry are unchanged; event order (source_path_added now precedes page writes)
and planned-vs-actual backlinks differ. HUMAN CHECKPOINT — shared pipeline.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `ReinitModeModal` + i18n keys

**Files:**
- Modify: `src/modals.ts` (add `ReinitModeModal`; import `capList`)
- Modify: `src/i18n.ts` (add `reinitMode*` keys to `en`, `ru`, `es` modal bundles)

**Interfaces:**
- Consumes: `capList` from `src/incremental-sources.ts` (Task 1).
- Produces: `class ReinitModeModal` with constructor `(app: App, plan: { changed: string[]; totalSources: number; wikiFileCount: number }, onChoice: (mode: "full" | "incremental") => void)`.

- [ ] **Step 1: Add i18n keys (English bundle)**

In `src/i18n.ts`, in the **en** modal bundle, after the `reinitConfirmBody` entry (~line 264), add:
```ts
    reinitModeTitle: "Re-init — choose mode",
    reinitModeFullDesc: (wikiFiles: number, srcCount: number) =>
      `Full: delete all ${wikiFiles} wiki files and rebuild from all ${srcCount} sources.`,
    reinitModeIncrementalDesc: (n: number) =>
      `Incremental: re-ingest only the ${n} changed source(s) listed below.`,
    reinitModeNoneChanged: "No changed sources — nothing to re-ingest incrementally.",
    reinitModeMore: (k: number) => `… +${k} more`,
    reinitModeFull: "Full",
    reinitModeIncremental: (n: number) => `Incremental (${n})`,
```

- [ ] **Step 2: Add i18n keys (Russian bundle)**

In the **ru** modal bundle, after `reinitConfirmBody` (~line 589), add:
```ts
    reinitModeTitle: "Re-init — выберите режим",
    reinitModeFullDesc: (wikiFiles: number, srcCount: number) =>
      `Полный: удалить все ${wikiFiles} wiki-файлов и пересобрать из всех ${srcCount} источников.`,
    reinitModeIncrementalDesc: (n: number) =>
      `Инкрементальный: переобработать только ${n} изменённых источников из списка ниже.`,
    reinitModeNoneChanged: "Изменённых источников нет — инкрементальный re-init не требуется.",
    reinitModeMore: (k: number) => `… ещё +${k}`,
    reinitModeFull: "Полный",
    reinitModeIncremental: (n: number) => `Инкрементальный (${n})`,
```

- [ ] **Step 3: Add i18n keys (Spanish bundle)**

In the **es** modal bundle, after `reinitConfirmBody` (~line 893), add:
```ts
    reinitModeTitle: "Re-init — elegir modo",
    reinitModeFullDesc: (wikiFiles: number, srcCount: number) =>
      `Completo: eliminar los ${wikiFiles} archivos wiki y reconstruir desde las ${srcCount} fuentes.`,
    reinitModeIncrementalDesc: (n: number) =>
      `Incremental: reprocesar solo las ${n} fuentes modificadas de la lista.`,
    reinitModeNoneChanged: "Sin fuentes modificadas — re-init incremental innecesario.",
    reinitModeMore: (k: number) => `… +${k} más`,
    reinitModeFull: "Completo",
    reinitModeIncremental: (n: number) => `Incremental (${n})`,
```

- [ ] **Step 4: Add the modal class**

In `src/modals.ts`, add the import at the top (alongside the other local imports):
```ts
import { capList } from "./incremental-sources";
```
Then add, after the existing `IngestScopeModal` class:
```ts
export class ReinitModeModal extends Modal {
  constructor(
    app: App,
    private plan: { changed: string[]; totalSources: number; wikiFileCount: number },
    private onChoice: (mode: "full" | "incremental") => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.reinitModeTitle });
    contentEl.createEl("p", { text: T.reinitModeFullDesc(this.plan.wikiFileCount, this.plan.totalSources) });

    const n = this.plan.changed.length;
    if (n > 0) {
      contentEl.createEl("p", { text: T.reinitModeIncrementalDesc(n) });
      const { shown, overflow } = capList(this.plan.changed.map((p) => p.split("/").pop() ?? p), 20);
      const ul = contentEl.createEl("ul");
      for (const name of shown) ul.createEl("li", { text: name });
      if (overflow > 0) ul.createEl("li", { text: T.reinitModeMore(overflow) });
    } else {
      contentEl.createEl("p", { text: T.reinitModeNoneChanged });
    }

    const setting = new Setting(contentEl);
    setting.addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()));
    setting.addButton((b) =>
      b.setButtonText(T.reinitModeFull).setWarning().onClick(() => this.pick("full")),
    );
    setting.addButton((b) => {
      b.setButtonText(T.reinitModeIncremental(n)).setCta().onClick(() => this.pick("incremental"));
      if (n === 0) b.setDisabled(true);
    });
  }

  private pick(mode: "full" | "incremental"): void {
    this.close();
    this.onChoice(mode);
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 5: Type-check + lint**

Run:
```bash
node_modules/.bin/tsc --noEmit 2>&1 | grep -E "src/(modals|i18n)\.ts" || echo "no new errors in modals.ts / i18n.ts"
npm run lint
```
Expected: `no new errors in modals.ts / i18n.ts`; lint clean for both files.

- [ ] **Step 6: Build the plugin to confirm it bundles**

Run: `npm run build`
Expected: build succeeds (esbuild writes `main.js`), no type/bundle errors.

- [ ] **Step 7: Commit**

```bash
git add src/modals.ts src/i18n.ts
git commit -m "feat(incremental): ReinitModeModal (Full/Incremental selector) + i18n

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `controller.computeIncrementalPlan` + `init` incremental param

**Files:**
- Modify: `src/controller.ts` (add `computeIncrementalPlan`; extend `init`; add imports)

**Interfaces:**
- Consumes: `computeChangedSources` + types from `src/incremental-sources.ts`; `VaultTools` / `VaultAdapter` from `src/vault-tools.ts`; `collectMdInPaths` + `parseWikiSources` from `src/utils/vault-walk.ts`; `domainWikiFolder` from `src/wiki-path.ts` (already imported).
- Produces: `computeIncrementalPlan(domainId: string): Promise<{ changed: string[]; totalSources: number; wikiFileCount: number }>`; `init(domain, dryRun, sourcePaths?, force?, incremental?)`.

> No headless automated test: this is Obsidian-vault glue (`app.vault`, adapter). The pure core it delegates to (`computeChangedSources`) is covered by Task 1. Verified end-to-end in Task 8.

- [ ] **Step 1: Add imports**

In `src/controller.ts`, extend the existing import from `./utils/vault-walk` and add the new module import:
```ts
import { collectMdInPaths, parseWikiSources } from "./utils/vault-walk";
import { computeChangedSources, type SourceFileInfo, type WikiPageInfo } from "./incremental-sources";
```
(`collectMdInPaths` is already imported there; ensure `parseWikiSources` is added to that same import line. `VaultTools` and `VaultAdapter` are already imported.)

- [ ] **Step 2: Add `computeIncrementalPlan`**

In `src/controller.ts`, after the `loadDomains()` method, add:
```ts
  /**
   * Compute the incremental re-init plan: which source files are newer than (or
   * not yet reflected by) their wiki pages. Pure decision is delegated to
   * computeChangedSources; this only gathers mtimes + wiki_sources from the vault.
   */
  async computeIncrementalPlan(
    domainId: string,
  ): Promise<{ changed: string[]; totalSources: number; wikiFileCount: number }> {
    const domains = await this.loadDomains();
    const entry = domains.find((d) => d.id === domainId);
    if (!entry) return { changed: [], totalSources: 0, wikiFileCount: 0 };

    const base = this.cwdOrEmpty();
    const vaultTools = new VaultTools(
      this.app.vault.adapter as unknown as VaultAdapter,
      base,
    );
    const toVaultRel = (p: string): string => {
      if (!base || !p.startsWith("/")) return p;
      return p.startsWith(base) ? p.slice(base.length).replace(/^\//, "") : p;
    };

    const sourceTFiles = collectMdInPaths(this.app.vault, (entry.source_paths ?? []).map(toVaultRel));
    const sourceFiles: SourceFileInfo[] = [];
    for (const f of sourceTFiles) {
      sourceFiles.push({ stem: f.basename, path: f.path, mtime: await vaultTools.mtime(f.path) });
    }

    const wikiTFiles = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)])
      .filter((f) => !f.path.includes("/_config/"));
    const wikiPages: WikiPageInfo[] = [];
    for (const f of wikiTFiles) {
      let content = "";
      try { content = await this.app.vault.adapter.read(f.path); } catch { /* unreadable → no sources */ }
      wikiPages.push({ path: f.path, mtime: await vaultTools.mtime(f.path), sources: parseWikiSources(content) });
    }

    const { changed } = computeChangedSources({ sourceFiles, wikiPages });
    return { changed, totalSources: sourceFiles.length, wikiFileCount: wikiTFiles.length };
  }
```

- [ ] **Step 3: Extend `init` with the `incremental` parameter**

In `src/controller.ts`, replace the `init` method signature/body header:
```ts
  async init(domain: string, dryRun: boolean, sourcePaths?: string[], force?: boolean, incremental?: boolean): Promise<void> {
    const args: string[] = [domain];
    if (dryRun) args.push("--dry-run");
    if (force) args.push("--force");
    if (incremental) args.push("--incremental");
    if (sourcePaths?.length) args.push("--sources", ...sourcePaths);
    const onFileError: OnFileError | undefined = (sourcePaths?.length || incremental)
      ? (file, err, canRetry) => {
          const modal = new FileErrorModal(this.app, file, err, canRetry);
          modal.open();
          return modal.result;
        }
      : undefined;
    await this.dispatch("init", args, undefined, undefined, undefined, onFileError);
  }
```

- [ ] **Step 4: Type-check + lint + build**

Run:
```bash
node_modules/.bin/tsc --noEmit 2>&1 | grep "src/controller.ts" || echo "no new controller.ts errors"
npm run lint
npm run build
```
Expected: `no new controller.ts errors`; lint clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts
git commit -m "feat(incremental): controller.computeIncrementalPlan + init incremental flag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire reinit UI (`src/view.ts#runReinit`)

**Files:**
- Modify: `src/view.ts` (replace the `ConfirmModal` in `runReinit` with `computeIncrementalPlan` + `ReinitModeModal`; add import)

**Interfaces:**
- Consumes: `controller.computeIncrementalPlan` (Task 5); `ReinitModeModal` (Task 4); `controller.init(..., incremental)` (Task 5).
- Produces: nothing downstream.

> UI glue — no headless test; verified in Task 8.

- [ ] **Step 1: Add the import**

In `src/view.ts`, add `ReinitModeModal` to the existing `./modals` import.

- [ ] **Step 2: Replace `runReinit` body**

Replace the current `runReinit` method (the one ending in the `ConfirmModal(... () => void this.plugin.controller.init(entry.id, false, sourcePaths, true))`) with:
```ts
  private async runReinit(): Promise<void> {
    if (!this.domainSelect) return;
    const domainId = this.domainSelect.value;
    if (!domainId) return;

    let entry: DomainEntry | undefined;
    try {
      const domains = await this.plugin.controller.loadDomains();
      entry = domains.find((d) => d.id === domainId);
    } catch {
      return;
    }
    if (!entry) return;
    const resolved = entry;

    const sourcePaths = resolved.source_paths ?? [];
    if (sourcePaths.length === 0) {
      new Notice(i18n().view.reinitNoSources);
      return;
    }

    const plan = await this.plugin.controller.computeIncrementalPlan(resolved.id);
    new ReinitModeModal(this.app, plan, (mode) => {
      if (mode === "full") {
        void this.plugin.controller.init(resolved.id, false, sourcePaths, true);
      } else {
        void this.plugin.controller.init(resolved.id, false, plan.changed, false, true);
      }
    }).open();
  }
```

- [ ] **Step 3: Type-check + lint + build**

Run:
```bash
node_modules/.bin/tsc --noEmit 2>&1 | grep "src/view.ts" || echo "no new view.ts errors"
npm run lint
npm run build
```
Expected: `no new view.ts errors`; lint clean; build succeeds. (The previously-used `T`/`base`/`toVaultRel`/`mdFiles`/`wikiFiles`/`reinitConfirmBody` locals in the old `runReinit` are gone — confirm no now-unused imports remain in `view.ts`; `ConfirmModal` is still used elsewhere in the file, so keep its import.)

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(incremental): reinit opens Full/Incremental mode selector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `runInit '--incremental'` branch (`src/phases/init.ts`)

**Files:**
- Modify: `src/phases/init.ts` (parse `--incremental`; add branch; add `runIncrementalReinit` generator)

**Interfaces:**
- Consumes: `runIngest` (unchanged), `DomainEntry`, `RunEvent`, `OnFileError`, `LlmClient`, `LlmCallOptions`, `PageSimilarityService` (all already imported in `init.ts`).
- Produces: `runIncrementalReinit(...)` generator + a `--incremental` dispatch path in `runInit`.

> Needs an LLM + vault — verified end-to-end in Task 8, not headlessly.

- [ ] **Step 1: Parse the flag + add the branch in `runInit`**

In `src/phases/init.ts#runInit`, after `const force = args.includes("--force");`, add:
```ts
  const incremental = args.includes("--incremental");
```
Then, immediately after the `if (!domainId) { … }` guard and `const existing = domains.find(...)`, before the `if (force) {` block, add:
```ts
  if (incremental) {
    if (!existing) {
      yield { kind: "error", message: `incremental: domain not found: "${domainId}"` };
      return;
    }
    if (!existing.entity_types?.length) {
      yield { kind: "error", message: `incremental: domain "${domainId}" not initialised — run a full init/reinit first` };
      return;
    }
    if (!sourcePaths.length) {
      yield { kind: "result", durationMs: 0, text: `Domain "${domainId}": no changed sources to re-ingest.` };
      return;
    }
    yield* runIncrementalReinit(
      domainId, sourcePaths, vaultTools, llm, model, domains, signal, opts, onFileError, similarity,
    );
    return;
  }
```
(`sourcePaths` is already parsed from `--sources` near the top of `runInit`.)

- [ ] **Step 2: Add the `runIncrementalReinit` generator**

In `src/phases/init.ts`, after `runInitWithSources` (before `wipeDomainFolder`), add:
```ts
export async function* runIncrementalReinit(
  domainId: string,
  changedFiles: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  let currentDomain = domains.find((d) => d.id === domainId) ?? null;
  if (!currentDomain) {
    yield { kind: "error", message: `incremental: domain "${domainId}" missing` };
    return;
  }

  yield { kind: "init_start", totalFiles: changedFiles.length };
  let doneCount = 0;

  for (let i = 0; i < changedFiles.length; i++) {
    if (signal.aborted) return;
    const file = changedFiles[i];
    yield { kind: "file_start", file, index: i, total: changedFiles.length };

    let retried = false;
    let fileDone = false;
    while (!fileDone) {
      let caught: Error | null = null;
      try {
        for await (const ev of runIngest(
          [file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts, similarity,
        )) {
          yield ev;
          if (ev.kind === "domain_updated" && ev.domainId === domainId) {
            currentDomain = { ...currentDomain, ...ev.patch };
          }
        }
        fileDone = true;
      } catch (e) {
        caught = e as Error;
      }
      if (caught) {
        if (caught.name === "AbortError" || signal.aborted) return;
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caught, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        fileDone = true;
      }
    }

    if (signal.aborted) return;

    // New-source bookkeeping: make sure a freshly-ingested source lands in analyzed_sources.
    const analyzed = new Set(currentDomain.analyzed_sources ?? []);
    if (!analyzed.has(file)) {
      analyzed.add(file);
      currentDomain = { ...currentDomain, analyzed_sources: [...analyzed] };
      yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
      yield { kind: "domain_updated", domainId, patch: { analyzed_sources: currentDomain.analyzed_sources } };
      yield { kind: "tool_result", ok: true };
    }

    doneCount++;
    yield { kind: "file_done", file };
  }

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}": re-ingested ${doneCount} of ${changedFiles.length} changed source(s).`,
  };
}
```

- [ ] **Step 3: Type-check + lint + build**

Run:
```bash
node_modules/.bin/tsc --noEmit 2>&1 | grep "src/phases/init.ts" || echo "no new init.ts errors"
npm run lint
npm run build
```
Expected: `no new init.ts errors`; lint clean; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/phases/init.ts
git commit -m "feat(incremental): runInit --incremental branch (loop runIngest, no wipe)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification + docs

**Files:**
- No source changes. Manual verification + `docs/wiki/` update.

**Interfaces:** none.

- [ ] **Step 1: Full build sanity**

Run: `npm run build && npm run lint`
Expected: build succeeds; lint clean across all touched files.

- [ ] **Step 2: Manual e2e on a scratch vault (homelab LLM)**

Configure the native-agent backend against `https://homelab.ikeniborn.ru/v1` (key in the vault `local.json`; see the project's prompt-test setup). On a scratch vault with a domain of N sources:
1. Run a **Full** reinit → completes; wiki rebuilt.
2. Click reinit again → the `ReinitModeModal` shows **Incremental (0)** disabled. ✅ (proves A2: no source falsely flagged right after ingest)
3. Edit exactly one source note, save.
4. Click reinit → modal shows **Incremental (1)** with that file listed; run it → only that source re-ingests; the other pages untouched. ✅
5. Add a brand-new source file under a `source_path` (no wiki page yet) → reinit shows it in the incremental list; running ingests it. ✅
6. Run **Full** reinit again → produced pages/index/domain identical to step 1's output (spot-check a page's content). ✅

Record pass/fail for each numbered check. If check 2 fails (incremental shows >0 right after full reinit), the A2 invariant is broken — halt and revisit Task 3.

- [ ] **Step 3: Update `docs/wiki/` (iwiki)**

Run the iwiki ingest for the changed sources and update the affected pages (`operations.md` Reinit section; `domain-model.md` if needed). Use the `iwiki:iwiki-ingest` skill — do not hand-edit blindly:
```
iwiki:iwiki-ingest src/phases/init.ts
iwiki:iwiki-ingest src/phases/ingest.ts
iwiki:iwiki-ingest src/incremental-sources.ts
```
Then re-index. The `operations.md` page should gain an "Incremental Reinit" subsection describing the mode selector, the mtime detection rule, and the A2 ordering invariant.

- [ ] **Step 4: Lint the wiki**

Run the `/iwiki-lint` skill.
Expected: no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 5: Commit docs**

```bash
git add docs/wiki/
git commit -m "docs(wiki): document incremental reinit + A2 ingest ordering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Open the PR (after human approval of Task 3)**

Push the branch and open a PR into `master` (use the git-workflow skill). The PR description must flag the Task 3 A2 reorder as a shared-pipeline change (HUMAN CHECKPOINT) and link the spec + intent.

---

## Self-Review

**Spec coverage:**
- Mode selector (Full/Incremental) → Task 4 (modal) + Task 6 (wiring). ✓
- Incremental lists only changed + disabled at N=0 → Task 4 (`reinitModeIncremental(n)`, `setDisabled(n===0)`). ✓
- Ingest only the list, untouched not re-ingested → Task 7 (`runIncrementalReinit` loops only `changedFiles`). ✓
- New source appears + ingested → Task 1 rule (empty associated → include) + Task 7 bookkeeping. ✓
- Full reinit unchanged → Task 3 preserves produced artifacts; Task 8 step 6 spot-check. ✓
- Strict subset / not collapse → Task 1 detection + Task 3 invariant; Task 8 step 2 check. ✓
- mtime accessor in VaultTools, no obsidian in phase code → Task 2. ✓
- `wiki_sources` structural mapping only → Task 5 (`parseWikiSources`) + Task 1 rule. ✓
- A2 reorder / mtime invariant (HUMAN CHECKPOINT) → Task 3. ✓
- Detection module pure + eval → Task 1. ✓
- i18n ru/en/es → Task 4. ✓
- Verification (unit + node-fs + manual e2e) → Task 1 (unit + node-fs), Task 8 (e2e). ✓
- Edge: zero-page source always included → covered by Task 1 rule (empty associated); documented known limitation in spec. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `computeChangedSources` / `capList` / `SourceFileInfo` / `WikiPageInfo` signatures identical across Tasks 1, 4, 5. `VaultTools.mtime` return `number | null` consistent (Tasks 2, 5, eval). `init(domain, dryRun, sourcePaths?, force?, incremental?)` consistent across Tasks 5 and 6. `ReinitModeModal` constructor shape identical in Tasks 4 and 6. `runIncrementalReinit` signature identical in Tasks 7 Step 1 (call) and Step 2 (def). ✓
