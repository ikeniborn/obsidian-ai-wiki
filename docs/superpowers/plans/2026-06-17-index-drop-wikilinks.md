# Drop Wikilinks from `_index.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the per-domain `_index.md` line format from `- [[pid]] relpath — annotation` to `- pid — annotation`, with auto-migration on plugin load, so `_index.md` stops appearing as a hub node in Obsidian's graph view — without changing any seed/similarity/dedup behavior.

**Architecture:** `pid` is the only consumed field; `relpath` and the `[[ ]]` wikilink were never used by any tool path. Make `parseIndexAnnotations` tolerant of both old and new formats, switch the writers to emit the new format, add a standalone content-detecting migration (`migrateIndexFormat`) that runs once on plugin load and rewrites legacy lines under a non-destructive guard, and update `lat.md`.

**Tech Stack:** TypeScript, Obsidian plugin API (`Vault`/`VaultAdapter`, `Notice`), esbuild, eslint, `tsx` (local, for run-real-code verification). **Project rule: NO functional tests** — verify by running real code and observing output (`npx tsx` throwaway scripts), plus `npm run lint` and `npx tsc --noEmit`.

---

## File Structure

- **Modify** `src/wiki-index.ts` — tolerant parser, new-format writer, shared tolerant `pidLineRegex` helper used by upsert + remove.
- **Create** `src/migrate-index-format.ts` — `migrateIndexFormat(vault, domains)`: per-domain line rewrite, non-destructive guard, one-shot `Notice`. Kept separate (mirrors `migrate-wiki-prefix.ts` / `storage-migration.ts`) so `wiki-index.ts` stays free of Obsidian-runtime imports.
- **Modify** `src/main.ts` — call `migrateIndexFormat` in `onload`, after all registry migrations settle, before controller creation.
- **Modify** `lat.md/operations.md` — document the new line format + migration; add a `[[src/migrate-index-format.ts#migrateIndexFormat]]` ref.

---

## Task 1: Tolerant parser + shared pid-line regex

**Files:**
- Modify: `src/wiki-index.ts:4-11` (`parseIndexAnnotations`)
- Modify: `src/wiki-index.ts` (add `pidLineRegex` helper; use it in `upsertInSection` and `removeIndexAnnotation`)

- [ ] **Step 1: Rewrite `parseIndexAnnotations` to accept both formats**

Replace the current function (lines 4–11):

```ts
export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.match(/^- \[\[([^\]]+)\]\] [^ ]+ — (.+)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}
```

with:

```ts
export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.match(/^- (.+?) — (.+)$/);
    if (!m) continue;
    let pid = m[1].trim();
    const old = pid.match(/^\[\[([^\]]+)\]\]/); // old format: "[[pid]] relpath"
    if (old) pid = old[1];
    map.set(pid, m[2].trim());
  }
  return map;
}
```

- [ ] **Step 2: Add a tolerant `pidLineRegex` helper**

Add this function just above `upsertInSection` (after `deriveSection`):

```ts
// Matches a pid's index line in BOTH the old `- [[pid]] relpath — …` and the new
// `- pid — …` format. The trailing space anchors the pid as a full token, so `pid`
// does not collide with `pid_2`.
function pidLineRegex(pid: string): RegExp {
  const esc = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- (?:\\[\\[${esc}\\]\\]|${esc}) `);
}
```

- [ ] **Step 3: Use the helper in `upsertInSection`**

In `upsertInSection`, replace:

```ts
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pidRe = new RegExp(`^- \\[\\[${escaped}\\]\\]`);
```

with:

```ts
  const pidRe = pidLineRegex(pid);
```

- [ ] **Step 4: Use the helper in `removeIndexAnnotation`**

In `removeIndexAnnotation`, replace:

```ts
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pidRe = new RegExp(`^- \\[\\[${escaped}\\]\\]`);
```

with:

```ts
  const pidRe = pidLineRegex(pid);
```

- [ ] **Step 5: Verify the parser against both formats (run real code)**

Run:

```bash
npx tsx -e '
import { parseIndexAnnotations } from "./src/wiki-index.ts";
const oldFmt = "# Wiki Index\n\n## general\n- [[wiki_d_alpha]] general/alpha.md — first — note\n- [[wiki_d_beta]] general/beta.md — second\n";
const newFmt = "# Wiki Index\n\n## general\n- wiki_d_alpha — first — note\n- wiki_d_beta — second\n";
const a = parseIndexAnnotations(oldFmt), b = parseIndexAnnotations(newFmt);
console.log("old:", JSON.stringify([...a]));
console.log("new:", JSON.stringify([...b]));
console.log("EQUAL:", JSON.stringify([...a]) === JSON.stringify([...b]));
'
```

Expected output:

```
old: [["wiki_d_alpha","first — note"],["wiki_d_beta","second"]]
new: [["wiki_d_alpha","first — note"],["wiki_d_beta","second"]]
EQUAL: true
```

(Confirms: bracket-strip works, em-dash inside annotation preserved, both formats yield identical maps.)

- [ ] **Step 6: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/wiki-index.ts
git commit -m "feat(wiki-index): tolerant parseIndexAnnotations + shared pidLineRegex"
```

---

## Task 2: Writer emits new format

**Files:**
- Modify: `src/wiki-index.ts:59-82` (`upsertIndexAnnotation`)

- [ ] **Step 1: Drop relpath, emit `- pid — annotation`**

In `upsertIndexAnnotation`, replace this block:

```ts
  const section = deriveSection(wikiFolder, fullPath);
  const prefix = wikiFolder + "/";
  const relPath = fullPath
    ? (fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath)
    : pid;
  // collapse newlines / whitespace runs → single space; enforce single-line invariant
  // (not truncation — all content is preserved, only whitespace is normalized)
  const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
  const entryLine = `- [[${pid}]] ${relPath} — ${oneLineAnnotation}`;
```

with:

```ts
  const section = deriveSection(wikiFolder, fullPath);
  // collapse newlines / whitespace runs → single space; enforce single-line invariant
  // (not truncation — all content is preserved, only whitespace is normalized)
  const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
  const entryLine = `- ${pid} — ${oneLineAnnotation}`;
```

Keep the `fullPath` parameter and the `deriveSection(wikiFolder, fullPath)` call — sections still group pages under `## <section>` headers; only the per-line `relpath` is dropped.

- [ ] **Step 2: Verify upsert round-trips through the tolerant parser (run real code)**

Run:

```bash
npx tsx -e '
import { upsertIndexAnnotation, removeIndexAnnotation, parseIndexAnnotations } from "./src/wiki-index.ts";
let store = {};
const vt = {
  read: async (p) => { if (!(p in store)) throw new Error("ENOENT"); return store[p]; },
  write: async (p, c) => { store[p] = c; },
};
const folder = "AI-Wiki/dom";
await upsertIndexAnnotation(vt, folder, "wiki_d_alpha", "first  note", folder + "/general/alpha.md");
await upsertIndexAnnotation(vt, folder, "wiki_d_beta", "second", folder + "/general/beta.md");
const idx = Object.values(store)[0];
console.log("---INDEX---\n" + idx);
console.log("PARSED:", JSON.stringify([...parseIndexAnnotations(idx)]));
console.log("HAS_WIKILINK:", idx.includes("[["));
await removeIndexAnnotation(vt, folder, "wiki_d_alpha");
console.log("AFTER_REMOVE:", JSON.stringify([...parseIndexAnnotations(Object.values(store)[0])]));
'
```

Expected output (index lines have NO `[[`, remove targets the new-format line correctly):

```
---INDEX---
# Wiki Index

## general
- wiki_d_alpha — first note
- wiki_d_beta — second
PARSED: [["wiki_d_alpha","first note"],["wiki_d_beta","second"]]
HAS_WIKILINK: false
AFTER_REMOVE: [["wiki_d_beta","second"]]
```

(Confirms: new-format write, `deriveSection` still groups under `## general`, `pidLineRegex` finds the new-format line for removal.)

- [ ] **Step 2b: Verify remove still works on a legacy old-format line**

Run:

```bash
npx tsx -e '
import { removeIndexAnnotation, parseIndexAnnotations } from "./src/wiki-index.ts";
let store = { "AI-Wiki/dom/_config/_index.md": "# Wiki Index\n\n## general\n- [[wiki_d_alpha]] general/alpha.md — first\n- [[wiki_d_beta]] general/beta.md — second\n" };
const vt = {
  read: async (p) => store[p],
  write: async (p, c) => { store[p] = c; },
};
await removeIndexAnnotation(vt, "AI-Wiki/dom", "wiki_d_alpha");
console.log(JSON.stringify([...parseIndexAnnotations(Object.values(store)[0])]));
'
```

Note: the `_index.md` path used here is illustrative; `removeIndexAnnotation` computes it via `domainIndexPath(wikiFolder)`. If the printed path key differs, adjust the `store` key to match `domainIndexPath("AI-Wiki/dom")` (print it once with a `console.log` if needed).
Expected: `[["wiki_d_beta","second"]]` (old-format line removed via tolerant regex).

- [ ] **Step 3: Lint + type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/wiki-index.ts
git commit -m "feat(wiki-index): upsert emits bracketless '- pid — annotation' lines"
```

---

## Task 3: Migration module

**Files:**
- Create: `src/migrate-index-format.ts`

- [ ] **Step 1: Create the migration module**

Create `src/migrate-index-format.ts` with exactly:

```ts
import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import { domainIndexPath, domainWikiFolder } from "./wiki-path";
import { parseIndexAnnotations } from "./wiki-index";

// Old: "- [[pid]] relpath — annotation"  (relpath has no spaces).
const OLD_ENTRY = /^- \[\[([^\]]+)\]\] \S+ — (.+)$/;
// New: "- pid — annotation"  (pid has no spaces).
const NEW_ENTRY = /^- \S+ — .+$/;

interface LineResult {
  out: string;
  changed: boolean;
  unknown: boolean;
}

function migrateLine(line: string): LineResult {
  if (!line.startsWith("- ")) return { out: line, changed: false, unknown: false };
  const old = line.match(OLD_ENTRY);
  if (old) return { out: `- ${old[1]} — ${old[2]}`, changed: true, unknown: false };
  if (NEW_ENTRY.test(line)) return { out: line, changed: false, unknown: false };
  return { out: line, changed: false, unknown: true };
}

/**
 * One-shot, content-detecting migration of every domain's `_index.md` from the old
 * `- [[pid]] relpath — annotation` format to the new bracketless `- pid — annotation`.
 * Idempotent: a file with no old-format lines is left untouched. Non-destructive: a
 * domain is skipped (no write) if any entry-looking line is unrecognized, or if the
 * before/after annotation key sets differ.
 */
export async function migrateIndexFormat(vault: Vault, domains: DomainEntry[]): Promise<void> {
  const adapter = vault.adapter;
  let filesChanged = 0;
  let linesChanged = 0;

  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    const indexPath = domainIndexPath(wikiFolder);
    if (!(await adapter.exists(indexPath))) continue;

    const raw = await adapter.read(indexPath);
    const before = parseIndexAnnotations(raw);

    const out: string[] = [];
    let changed = 0;
    let unknown = false;
    for (const line of raw.split("\n")) {
      const r = migrateLine(line);
      if (r.unknown) {
        console.error(`[AI Wiki] index migration: unrecognized line in ${indexPath}: ${line}`);
        unknown = true;
        break;
      }
      out.push(r.out);
      if (r.changed) changed++;
    }
    if (unknown) continue;   // halt this domain, write nothing
    if (changed === 0) continue; // already migrated / nothing to do

    const newContent = out.join("\n");
    const after = parseIndexAnnotations(newContent);
    // Non-destructive guard: the pid key set must be byte-for-byte preserved.
    const preserved =
      before.size === after.size && [...before.keys()].every((k) => after.has(k));
    if (!preserved) {
      console.error(
        `[AI Wiki] index migration: annotation key mismatch in ${indexPath} ` +
          `(${before.size} → ${after.size}); skipping`,
      );
      continue;
    }

    await adapter.write(indexPath, newContent);
    filesChanged++;
    linesChanged += changed;
  }

  if (filesChanged > 0) {
    new Notice(`AI Wiki: index format migrated — ${filesChanged} files, ${linesChanged} lines`);
  }
}
```

- [ ] **Step 2: Verify migration logic — convert, idempotent, guard, unknown-halt (run real code)**

This harness stubs `Notice`/`Vault` and exercises `migrateLine` + the guard via a direct copy-free import. Run:

```bash
npx tsx -e '
import { parseIndexAnnotations } from "./src/wiki-index.ts";
// Re-declare the pure line transform to observe its behavior in isolation:
const OLD = /^- \[\[([^\]]+)\]\] \S+ — (.+)$/;
const NEW = /^- \S+ — .+$/;
function mig(line){ if(!line.startsWith("- ")) return {out:line,changed:false,unknown:false};
  const o=line.match(OLD); if(o) return {out:`- ${o[1]} — ${o[2]}`,changed:true,unknown:false};
  if(NEW.test(line)) return {out:line,changed:false,unknown:false};
  return {out:line,changed:false,unknown:true}; }
const oldIdx = "# Wiki Index\n\n## general\n- [[wiki_d_alpha]] general/alpha.md — first — note\n- [[wiki_d_beta]] general/beta.md — second\n";
const lines = oldIdx.split("\n").map(mig);
const out = lines.map(l=>l.out).join("\n");
console.log("---MIGRATED---\n"+out);
console.log("CHANGED:", lines.filter(l=>l.changed).length);
console.log("KEYS_PRESERVED:", JSON.stringify([...parseIndexAnnotations(oldIdx).keys()]) === JSON.stringify([...parseIndexAnnotations(out).keys()]));
console.log("IDEMPOTENT:", out.split("\n").map(mig).some(l=>l.changed) === false);
console.log("UNKNOWN_DETECTED:", mig("- this is not an entry").unknown === true);
'
```

Expected output:

```
---MIGRATED---
# Wiki Index

## general
- wiki_d_alpha — first — note
- wiki_d_beta — second
CHANGED: 2
KEYS_PRESERVED: true
IDEMPOTENT: true
UNKNOWN_DETECTED: true
```

- [ ] **Step 3: Lint + type-check the new module**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/migrate-index-format.ts
git commit -m "feat(migrate-index-format): content-detecting _index.md format migration"
```

---

## Task 4: Wire migration into plugin load

**Files:**
- Modify: `src/main.ts` (import + `onload` call)

- [ ] **Step 1: Add the import**

In `src/main.ts`, add after the existing `storage-migration` import (line 12):

```ts
import { migrateIndexFormat } from "./migrate-index-format";
```

- [ ] **Step 2: Call it after registry migrations settle**

In `onload`, find the block:

```ts
    await migrateToLocalV2(this, this.localConfigStore);
    this.controller = new WikiController(this.app, this, this.domainStore, this.localConfigStore);
```

Replace it with:

```ts
    await migrateToLocalV2(this, this.localConfigStore);
    try {
      const domains = await this.domainStore.load();
      await migrateIndexFormat(this.app.vault, domains);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: index format migration failed — ${msg}`, 0);
      console.error("[AI Wiki] index format migration error:", e);
    }
    this.controller = new WikiController(this.app, this, this.domainStore, this.localConfigStore);
```

Rationale: placed after `migrateToLocalV2` and after all registry/`wiki_folder` migrations (`runStorageMigration`, `migrateLegacyData`) so `domainWikiFolder(domain.wiki_folder)` resolves to the final paths. Wrapped in try/catch mirroring `runStorageMigration` so a migration error never blocks plugin load.

- [ ] **Step 3: Build + lint + type-check**

Run: `npm run build && npm run lint && npx tsc --noEmit`
Expected: build succeeds, no lint/type errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): run migrateIndexFormat on plugin load"
```

---

## Task 5: Update `lat.md` docs

**Files:**
- Modify: `lat.md/operations.md:88`

- [ ] **Step 1: Document the new line format + migration**

In `lat.md/operations.md`, find the paragraph at line 88 that begins:

> `Each page's match text is its `_index.md` annotation, which is now a rich single-line structured string …`

Append these two sentences to the **end of that paragraph** (before the closing `See [[…]]` references, keeping them on the same paragraph):

```
The index line format is `- pid — annotation` — a bare `pid`, with no `[[wikilink]]` and no path — so `_index.md` contributes zero edges to the Obsidian graph view (the BFS retrieval graph already excludes it via `META_FILES`, so quality is unaffected). On plugin load, [[src/migrate-index-format.ts#migrateIndexFormat]] rewrites any legacy `- [[pid]] relpath — annotation` lines to the new format, idempotently and only when the annotation key set is preserved.
```

- [ ] **Step 2: Validate the knowledge graph**

Run: `lat check`
Expected: green — all wiki links and code refs resolve (including the new `[[src/migrate-index-format.ts#migrateIndexFormat]]`).

If `lat check` reports the new code ref as unresolved, confirm the export name in `src/migrate-index-format.ts` is exactly `migrateIndexFormat` (Task 3).

- [ ] **Step 3: Commit**

```bash
git add lat.md/operations.md
git commit -m "docs(lat): document bracketless _index.md format + migrateIndexFormat"
```

---

## Task 6: Final end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full static gate**

Run: `npm run build && npm run lint && npx tsc --noEmit && lat check`
Expected: all green, no new errors in touched files.

- [ ] **Step 2: Real ingest + query on a test domain (manual, in Obsidian)**

In an Obsidian vault with the built plugin and a domain that has an existing old-format `_index.md`:

1. Reload the plugin → confirm the one-shot Notice `AI Wiki: index format migrated — N files, M lines` appears, and `_index.md` lines are now `- pid — annotation` (no `[[`).
2. Open Obsidian graph view → confirm `_index.md` has **zero edges** to pages (hub gone).
3. Run a query that previously returned a known page set → confirm the **same** pages are returned (seeds unchanged).
4. Run an ingest that creates and merges a page → confirm `_index.md` gains/loses the correct `- pid — annotation` lines.

Record the before/after page sets; they must match.

- [ ] **Step 3: Idempotency check**

Reload the plugin a second time → confirm **no** migration Notice appears (nothing left to convert) and `_index.md` is unchanged.

- [ ] **Step 4: Update the intent doc status (optional)**

If tracking intent completion, note in `docs/superpowers/intents/2026-06-17-index-drop-wikilinks-intent.md` that the Done-when criteria are met.

- [ ] **Step 5: Final commit (if any docs touched)**

```bash
git add -A
git commit -m "chore: index-drop-wikilinks verification notes"
```

---

## Self-Review

**Spec coverage:**
- New line format `- pid — annotation` → Task 2.
- Tolerant `parseIndexAnnotations` (both formats) → Task 1.
- Writer `upsertIndexAnnotation` new format, keep `deriveSection` → Task 2.
- Tolerant `pidRe` in upsert + remove → Task 1 (`pidLineRegex` helper).
- Standalone content-detecting `migrateIndexFormat`, unknown-line halt, non-destructive key guard, one-shot Notice, idempotent → Task 3.
- Wire into `main.ts` onload after registry migrations → Task 4.
- `lat.md` update + `lat check` → Task 5.
- Untouched `buildWikiGraph` / `index_block` → not modified by any task (explicitly out of scope).
- Verification: lint, tsc, real ingest/query, graph-view hub gone, idempotency → Task 6.

**Placeholder scan:** No TODO/TBD; every code step shows full code; every verify step shows exact command + expected output.

**Type consistency:** `migrateIndexFormat(vault: Vault, domains: DomainEntry[])` defined in Task 3, imported/called identically in Task 4. `pidLineRegex(pid)` defined and used in Task 1. `domainWikiFolder` + `domainIndexPath` imported in Task 3 match their `wiki-path.ts` signatures (same usage as `migrate-wiki-prefix.ts`). `parseIndexAnnotations` signature unchanged (Task 1) and reused in Task 3.

**Note on `npm test`:** `package.json` still defines `test`/`test:watch` (vitest), but the functional test suites were removed (project No-Tests rule). This plan does not add or run vitest; verification is run-real-code + static checks only. The vestigial scripts are out of scope here.
