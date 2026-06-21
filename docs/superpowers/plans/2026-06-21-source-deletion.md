---
review:
  plan_hash: 2bf8741eccb71cc1
  spec_hash: a91c2d4bc0eefc9d
  last_run: 2026-06-21
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: dependencies
      severity: CRITICAL
      section: "Task 6"
      section_hash: 98bd7e9ae3b7cbf8
      text: >-
        Controller task imported DeleteSourceModal which was created in a later
        task. FIXED by reordering: the modal is now Task 5, the controller Task
        6, so each task typechecks in isolation when executed top-to-bottom.
      verdict: fixed
      verdict_at: 2026-06-21
    - id: F-002
      phase: dependencies
      severity: WARNING
      section: "Task 7"
      section_hash: 00fb1069eb26d2a7
      text: >-
        Task 7 created the Delete button before adding the i18n().view.delete
        string. FIXED by making the i18n string Step 1 of Task 7, before the
        buttons.
      verdict: fixed
      verdict_at: 2026-06-21
chain:
  intent: docs/superpowers/intents/2026-06-21-source-deletion-intent.md
  spec: docs/superpowers/specs/2026-06-21-source-deletion-design.md
---
# Delete Source Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Delete source" operation that removes a source file and every wiki artifact tied to it, rebuilding multi-source wiki pages on their remaining sources, fronted by a preview modal and a dedicated gated sidebar button.

**Architecture:** A pure planner (`src/source-deletion.ts`) computes the deletion plan and is shared by the preview modal and a new `runDelete` phase (`src/phases/delete.ts`). The phase reuses `runIngest` to rebuild multi-source pages over their remaining sources, then conditionally deletes the source file. The sidebar gains a `deleteBtn` beside `formatBtn`, both gated to source files of the active domain.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild (build + eval bundling), tsx, eslint. No new dependencies.

---

## Acceptance (from intent — verification target)

**Desired Outcomes:**
- Preview modal lists N pages to delete (with list) and M pages to rebuild (with list); deletion proceeds only on explicit confirm.
- Sole-source pages and the source file are removed; source dropped from `source_paths`/`analyzed_sources`; `_index.md` lines, graph edges, embedding chunks, and `wiki_articles` backlinks cleaned. Zero orphans.
- Multi-source pages rebuilt on remaining sources; deleted source's contribution gone; `wiki_sources` updated.
- Format and Delete are separate sidebar buttons, both enabled only on a source file (non-wiki, in `source_paths`).

**Done when:** On a real vault, clicking Delete shows correct counts/lists; on confirm the source file is permanently removed and dropped from domain config, every sole-source page is gone, every multi-source page is rebuilt on its remaining sources, and lint/check reports zero orphans/broken-links/stale artifacts — with any rebuild failures surfaced in the final report.

**Honored:** F-001 modal states deletion is permanent/not recoverable; F-002 source file deleted LAST and only when zero rebuild failures; permanent removal via `vaultTools.remove` (no trash); `validateArticlePath` on every deletion; works on mobile + both backends.

---

## File Structure

- **Create** `src/source-deletion.ts` — pure planner: `computeDeletionPlan`, `isSourceFile`, helpers `sourceStem`, `stripSourceToken`. No Obsidian/LLM imports.
- **Create** `src/phases/delete.ts` — `runDelete` async generator (orchestration, reuses `runIngest`).
- **Create** `eval/source-deletion/run.ts` + `eval/source-deletion/obsidian-stub.ts` — out-of-vault eval for the planner.
- **Create** `DeleteSourceModal` in `src/modals.ts` — preview/confirm modal.
- **Modify** `src/types.ts` — add `"delete"` to `WikiOperation`; add `source_path_removed` to `RunEvent`.
- **Modify** `src/domain.ts` — extend `DomainPersistEvent` + `applyDomainEvent` for `source_path_removed`.
- **Modify** `src/agent-runner.ts` — add `case "delete"`.
- **Modify** `src/controller.ts` — add `deleteSource(domainId, path)`; invalidate cache after delete.
- **Modify** `src/view.ts` — add `deleteBtn` (desktop + mobile); gate both Format and Delete via `isSourceFile`.
- **Modify** `src/i18n.ts` — add view/ctrl/modal strings (en/ru/es).

---

## Task 1: Pure planner `src/source-deletion.ts` (TDD via eval)

**Files:**
- Create: `src/source-deletion.ts`
- Create: `eval/source-deletion/obsidian-stub.ts`
- Test: `eval/source-deletion/run.ts`

- [ ] **Step 1: Write the eval (failing test) `eval/source-deletion/run.ts`**

```typescript
/**
 * Out-of-vault eval for the source-deletion planner. Exercises the REAL pure
 * functions from src/source-deletion.ts against synthetic fixtures. No vault, no LLM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/source-deletion/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./eval/source-deletion/obsidian-stub.ts \
 *     --outfile=eval/source-deletion/run.cjs
 *   node eval/source-deletion/run.cjs
 */
import { computeDeletionPlan, isSourceFile } from "../../src/source-deletion";
import type { DomainEntry } from "../../src/domain";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// Helper: build a wiki page body with a wiki_sources list.
function page(sources: string[]): string {
  const list = sources.map((s) => `  - "[[${s}]]"`).join("\n");
  return `---\nwiki_sources:\n${list}\n---\n# Page\n`;
}

section("computeDeletionPlan");
{
  const pages = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_a.md", page(["note"])],            // sole-source → delete
    ["!Wiki/work/Type/wiki_work_b.md", page(["note", "other"])],   // multi → rebuild on "other"
    ["!Wiki/work/Type/wiki_work_c.md", page(["unrelated"])],       // ignore
    ["!Wiki/work/Type/wiki_work_d.md", page(["note", "other"])],   // multi → shares "other"
  ]);
  const stemToPath = new Map<string, string>([
    ["other", "src/other.md"],
    ["unrelated", "src/unrelated.md"],
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, stemToPath);

  check("sole-source page goes to toDelete",
    plan.toDelete.includes("!Wiki/work/Type/wiki_work_a.md") && plan.toDelete.length === 1,
    JSON.stringify(plan.toDelete));
  check("multi-source pages go to toRebuild",
    plan.toRebuild.includes("!Wiki/work/Type/wiki_work_b.md") &&
    plan.toRebuild.includes("!Wiki/work/Type/wiki_work_d.md") && plan.toRebuild.length === 2,
    JSON.stringify(plan.toRebuild));
  check("unrelated page ignored",
    !plan.toDelete.includes("!Wiki/work/Type/wiki_work_c.md") &&
    !plan.toRebuild.includes("!Wiki/work/Type/wiki_work_c.md"));
  check("remainingSources deduped and excludes target",
    plan.remainingSources.length === 1 && plan.remainingSources[0] === "src/other.md",
    JSON.stringify(plan.remainingSources));
}

section("stem matching edge cases");
{
  const pages = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_x.md", page(["note-2"])], // must NOT match "note"
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, new Map());
  check("note does not false-match note-2",
    plan.toDelete.length === 0 && plan.toRebuild.length === 0, JSON.stringify(plan));

  const pages2 = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_y.md", page(["note", "ghost"])], // "ghost" resolves to nothing
  ]);
  const plan2 = computeDeletionPlan("src/note.md", pages2, new Map());
  check("unresolved remaining stem is dropped",
    plan2.toRebuild.length === 1 && plan2.remainingSources.length === 0, JSON.stringify(plan2));
}

section("isSourceFile");
{
  const domain = { id: "work", name: "Work", wiki_folder: "work", source_paths: ["src", "notes/foo.md"] } as DomainEntry;
  check("wiki page is not a source", isSourceFile("!Wiki/work/Type/wiki_work_a.md", domain) === false);
  check("file under source folder is a source", isSourceFile("src/note.md", domain) === true);
  check("exact file source entry matches", isSourceFile("notes/foo.md", domain) === true);
  check("unrelated file is not a source", isSourceFile("other/x.md", domain) === false);
}

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Create the obsidian stub `eval/source-deletion/obsidian-stub.ts`**

The planner imports nothing from `obsidian`, but the bundle pulls `src/domain.ts` (type-only `import type` — erased) and possibly i18n indirectly; provide the same minimal stub used by other evals to be safe.

```typescript
export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
```

- [ ] **Step 3: Run the eval to verify it FAILS (module not found)**

Run:
```bash
node_modules/.bin/esbuild eval/source-deletion/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/source-deletion/obsidian-stub.ts \
  --outfile=eval/source-deletion/run.cjs
```
Expected: esbuild FAILS with `Could not resolve "../../src/source-deletion"`.

- [ ] **Step 4: Implement `src/source-deletion.ts`**

```typescript
import type { DomainEntry } from "./domain";
import { WIKI_ROOT } from "./wiki-path";

export interface DeletionPlan {
  /** sole-source wiki page vault-paths (the deleted source is their only wiki_sources entry) */
  toDelete: string[];
  /** multi-source wiki page vault-paths (deleted source present, but other sources remain) */
  toRebuild: string[];
  /** dedup union of remaining source stems, resolved to source vault-paths (unresolved dropped) */
  remainingSources: string[];
}

/** Basename without the .md extension. */
export function sourceStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** Strip surrounding quotes and [[ ]] from a wiki_sources list entry → bare stem/title. */
export function stripSourceToken(token: string): string {
  return token.replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim();
}

/** Parse the wiki_sources list from a wiki page body into bare tokens. */
function wikiSourceTokens(content: string): string[] {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return [];
  const m = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fm[1]);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim())
    .filter(Boolean)
    .map(stripSourceToken);
}

/**
 * Compute what deleting `sourcePath` entails for a domain's wiki pages.
 * Pure: `pages` is wikiPagePath→content; `sourceStemToPath` maps remaining source
 * stems to their vault paths (must NOT include the deleted source).
 */
export function computeDeletionPlan(
  sourcePath: string,
  pages: Map<string, string>,
  sourceStemToPath: Map<string, string>,
): DeletionPlan {
  const target = sourceStem(sourcePath);
  const toDelete: string[] = [];
  const toRebuild: string[] = [];
  const remainingStems = new Set<string>();

  for (const [pagePath, content] of pages) {
    const tokens = wikiSourceTokens(content);
    if (!tokens.includes(target)) continue;
    if (tokens.length === 1) {
      toDelete.push(pagePath);
    } else {
      toRebuild.push(pagePath);
      for (const t of tokens) if (t !== target) remainingStems.add(t);
    }
  }

  const remainingSources: string[] = [];
  for (const stem of remainingStems) {
    const p = sourceStemToPath.get(stem);
    if (p) remainingSources.push(p);
  }

  return { toDelete, toRebuild, remainingSources };
}

/** True if `path` is a non-wiki source file of `domain` (member of source_paths). */
export function isSourceFile(path: string, domain: DomainEntry): boolean {
  if (path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`)) return false;
  if (!path.endsWith(".md")) return false;
  for (const sp of domain.source_paths ?? []) {
    const norm = sp.replace(/\/+$/, "");
    if (path === norm || path.startsWith(`${norm}/`)) return true;
  }
  return false;
}
```

- [ ] **Step 5: Rebuild and run the eval — verify PASS**

Run:
```bash
node_modules/.bin/esbuild eval/source-deletion/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/source-deletion/obsidian-stub.ts \
  --outfile=eval/source-deletion/run.cjs
node eval/source-deletion/run.cjs
```
Expected: `TOTAL: 11 passed, 0 failed`.

- [ ] **Step 6: Lint the new source file**

Run: `npm run lint`
Expected: no new errors for `src/source-deletion.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/source-deletion.ts eval/source-deletion/run.ts eval/source-deletion/obsidian-stub.ts eval/source-deletion/run.cjs
git commit -m "feat(delete): pure source-deletion planner + out-of-vault eval"
```

---

## Task 2: Types + domain event for `source_path_removed`

**Files:**
- Modify: `src/types.ts` (WikiOperation ~4-11, RunEvent ~41-92)
- Modify: `src/domain.ts` (`DomainPersistEvent` ~56, `applyDomainEvent` ~58-87)

- [ ] **Step 1: Add `"delete"` to `WikiOperation`** in `src/types.ts`

Replace the union (lines 4-11):
```typescript
export type WikiOperation =
  | "ingest"
  | "query"
  | "lint"
  | "lint-chat"
  | "chat"
  | "init"
  | "format"
  | "delete";
```

- [ ] **Step 2: Add `source_path_removed` to `RunEvent`** in `src/types.ts`

Immediately after the `source_path_added` line, add:
```typescript
  | { kind: "source_path_removed"; domainId: string; path: string }
```

- [ ] **Step 3: Extend `DomainPersistEvent`** in `src/domain.ts` (line 56)

```typescript
type DomainPersistEvent = Extract<RunEvent, { kind: "domain_created" | "domain_updated" | "source_path_added" | "source_path_removed" }>;
```

- [ ] **Step 4: Handle `source_path_removed` in `applyDomainEvent`** in `src/domain.ts`

Inside `applyDomainEvent`, after the `source_path_added` block (before the final `return next;`), add a dedicated branch. The cleanest place is right after the `const i = next.findIndex(...)` guard. Replace the tail of the function (from `if (ev.kind === "domain_updated")` onward) with:

```typescript
  if (ev.kind === "domain_updated") {
    next[i] = { ...next[i], ...ev.patch };
    return next;
  }
  if (ev.kind === "source_path_removed") {
    const existing = next[i].source_paths ?? [];
    const updated = existing.filter((p) => p !== ev.path);
    if (updated.length === existing.length) return domains; // no exact entry (folder-based source) → unchanged
    next[i] = { ...next[i], source_paths: updated };
    return next;
  }
  // source_path_added
  const existing = next[i].source_paths ?? [];
  let updated: string[];
  if (opts?.vaultRoot !== undefined) {
    updated = consolidateSourcePaths(existing, ev.path, opts.vaultRoot);
    if (updated === existing) return domains;
  } else {
    if (existing.includes(ev.path)) return domains;
    updated = [...existing, ev.path];
  }
  next[i] = { ...next[i], source_paths: updated };
  return next;
```

(Note: a source added as a folder leaves `source_paths` untouched when one file under it is deleted — correct; only `analyzed_sources` is trimmed, done by the phase via `domain_updated`.)

- [ ] **Step 5: Typecheck touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/(types|domain)\.ts' || echo "no new errors in touched files"`
Expected: `no new errors in touched files` (baseline tsc has pre-existing errors elsewhere — gate only on touched files).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/domain.ts
git commit -m "feat(delete): add delete operation + source_path_removed domain event"
```

---

## Task 3: Delete phase `src/phases/delete.ts`

**Files:**
- Create: `src/phases/delete.ts`

This phase recomputes the plan with `computeDeletionPlan` (single source of truth), wipes rebuild pages, re-ingests remaining sources (continue + collect errors), deletes sole-source pages, cleans backlinks, then deletes the source file LAST only if zero rebuild failures (F-002).

- [ ] **Step 1: Implement `src/phases/delete.ts`**

```typescript
import { isAbsolute, join } from "path-browserify";
import type { RunEvent } from "../types";
import type { VaultTools } from "../vault-tools";
import type { LlmClient } from "../llm/client";
import type { LlmCallOptions } from "../llm/types";
import type { DomainEntry } from "../domain";
import type { PageSimilarityService } from "../page-similarity";
import { domainWikiFolder, validateArticlePath } from "../wiki-path";
import { removeIndexAnnotation } from "../wiki-index";
import { pageId } from "../wiki-graph";
import { stripInvalidWikiArticles } from "../utils/raw-frontmatter";
import { computeDeletionPlan, sourceStem } from "../source-deletion";
import { runIngest } from "./ingest";

/**
 * Delete a source file and its wiki artifacts; rebuild multi-source pages on
 * their remaining sources. args = [sourceVaultPath, domainId].
 */
export async function* runDelete(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  graphDepth: number = 1,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const sourcePath = args[0];
  const domainId = args[1];
  if (!sourcePath || !domainId) {
    yield { kind: "error", message: "delete: source path and domain id required" };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const domain = domains.find((d) => d.id === domainId);
  if (!domain) {
    yield { kind: "error", message: `delete: domain ${domainId} not found` };
    yield { kind: "result", durationMs: Date.now() - start, text: "" };
    return;
  }
  const wikiFolder = domainWikiFolder(domain.wiki_folder);

  // --- Build pages map + remaining-source map (vaultTools-based) ---
  const pageFiles = (await vaultTools.listFiles(wikiFolder)).filter(
    (p) => p.endsWith(".md") && !p.includes("/_config/"),
  );
  const pages = new Map<string, string>();
  for (const p of pageFiles) {
    try { pages.set(p, await vaultTools.read(p)); } catch { /* skip unreadable */ }
  }
  const sourceStemToPath = new Map<string, string>();
  for (const sp of domain.source_paths ?? []) {
    let files: string[];
    try { files = await vaultTools.listFiles(sp); } catch { files = []; }
    for (const f of files) {
      if (!f.endsWith(".md") || f === sourcePath) continue;
      sourceStemToPath.set(sourceStem(f), f);
    }
    // sp itself may be a single .md file source
    if (sp.endsWith(".md") && sp !== sourcePath) sourceStemToPath.set(sourceStem(sp), sp);
  }

  const plan = computeDeletionPlan(sourcePath, pages, sourceStemToPath);
  yield {
    kind: "info_text", icon: "trash", summary: `Deleting source: ${sourceStem(sourcePath)}`,
    details: [`${plan.toDelete.length} page(s) to delete`, `${plan.toRebuild.length} page(s) to rebuild`],
  };

  // --- 1. Drop source from domain config (source_paths + analyzed_sources) ---
  yield { kind: "source_path_removed", domainId, path: sourcePath };
  const targetStem = sourceStem(sourcePath);
  const prunedAnalyzed = (domain.analyzed_sources ?? []).filter(
    (a) => a !== sourcePath && sourceStem(a) !== targetStem,
  );
  if (prunedAnalyzed.length !== (domain.analyzed_sources ?? []).length) {
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: prunedAnalyzed } };
  }

  const safeRemovePage = async (p: string): Promise<boolean> => {
    if (!validateArticlePath(p, wikiFolder)) return false;
    try { await vaultTools.remove(p); await removeIndexAnnotation(vaultTools, wikiFolder, pageId(p)); return true; }
    catch { return false; }
  };

  // --- 2. Wipe rebuild pages ---
  for (const p of plan.toRebuild) {
    if (signal.aborted) break;
    if (!(await safeRemovePage(p))) {
      yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
    }
  }

  // --- 3. Rebuild: re-ingest each remaining source (continue + collect) ---
  const failedSources: string[] = [];
  for (const src of plan.remainingSources) {
    if (signal.aborted) break;
    let sourceFailed = false;
    try {
      for await (const ev of runIngest(
        [src], vaultTools, llm, model, domains, vaultRoot, signal, opts,
        similarity, undefined, graphDepth, wikiLinkValidationRetries,
      )) {
        if (ev.kind === "error") sourceFailed = true;
        yield ev;
      }
    } catch (e) {
      sourceFailed = true;
      yield { kind: "error", message: `Rebuild failed for ${src}: ${(e as Error).message}` };
    }
    if (sourceFailed) failedSources.push(src);
  }

  // --- 4. Delete sole-source pages ---
  let deleted = 0;
  for (const p of plan.toDelete) {
    if (signal.aborted) break;
    if (await safeRemovePage(p)) deleted++;
    else yield { kind: "info_text", icon: "alert-triangle", summary: `Skipped invalid path: ${p}` };
  }

  // --- 5. Backlink cleanup: strip references to now-missing pages from source files ---
  const remainingPageStems = new Set(
    (await vaultTools.listFiles(wikiFolder))
      .filter((p) => p.endsWith(".md") && !p.includes("/_config/"))
      .map((p) => pageId(p)),
  );
  for (const src of sourceStemToPath.values()) {
    try {
      const content = await vaultTools.read(src);
      const { content: cleaned, warnings } = stripInvalidWikiArticles(content, remainingPageStems);
      if (warnings.length > 0 && cleaned !== content) await vaultTools.write(src, cleaned);
    } catch { /* skip */ }
  }

  // --- 6. Delete source file LAST, only if no rebuild failures (F-002) ---
  let sourceRemoved = false;
  if (failedSources.length === 0) {
    try { await vaultTools.remove(sourcePath); sourceRemoved = true; }
    catch (e) { yield { kind: "error", message: `Could not delete source file: ${(e as Error).message}` }; }
  }

  // --- 7. Result ---
  const parts = [
    `Deleted source ${targetStem}`,
    `pages deleted ${deleted}`,
    `rebuilt ${plan.toRebuild.length}`,
  ];
  if (failedSources.length > 0) {
    parts.push(`${failedSources.length} rebuild failure(s)`);
    parts.push(sourceRemoved ? "" : "source kept — retry");
  }
  const text = parts.filter(Boolean).join(", ") + ".";
  if (failedSources.length > 0) {
    yield { kind: "info_text", icon: "alert-triangle", summary: "Rebuild failures", details: failedSources };
  }
  yield { kind: "result", durationMs: Date.now() - start, text };
}
```

- [ ] **Step 2: Verify the import paths resolve**

The imports `../llm/client`, `../llm/types`, `../page-similarity`, `../utils/raw-frontmatter` must match how `src/phases/ingest.ts` imports the same symbols. Open `src/phases/ingest.ts` top imports and copy the exact module specifiers for `LlmClient`, `LlmCallOptions`, `PageSimilarityService`, `RunEvent`, `VaultTools`, `DomainEntry`. Adjust the import lines above to match verbatim.

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/phases/delete\.ts' || echo "delete.ts clean"`
Expected: `delete.ts clean`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors for `src/phases/delete.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/phases/delete.ts
git commit -m "feat(delete): runDelete phase — wipe, rebuild via runIngest, conditional source removal"
```

---

## Task 4: Wire the phase into `AgentRunner`

**Files:**
- Modify: `src/agent-runner.ts` (switch ~111-155)

- [ ] **Step 1: Import `runDelete`**

Add near the other phase imports at the top of `src/agent-runner.ts`:
```typescript
import { runDelete } from "./phases/delete";
```

- [ ] **Step 2: Add the `case "delete"` to the dispatch switch**

Insert before the `default:` case (mirror the `ingest` arg list):
```typescript
      case "delete":
        yield* runDelete(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, this.settings.graphDepth, this.settings.wikiLinkValidationRetries);
        break;
```

- [ ] **Step 3: Typecheck touched file**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/agent-runner\.ts' || echo "agent-runner clean"`
Expected: `agent-runner clean`.

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(delete): dispatch delete operation to runDelete"
```

---

## Task 5: `DeleteSourceModal`

**Files:**
- Modify: `src/modals.ts` (add the class, alongside `ManageSourcesModal` ~557)
- Modify: `src/i18n.ts` (modal strings)

This task precedes the controller task because `controller.deleteSource` (Task 6) imports `DeleteSourceModal`; the modal must exist first so each task typechecks in isolation.

- [ ] **Step 1: Add modal strings to `src/i18n.ts`**

In the `modal` section of the `en` bundle, add (then mirror in `ru` and `es` — TypeScript will error until all three match):
```typescript
    deleteSourceTitle: (name: string) => `Delete source: «${name}»`,
    deleteSourceWarning: "This permanently deletes the source file and cannot be undone (not recoverable from trash).",
    deleteSourceDeleteCount: (n: number) => `${n} wiki page(s) will be deleted:`,
    deleteSourceRebuildCount: (n: number) => `${n} wiki page(s) will be rebuilt on remaining sources:`,
    deleteSourceConfirm: "Delete",
```
ru:
```typescript
    deleteSourceTitle: (name: string) => `Удалить источник: «${name}»`,
    deleteSourceWarning: "Источник будет удалён безвозвратно и не восстановится из корзины.",
    deleteSourceDeleteCount: (n: number) => `Будет удалено wiki-страниц: ${n}:`,
    deleteSourceRebuildCount: (n: number) => `Будет пересобрано wiki-страниц: ${n}:`,
    deleteSourceConfirm: "Удалить",
```
es:
```typescript
    deleteSourceTitle: (name: string) => `Eliminar fuente: «${name}»`,
    deleteSourceWarning: "La fuente se eliminará de forma permanente y no se puede recuperar de la papelera.",
    deleteSourceDeleteCount: (n: number) => `Se eliminarán ${n} página(s) wiki:`,
    deleteSourceRebuildCount: (n: number) => `Se reconstruirán ${n} página(s) wiki en las fuentes restantes:`,
    deleteSourceConfirm: "Eliminar",
```

- [ ] **Step 2: Add the `DeleteSourceModal` class to `src/modals.ts`**

```typescript
export class DeleteSourceModal extends Modal {
  constructor(
    app: App,
    private domainId: string,
    private sourcePath: string,
    private plan: import("./source-deletion").DeletionPlan,
    private onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    const name = this.sourcePath.split("/").pop() ?? this.sourcePath;
    contentEl.createEl("h3", { text: T.deleteSourceTitle(name) });

    const warn = contentEl.createEl("p", { text: T.deleteSourceWarning });
    warn.style.color = "var(--text-error)";

    if (this.plan.toDelete.length > 0) {
      contentEl.createEl("p", { text: T.deleteSourceDeleteCount(this.plan.toDelete.length) });
      const ul = contentEl.createEl("ul");
      for (const p of this.plan.toDelete) ul.createEl("li", { text: p.split("/").pop() ?? p });
    }
    if (this.plan.toRebuild.length > 0) {
      contentEl.createEl("p", { text: T.deleteSourceRebuildCount(this.plan.toRebuild.length) });
      const ul = contentEl.createEl("ul");
      for (const p of this.plan.toRebuild) ul.createEl("li", { text: p.split("/").pop() ?? p });
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(T.deleteSourceConfirm).setWarning().onClick(() => {
          this.onConfirm();
          this.close();
        }),
      );
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/(modals|i18n)\.ts' || echo "modals/i18n clean"`
Expected: `modals/i18n clean`.
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modals.ts src/i18n.ts
git commit -m "feat(delete): DeleteSourceModal with permanent-deletion warning + counts"
```

---

## Task 6: Controller `deleteSource(domainId, path)`

**Files:**
- Modify: `src/controller.ts` (near `format()` ~68-102 and `cleanupRemovedSources` ~381-404)

Depends on Task 5 (`DeleteSourceModal`) and Task 1 (`computeDeletionPlan`, `sourceStem`).

- [ ] **Step 1: Add the `deleteSource` method**

Add a public method (place it next to `cleanupRemovedSources`). It builds the preview maps with `app.vault`, computes the plan, opens the modal, and dispatches on confirm. Reuse `graphCache` already imported in the file.

```typescript
async deleteSource(domainId: string, path: string): Promise<void> {
  const domains = await this.loadDomains();
  const entry = domains.find((d) => d.id === domainId);
  if (!entry) { new Notice(i18n().ctrl.noActiveFile); return; }

  const wikiFolder = domainWikiFolder(entry.wiki_folder);
  const pageFiles = collectMdInPaths(this.app.vault, [wikiFolder])
    .filter((f) => !f.path.includes("/_config/"));
  const pages = new Map<string, string>();
  for (const f of pageFiles) {
    try { pages.set(f.path, await this.app.vault.adapter.read(f.path)); } catch { /* skip */ }
  }

  const sourceStemToPath = new Map<string, string>();
  for (const f of collectMdInPaths(this.app.vault, entry.source_paths ?? [])) {
    if (f.path !== path) sourceStemToPath.set(sourceStem(f.path), f.path);
  }
  for (const sp of entry.source_paths ?? []) {
    if (sp.endsWith(".md") && sp !== path && this.app.vault.getFileByPath(sp)) {
      sourceStemToPath.set(sourceStem(sp), sp);
    }
  }

  const plan = computeDeletionPlan(path, pages, sourceStemToPath);

  new DeleteSourceModal(this.app, entry.id, path, plan, () => {
    void this.dispatch("delete", [path, domainId], domainId).then(() => {
      graphCache.invalidate(domainId);
    });
  }).open();
}
```

- [ ] **Step 2: Add the imports**

Ensure these are imported at the top of `src/controller.ts` (add the missing ones):
```typescript
import { computeDeletionPlan, sourceStem } from "./source-deletion";
import { DeleteSourceModal } from "./modals";
```
(`collectMdInPaths`, `parseWikiSources`, `domainWikiFolder`, `graphCache`, `i18n`, `Notice` are already imported — verify and only add what's missing.)

- [ ] **Step 3: Typecheck touched file**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/controller\.ts' || echo "controller clean (new code)"`
Expected: no NEW errors referencing the added lines (pre-existing baseline errors elsewhere are out of scope).

- [ ] **Step 4: Commit**

```bash
git add src/controller.ts
git commit -m "feat(delete): controller.deleteSource builds preview plan and dispatches"
```

---

## Task 7: Sidebar `deleteBtn` + shared `isSourceFile` gating

**Files:**
- Modify: `src/view.ts` (button fields ~94-99, desktop row ~346-349, mobile row ~180, `updateButtonAvailability` ~388-399)

- [ ] **Step 1: Add the `delete` i18n string**

In `src/i18n.ts` `view` section, add `delete: "Delete"` (en), `delete: "Удалить"` (ru), `delete: "Eliminar"` (es). (Added before the buttons so the button code typechecks against an existing key.)

- [ ] **Step 2: Declare the button field**

Add to the button field declarations (~line 94-99):
```typescript
private deleteBtn?: HTMLButtonElement;
```

- [ ] **Step 3: Create the desktop Delete button**

After the desktop `formatBtn` creation (line 349), add:
```typescript
this.deleteBtn = actionRow.createEl("button", { text: i18n().view.delete });
this.deleteBtn.addEventListener("click", () => {
  const file = this.plugin.app.workspace.getActiveFile();
  const domainId = this.domainSelect?.value;
  if (file && domainId) void this.plugin.controller.deleteSource(domainId, file.path);
});
```

- [ ] **Step 4: Create the mobile Delete button**

After the mobile `formatBtn` creation (line 180), add the same button on `mobileActions`:
```typescript
this.deleteBtn = mobileActions.createEl("button", { text: i18n().view.delete });
this.deleteBtn.addEventListener("click", () => {
  const file = this.plugin.app.workspace.getActiveFile();
  const domainId = this.domainSelect?.value;
  if (file && domainId) void this.plugin.controller.deleteSource(domainId, file.path);
});
```

- [ ] **Step 5: Update `updateButtonAvailability()` to gate Format + Delete by `isSourceFile`**

Replace the method (lines 388-399):
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

- [ ] **Step 6: Import `isSourceFile`**

At the top of `src/view.ts`:
```typescript
import { isSourceFile } from "./source-deletion";
```

- [ ] **Step 7: Typecheck + lint + build**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/view\.ts' || echo "view clean"`
Expected: `view clean`.
Run: `npm run lint` → no new errors.
Run: `npm run build` → builds `main.js` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/view.ts src/i18n.ts
git commit -m "feat(delete): sidebar Delete button + isSourceFile gating for Format/Delete"
```

---

## Task 8: Final verification + docs

**Files:**
- Modify: `docs/wiki/*` (via iwiki) for the new operation + sidebar change.

- [ ] **Step 1: Full build + lint + eval**

```bash
npm run build && npm run lint && \
node_modules/.bin/esbuild eval/source-deletion/run.ts --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/source-deletion/obsidian-stub.ts --outfile=eval/source-deletion/run.cjs && \
node eval/source-deletion/run.cjs
```
Expected: build OK, lint clean, eval `TOTAL: 11 passed, 0 failed`.

- [ ] **Step 2: Real-vault manual run (HUMAN CHECKPOINT — intent Autonomy: proposal-first)**

Do NOT run destructive deletion on a real vault without the user present. With the user:
1. Pick a domain with a sole-source page AND a multi-source page.
2. Open a source file → confirm Format AND Delete buttons are enabled; open a wiki page or unrelated file → confirm both disabled.
3. Click Delete → verify the modal shows the correct N delete / M rebuild counts and lists, plus the permanent-deletion warning.
4. Confirm → verify: source file gone; sole-source page gone; multi-source page rebuilt on remaining sources (open it, check `wiki_sources` no longer lists the deleted source); `_index.md` has no orphan line for the deleted page.
5. Run the wiki health check (`/iwiki-lint` or `lat check` per the project) → zero orphans/broken links/stale artifacts.
6. Negative path: delete a source whose rebuild is forced to fail (e.g. disconnect the LLM) → verify the source file is KEPT and the result reports the failure (F-002).

Expected: all observable outcomes from "Done when" hold.

- [ ] **Step 3: Update docs/wiki via iwiki (CLAUDE.md post-task requirement)**

```
Skill(iwiki:iwiki-ingest, "src/phases/delete.ts")
Skill(iwiki:iwiki-ingest, "src/source-deletion.ts")
Skill(iwiki:iwiki-ingest, "src/view.ts")
```
Then `/iwiki-lint` — fix any broken `[[refs]]`, orphan, or stale pages.

- [ ] **Step 4: Commit docs + open PR**

```bash
git add docs/
git commit -m "docs(wiki): document delete-source operation + sidebar Delete button"
```
Then push the branch and open a PR targeting `master` (HUMAN CHECKPOINT — intent Autonomy: proposal-first; project branch rule dev/* → PR → master):
```bash
git push -u origin dev/source-deletion
gh pr create --base master --title "feat: delete source operation with wiki cleanup + rebuild" --body "Implements docs/superpowers/intents/2026-06-21-source-deletion-intent.md"
```

---

## Self-Review notes

- **Spec coverage:** R1 planner → Task 1; R2 phase/operation → Tasks 2-4; R3 UI (modal + buttons + gating) → Tasks 5-7 (modal = Task 5, controller = Task 6, sidebar = Task 7); R4 error handling (continue+collect, validateArticlePath, F-002) → Task 3; R5 tests → Task 1 eval + Task 8 manual run. Preview counts (Outcome #1) → Task 5 (modal) + Task 6 (plan computation). Full cleanup (Outcome #2) → Task 3 steps 1,4,5,6 + cache invalidate Task 6. Rebuild (Outcome #3) → Task 3 step 3. Separate gated buttons (Outcome #4) → Task 7.
- **Type consistency:** `computeDeletionPlan(sourcePath, pages, sourceStemToPath)`, `isSourceFile(path, domain)`, `sourceStem(path)`, `DeletionPlan{toDelete,toRebuild,remainingSources}`, `runDelete(args=[sourcePath,domainId], ...)`, event `source_path_removed{domainId,path}` — used identically across Tasks 1-7.
- **Known limitation (documented):** stem-based source matching; `wiki_sources` entries stored as titles that differ from the file stem are not matched (lint's residual cleanup handles those). Sources added as a folder keep their `source_paths` folder entry after one file is deleted (only `analyzed_sources` is trimmed).
