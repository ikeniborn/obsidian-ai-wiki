---
review:
  plan_hash: 008fa7e4b73a5fd4
  spec_hash: 6ebbab4dd08e0a6a
  last_run: 2026-06-25
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "Self-Review (against the spec)"
      section_hash: null
      text: "Spec has no literal R1-R9/SC numbered list; the plan synthesises those labels from the spec's Components/Stop-rules. Mappings verified faithful."
      verdict: accepted
      verdict_at: 2026-06-25
    - id: F-002
      phase: coverage
      severity: INFO
      section: "Task 1 / Verification plan"
      section_hash: null
      text: "Spec Verification tier #3 (node-fs integration) is not a separate plan task; covered by the pure eval + Task 4 manual e2e. Accepted."
      verdict: accepted
      verdict_at: 2026-06-25
    - id: F-003
      phase: dependencies
      severity: INFO
      section: "Task 1 sequencing note / Task 3 grouping"
      section_hash: null
      text: "Two acknowledged cross-task choices (T1 eval imports T2's migrateDomainsV3; T3 co-lands all type consumers). Both judged adequately resolved by the plan's explicit notes."
      verdict: accepted
      verdict_at: 2026-06-25
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-25-incremental-source-hash-design.md
---
# Incremental Source-Hash Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect changed sources for incremental re-init by hashing the source body and persisting the hash wiki-side in `_domain.json`, replacing the broken mtime comparison that re-flags unchanged sources forever.

**Architecture:** A pure FNV-1a hash of the source body (frontmatter stripped) is the freshness signal. The hash is stored in the domain registry field `analyzed_sources`, which changes from `string[]` to `Record<sourcePath, hash>` (single source of truth; key present = ingested, value = body hash, `""` = baseline pending). Detection compares the current body hash to the stored one; a v3 migration converts the legacy list to a map; a silent baseline fills empty hashes on the first plan without re-ingesting.

**Tech Stack:** TypeScript, Obsidian plugin, esbuild bundling, out-of-vault eval harness run via `npx tsx eval/<dir>/run.ts` (no jest/vitest).

## Global Constraints

- Detection module `src/incremental-sources.ts` stays **pure** — no `obsidian`/IO imports (out-of-vault testable via `tsx`).
- Source `.md` files are **never written** for hash bookkeeping; all state lives in `_config/_domain.json`.
- Hash = body only (frontmatter stripped, trailing whitespace trimmed); value format `"fnv1a:<8 hex>"`.
- Lint gate: `npm run lint` (eslint over `src/**/*.ts`) must pass on touched files. Node builtins, if any, must stay lazy + desktop-guarded (not needed here — pure JS only).
- tsc baseline is NOT clean repo-wide; gate on **no new tsc errors in touched files**, not "tsc clean".
- Build: `npm run build` (esbuild) must succeed.
- Eval: `npx tsx eval/incremental-sources/run.ts` must print `0 failed`.
- Branch `dev/incremental-source-hash` (already created, in place). Commit per task.

---

### Task 1: Pure hash helpers + detection rewrite (`incremental-sources.ts`)

**Files:**
- Modify: `src/incremental-sources.ts`
- Test: `eval/incremental-sources/run.ts` (rewrite — the existing file tests the old mtime detection and will not compile against the new signature)
- Delete: `eval/incremental-sources/run.cjs` (stale esbuild artifact; the eval runs via `tsx`)

**Interfaces:**
- Produces:
  - `sourceBodyForHash(content: string): string`
  - `hashSource(content: string): string` → `"fnv1a:<hex>"`
  - `computeChangedSources({ sourceFiles: SourceFileInfo[]; analyzed: Record<string,string> }): { changed: string[]; baselined: Record<string,string> }`
  - `interface SourceFileInfo { path: string; hash: string }`
  - Unchanged exports kept: `parsePageSources`, `capList`.
- Note: `interface WikiPageInfo` and the `mtime` field on `SourceFileInfo` are **removed**.

- [ ] **Step 1: Rewrite the eval to the hash-based contract (failing test)**

Replace the entire contents of `eval/incremental-sources/run.ts` with:

```ts
/**
 * Out-of-vault eval for incremental source-hash detection.
 * Exercises the REAL pure functions from src/ — no Obsidian, no LLM, no fs.
 * Run: npx tsx eval/incremental-sources/run.ts
 */
import {
  computeChangedSources, hashSource, sourceBodyForHash, capList, parsePageSources,
} from "../../src/incremental-sources";
import { migrateDomainsV3, type DomainEntry } from "../../src/domain";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// =====================================================================
section("sourceBodyForHash + hashSource");

check("strips leading frontmatter",
  sourceBodyForHash("---\nwiki_updated: 2026-06-25\n---\nbody text") === "body text");
check("no-frontmatter passthrough (trailing trimmed)",
  sourceBodyForHash("plain body\n\n") === "plain body");
check("hashSource has fnv1a prefix + 8 hex",
  /^fnv1a:[0-9a-f]{8}$/.test(hashSource("---\na: 1\n---\nhello")));
check("deterministic",
  hashSource("---\nx: 1\n---\nB") === hashSource("---\nx: 1\n---\nB"));
check("frontmatter-only edit → SAME hash",
  hashSource("---\nwiki_updated: 2026-06-01\n---\nBODY") ===
  hashSource("---\nwiki_updated: 2026-06-25\nwiki_articles:\n  - \"[[p]]\"\n---\nBODY"));
check("body edit → DIFFERENT hash",
  hashSource("---\nx: 1\n---\nBODY one") !== hashSource("---\nx: 1\n---\nBODY two"));

// =====================================================================
section("computeChangedSources — hash rules");

// 1: no stored key → changed (new source)
check("1 new source (no key) → changed", JSON.stringify(computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:00000001" }],
  analyzed: {},
}).changed) === JSON.stringify(["s/a.md"]));

// 2: stored "" → silent baseline (not changed, returned in baselined)
check("2 empty stored → baselined, not changed", (() => {
  const r = computeChangedSources({
    sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000beef" }],
    analyzed: { "s/a.md": "" },
  });
  return r.changed.length === 0 && r.baselined["s/a.md"] === "fnv1a:0000beef";
})());

// 3: equal hash → skip
check("3 equal hash → not changed", computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000aaaa" }],
  analyzed: { "s/a.md": "fnv1a:0000aaaa" },
}).changed.length === 0);

// 4: differing hash → changed
check("4 differing hash → changed", computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000aaaa" }],
  analyzed: { "s/a.md": "fnv1a:0000bbbb" },
}).changed[0] === "s/a.md");

// 5: strict subset — only the edited one
check("5 strict subset", (() => {
  const r = computeChangedSources({
    sourceFiles: [
      { path: "s/a.md", hash: "fnv1a:0000aaaa" }, // matches stored → skip
      { path: "s/b.md", hash: "fnv1a:0000ffff" }, // differs → changed
    ],
    analyzed: { "s/a.md": "fnv1a:0000aaaa", "s/b.md": "fnv1a:00001111" },
  });
  return JSON.stringify(r.changed) === JSON.stringify(["s/b.md"]) && Object.keys(r.baselined).length === 0;
})());

// =====================================================================
section("migrateDomainsV3 — list → map");

check("6 list → map of empty hashes + flag", (() => {
  const domains = [{ id: "d", name: "D", wiki_folder: "d",
    analyzed_sources: ["x.md", "y.md"], analyzed_sources_v2: true } as unknown as DomainEntry];
  const { migrated } = migrateDomainsV3(domains);
  const m = domains[0].analyzed_sources as unknown as Record<string, string>;
  return migrated === true && m["x.md"] === "" && m["y.md"] === "" && domains[0].analyzed_sources_v3 === true;
})());

check("7 idempotent (already v3) → no change", (() => {
  const domains = [{ id: "d", name: "D", wiki_folder: "d",
    analyzed_sources: { "x.md": "fnv1a:0000aaaa" }, analyzed_sources_v2: true,
    analyzed_sources_v3: true } as unknown as DomainEntry];
  const { migrated } = migrateDomainsV3(domains);
  const m = domains[0].analyzed_sources as unknown as Record<string, string>;
  return migrated === false && m["x.md"] === "fnv1a:0000aaaa";
})());

// =====================================================================
section("capList");
check("8 capList under cap returns all", (() => {
  const r = capList(["a", "b"], 20); return r.shown.length === 2 && r.overflow === 0;
})());
check("9 capList over cap truncates + overflow", (() => {
  const names = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const r = capList(names, 20); return r.shown.length === 20 && r.overflow === 5;
})());

// =====================================================================
section("parsePageSources — real on-disk wiki_sources shapes");
check("pp double-quoted wikilink → bare stem",
  JSON.stringify(parsePageSources('---\nwiki_sources:\n  - "[[alpha]]"\n---\nx')) === JSON.stringify(["alpha"]));
check("pp no wiki_sources → []",
  parsePageSources('---\ntitle: x\n---\nbody').length === 0);

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Run the eval to verify it fails**

Run: `npx tsx eval/incremental-sources/run.ts`
Expected: FAIL/throw — `hashSource`, `sourceBodyForHash`, `migrateDomainsV3` are not exported yet (and `computeChangedSources` has the old signature). A type/import error or failing checks is the expected red.

- [ ] **Step 3: Implement the helpers + detection rewrite**

In `src/incremental-sources.ts`, replace the `SourceFileInfo` / `WikiPageInfo` interfaces and `computeChangedSources` (lines 11–43) with:

```ts
export interface SourceFileInfo {
  /** Vault-relative source path; returned verbatim in `changed`. */
  path: string;
  /** Current body-content hash (see hashSource). */
  hash: string;
}

/**
 * Source content with the leading YAML frontmatter block removed and trailing
 * whitespace trimmed. Whole content (trimmed) when there is no frontmatter.
 * The plugin-managed wiki_* frontmatter and Obsidian touch/sync never reach the
 * hash, so only real body edits change it.
 */
export function sourceBodyForHash(content: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(content);
  const body = m ? content.slice(m[0].length) : content;
  return body.replace(/\s+$/, "");
}

/** FNV-1a 32-bit over a string → 8-char lowercase hex. Pure, no deps. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Content hash of a source's body → "fnv1a:<hex>". Prefix gates future algos. */
export function hashSource(content: string): string {
  return "fnv1a:" + fnv1a(sourceBodyForHash(content));
}

/**
 * Pure changed-source detection by content hash.
 * - source path absent from `analyzed`            → changed (new / never ingested)
 * - stored hash is ""                             → silent baseline (return in `baselined`, not changed)
 * - stored hash differs from current              → changed (body edited)
 * - stored hash equals current                    → skip
 * `baselined` is the set the caller must persist into the domain entry (migration
 * fill — no ingest).
 */
export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];
  analyzed: Record<string, string>;
}): { changed: string[]; baselined: Record<string, string> } {
  const { sourceFiles, analyzed } = input;
  const changed: string[] = [];
  const baselined: Record<string, string> = {};
  for (const src of sourceFiles) {
    const stored = analyzed[src.path];
    if (stored === undefined) { changed.push(src.path); continue; }
    if (stored === "") { baselined[src.path] = src.hash; continue; }
    if (stored !== src.hash) changed.push(src.path);
  }
  return { changed, baselined };
}
```

Also update the module doc-comment header (lines 1–9) to describe hash-based detection instead of mtime. Leave `parsePageSources` and `capList` untouched.

- [ ] **Step 4: Run the eval to verify it passes**

Run: `npx tsx eval/incremental-sources/run.ts`
Expected: `TOTAL: N passed, 0 failed` (Task-2 migration tests 6–7 also pass because `migrateDomainsV3` is added in Task 2 — if running Task 1 in isolation before Task 2, tests 6–7 fail on the missing export; that is expected until Task 2 lands).

> Sequencing note: Step 1's eval imports `migrateDomainsV3` (Task 2). Implement Task 2 immediately after Task 1 so the eval goes fully green. If you prefer a green eval at the end of Task 1, temporarily comment out the `migrateDomainsV3` section and its import, then restore it in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/incremental-sources.ts eval/incremental-sources/run.ts
git rm eval/incremental-sources/run.cjs
git commit -m "feat(incremental): hash-based source change detection (pure)"
```

---

### Task 2: Data model + v3 migration (`domain.ts`, `domain-store.ts`)

**Files:**
- Modify: `src/domain.ts:12-34` (type + migration)
- Modify: `src/domain-store.ts:35-37` (wire v3 into load)
- Test: `eval/incremental-sources/run.ts` (migration tests 6–7, added in Task 1)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `DomainEntry.analyzed_sources?: Record<string, string>`
  - `DomainEntry.analyzed_sources_v3?: boolean`
  - `migrateDomainsV3(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean }`

- [ ] **Step 1: Change the type and add the v3 migration**

In `src/domain.ts`, change the `DomainEntry` field (line 19) and add the v3 flag:

```ts
  analyzed_sources?: Record<string, string>;  // source vault path → body hash ("" = baseline pending)
  analyzed_sources_v2?: boolean;
  analyzed_sources_v3?: boolean;               // list → map migration flag
```

Add after `migrateDomainsV2` (after line 34):

```ts
/**
 * v3: convert legacy `analyzed_sources` (string[]) → map (path → ""), so the
 * value can hold the source body hash. Empty hashes are filled by the silent
 * baseline on the first incremental plan. Pure (no vault access).
 */
export function migrateDomainsV3(domains: DomainEntry[]): { domains: DomainEntry[]; migrated: boolean } {
  let migrated = false;
  for (const d of domains) {
    if (d.analyzed_sources_v3) continue;
    const cur = d.analyzed_sources as unknown;
    if (Array.isArray(cur)) {
      const map: Record<string, string> = {};
      for (const p of cur) map[String(p)] = "";
      d.analyzed_sources = map;
    }
    // when cur is already an object (or undefined) there is nothing to convert
    d.analyzed_sources_v3 = true;
    migrated = true;
  }
  return { domains, migrated };
}
```

- [ ] **Step 2: Wire v3 into `DomainStore.load`**

In `src/domain-store.ts`, import and run v3 alongside v2. Change the import (line 3):

```ts
import { migrateDomainsV2, migrateDomainsV3 } from "./domain";
```

Replace lines 35–36:

```ts
    const { migrated: m2 } = migrateDomainsV2(domains);
    const { migrated: m3 } = migrateDomainsV3(domains);
    if (m2 || m3) await this.save(domains);
```

- [ ] **Step 3: Run the eval to verify migration tests pass**

Run: `npx tsx eval/incremental-sources/run.ts`
Expected: `TOTAL: N passed, 0 failed` — migration tests 6 (list→map) and 7 (idempotent) now pass.

- [ ] **Step 4: Commit**

```bash
git add src/domain.ts src/domain-store.ts
git commit -m "feat(domain): analyzed_sources map + v3 migration"
```

---

### Task 3: Wire the map through consumers + hash-at-ingest

This is the type-ripple task: `analyzed_sources` is now a map everywhere it is read/written. All consumers land together so `npm run build` and `npm run lint` pass at the end.

**Files:**
- Modify: `src/types.ts:65` (domain_updated patch type)
- Modify: `src/controller.ts:355-401` (`computeIncrementalPlan` rewrite + persist baselined) and `src/controller.ts:29` (imports)
- Modify: `src/phases/init.ts` (lines 155-159, 283-285, 295, 350-363, 438-444)
- Modify: `src/phases/delete.ts:74-78`

**Interfaces:**
- Consumes: `hashSource`, `computeChangedSources`, `SourceFileInfo` (Task 1); `analyzed_sources: Record<string,string>` (Task 2).
- Produces: `computeIncrementalPlan` still returns `{ changed: string[]; totalSources: number; wikiFileCount: number }` (shape unchanged).

- [ ] **Step 1: Update the `domain_updated` patch type**

In `src/types.ts` line 65, change `analyzed_sources?: string[]` → `analyzed_sources?: Record<string, string>`:

```ts
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string; wiki_folder?: string; analyzed_sources?: Record<string, string> } }
```

- [ ] **Step 2: Rewrite `computeIncrementalPlan` (hash-based + persist baseline)**

In `src/controller.ts`, update the import (line 29):

```ts
import { computeChangedSources, hashSource, type SourceFileInfo } from "./incremental-sources";
```

(`parsePageSources` and `WikiPageInfo` are no longer imported here.)

Replace the body of `computeIncrementalPlan` from the `sourceFiles` gathering through the return (lines 385–400) with:

```ts
    const analyzed = entry.analyzed_sources ?? {};
    const sourceFiles: SourceFileInfo[] = [];
    for (const f of sourceTFiles) {
      let content = "";
      try { content = await this.app.vault.adapter.read(f.path); } catch { /* unreadable → empty body hash */ }
      sourceFiles.push({ path: f.path, hash: hashSource(content) });
    }

    const wikiFileCount = collectMdInPaths(this.app.vault, [domainWikiFolder(entry.wiki_folder)])
      .filter((f) => !f.path.includes("/_config/")).length;

    const { changed, baselined } = computeChangedSources({ sourceFiles, analyzed });

    // Silent baseline: persist hashes for already-ingested sources that had none.
    if (Object.keys(baselined).length > 0) {
      const merged = { ...analyzed, ...baselined };
      const next = domains.map((d) => (d.id === domainId ? { ...d, analyzed_sources: merged } : d));
      await this.domainStore.save(next);
    }

    return { changed, totalSources: sourceFiles.length, wikiFileCount };
```

Delete the now-removed `vaultTools` construction and the `wikiPages` loop in this function (lines 367–371 `VaultTools` + 390–397). Update the doc-comment (lines 355–358) to say detection is by body hash. Keep `toVaultRel` and the `sourceTFiles` gathering (lines 372–384) unchanged.

> If `VaultTools` is now unused in `controller.ts`, remove its import. Verify with `grep -n "VaultTools" src/controller.ts` after the edit.

- [ ] **Step 3: Write the source hash at the two ingest bookkeeping spots (`init.ts`)**

Add a module-level helper near the top of `src/phases/init.ts` (after imports). Import `hashSource`:

```ts
import { hashSource } from "../incremental-sources";

/** Read a source file and return its body hash; "" on read failure. */
async function sourceHashFor(vaultTools: VaultTools, file: string): Promise<string> {
  const content = await vaultTools.read(file).catch(() => "");
  return hashSource(content);
}
```

(Use the existing `VaultTools` import in `init.ts`; if it is imported under a different name, match it.)

Replace the per-file-complete block (lines 350–363):

```ts
    // --- Mark file complete: record analyzed_sources hash ---
    currentDomain = {
      ...currentDomain,
      analyzed_sources: {
        ...(currentDomain.analyzed_sources ?? {}),
        [file]: await sourceHashFor(vaultTools, file),
      },
    };
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield {
      kind: "domain_updated", domainId,
      patch: {
        entity_types: currentDomain.entity_types,
        language_notes: currentDomain.language_notes,
        analyzed_sources: currentDomain.analyzed_sources,
      },
    };
    yield { kind: "tool_result", ok: true };
```

Replace the new-source bookkeeping block (lines 438–446):

```ts
    // New-source bookkeeping: record the source hash if not already present.
    const analyzedMap = currentDomain.analyzed_sources ?? {};
    if (!(file in analyzedMap)) {
      currentDomain = {
        ...currentDomain,
        analyzed_sources: { ...analyzedMap, [file]: await sourceHashFor(vaultTools, file) },
      };
      yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
      yield { kind: "domain_updated", domainId, patch: { analyzed_sources: currentDomain.analyzed_sources } };
      yield { kind: "tool_result", ok: true };
    }
```

- [ ] **Step 4: Initialise `analyzed_sources` as a map (`init.ts`)**

Change line 283 (`analyzed_sources: [],`) → `analyzed_sources: {},`.
Change line 295 (`analyzed_sources: [],`) → `analyzed_sources: {},`.
Change the resume set at lines 155–159:

```ts
  const isResuming = !force && existing?.analyzed_sources !== undefined;
  const alreadyAnalyzed = new Set(force ? [] : Object.keys(existing?.analyzed_sources ?? {}));
```

(There is also a bare `existing.analyzed_sources = [];` at line 92 — change it to `existing.analyzed_sources = {};`.)

- [ ] **Step 5: Retype the delete pruning (`delete.ts`)**

Replace lines 74–79:

```ts
  const curAnalyzed = domain.analyzed_sources ?? {};
  const prunedAnalyzed: Record<string, string> = {};
  for (const k of Object.keys(curAnalyzed)) {
    if (k !== sourcePath && sourceStem(k) !== targetStem) prunedAnalyzed[k] = curAnalyzed[k];
  }
  if (Object.keys(prunedAnalyzed).length !== Object.keys(curAnalyzed).length) {
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: prunedAnalyzed } };
  }
```

- [ ] **Step 6: Build + lint**

Run: `npm run build`
Expected: esbuild completes, no bundling error.

Run: `npm run lint`
Expected: no eslint errors in touched files (`src/incremental-sources.ts`, `src/domain.ts`, `src/domain-store.ts`, `src/types.ts`, `src/controller.ts`, `src/phases/init.ts`, `src/phases/delete.ts`).

Run: `npx tsc --noEmit 2>&1 | grep -E "incremental-sources|domain\.ts|domain-store|types\.ts|controller\.ts|phases/init|phases/delete" || echo "no new tsc errors in touched files"`
Expected: `no new tsc errors in touched files` (repo tsc baseline is not clean; gate only on touched files).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/controller.ts src/phases/init.ts src/phases/delete.ts
git commit -m "feat(incremental): wire analyzed_sources map + hash-at-ingest"
```

---

### Task 4: Orphan cleanup + full verification + manual e2e

**Files:**
- Modify: `src/vault-tools.ts:180-184` (remove `mtime` if orphaned)
- Modify: `src/incremental-sources.ts` (confirm `WikiPageInfo` removed; no stray exports)

- [ ] **Step 1: Remove orphaned `VaultTools.mtime`**

Run: `grep -rn "\.mtime(" src/ eval/`
Expected: no remaining callers (the only callers were in `computeIncrementalPlan`, removed in Task 3; the eval no longer uses it).

If no callers remain, delete the `mtime` method in `src/vault-tools.ts` (lines 180–184). If the `stat?(...)` member on `VaultAdapter` is now unused, run `grep -rn "\.stat(" src/ eval/` — remove the `VaultAdapter.stat` declaration only if it has no other caller; otherwise leave it with no change.

> Do NOT remove `parsePageSources` from `incremental-sources.ts` — it is pre-existing, eval-covered, and removing it is out of scope. Only its import in `controller.ts` was dropped (Task 3).

- [ ] **Step 2: Full verification suite**

Run: `npx tsx eval/incremental-sources/run.ts`
Expected: `TOTAL: N passed, 0 failed`.

Run: `npm run build`
Expected: success.

Run: `npm run lint`
Expected: clean on touched files.

- [ ] **Step 3: Manual e2e on the real `ai-agent` vault (HUMAN CHECKPOINT)**

Pre-state: `_config/_domain.json` `ai-agent.analyzed_sources` is a legacy list and the three sources (`agent-building-guide`, `agent-creation-guide`, `agent-systems-guide`) were stuck as always-changed.

1. Load the plugin (build deployed to the test vault). Opening the domain triggers `DomainStore.load` → v3 migration converts the list to `{path: ""}`.
2. Open reinit → Incremental for `ai-agent`. First plan runs the silent baseline (fills `""` → real hashes, persists to `_domain.json`).
   - **Expected:** the Incremental button shows **0** (no source edited since last ingest). Verify `_domain.json` now shows `analyzed_sources` as a map with `fnv1a:...` values.
3. Edit the **body** of `ИИ/Agent/agent-systems-guide.md` (add a sentence), save.
4. Re-open reinit → Incremental.
   - **Expected:** shows exactly **1** — `agent-systems-guide`.
5. Confirm Incremental; let it re-ingest only that source.
6. Re-open reinit → Incremental.
   - **Expected:** back to **0** (the re-ingest stored the new hash).
7. Sanity (SC1): run a Full reinit (`--force`) once; confirm wiki pages / `_index.md` / domain entry are unchanged except the `analyzed_sources` shape.

Record the observed counts (0 / 1 / 0) in the PR description.

- [ ] **Step 4: Commit**

```bash
git add src/vault-tools.ts src/incremental-sources.ts
git commit -m "chore(incremental): drop orphaned VaultTools.mtime"
```

---

## Post-task (per project CLAUDE.md)

- [ ] Update `docs/wiki/` for the changed detection behavior: `iwiki:iwiki-ingest src/incremental-sources.ts` (and the domain/ingest pages if affected).
- [ ] Run `/iwiki-lint` — no broken `[[refs]]`, no orphan/stale pages.
- [ ] Open a PR `dev/incremental-source-hash` → `master` (use git-workflow). Include the e2e counts.

## Self-Review (against the spec)

- **R1 hash signal** → Task 1 (`sourceBodyForHash`, `hashSource`, FNV-1a, `fnv1a:` prefix, body-only).
- **R2 wiki-side storage, sources untouched** → Task 3 (persist to `_domain.json` via `domainStore.save` / `domain_updated`; no source writes added).
- **R3 map + v3 migration** → Task 2.
- **R4 detection rewrite (`{changed, baselined}`, baseline on "")** → Task 1 + persisted in Task 3 Step 2.
- **R5 plan wiring, wikiPages removed** → Task 3 Step 2.
- **R6 hash at all ingest paths** → Task 3 Step 3 (both `init.ts` bookkeeping spots, covering full reinit / `--sources` / `--incremental`).
- **R7 retype consumers + orphan cleanup** → Task 3 Steps 1,4,5 + Task 4 Step 1.
- **R8 A2 reorder kept** → no task touches `ingest.ts` write order (left in place by design).
- **R9 verification** → Task 1 eval (unit), Task 2 (migration unit), Task 3 build/lint, Task 4 manual e2e.
- **SC1 full reinit unchanged** → Task 4 Step 3.7.
- **SC2 0 / 1 / 0 on ai-agent** → Task 4 Step 3.2–3.6.
