---
review:
  spec_hash: f25d3e2a7ba2331d
  last_run: 2026-06-17
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-06-17-index-drop-wikilinks-intent.md
---
# Design: Drop wikilinks from `_index.md`

**Date:** 2026-06-17
**Status:** approved
**Intent:** `docs/superpowers/intents/2026-06-17-index-drop-wikilinks-intent.md`
**Branch:** `refactor/index-drop-wikilinks`

## Problem

Each per-domain `_index.md` stores one line per page:

```
- [[pid]] relpath — annotation
```

The `[[pid]]` wikilink makes Obsidian's graph view render `_index.md` as a single
hub node linked to every page in the domain — visual noise that buries the real
page-to-page structure. The internal BFS retrieval graph (`buildWikiGraph`) already
excludes `_index.md` via `META_FILES`, so the hub is purely an Obsidian graph-view
artifact.

Goal: remove the wikilink (and the now-unused `relpath`) so the hub disappears,
**without** degrading ingest/query quality.

## What is and isn't consumed

The only programmatic dependency on the line format is `parseIndexAnnotations`, which
extracts `pid → annotation`. `pid` is the seed/similarity/dedup key for the whole
domain. The `relpath` field is **not** consumed by any tool path:

- Query re-globs the vault and reads pages by reconstructed `${wikiVaultPath}/${pid}.md`.
- Ingest uses LLM-proposed paths.
- `index_block` (query.ts, init.ts) dumps the raw `_index.md` text into the LLM
  prompt — `relpath` lived only as context text there, never as a tool argument.

So dropping `relpath` has no programmatic effect.

## New line format

```
- pid — annotation
```

No brackets, no path. `pid` and `annotation` unchanged.

## Components

### 1. Parser — `parseIndexAnnotations` (`src/wiki-index.ts`)

Make the parser tolerant of **both** old and new formats, so an index that has not
yet been migrated still yields correct seeds:

```ts
export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.match(/^- (.+?) — (.+)$/);
    if (!m) continue;
    let pid = m[1].trim();
    const old = pid.match(/^\[\[([^\]]+)\]\]/); // old: "[[pid]] relpath"
    if (old) pid = old[1];
    map.set(pid, m[2].trim());
  }
  return map;
}
```

- Non-entry lines (`# Wiki Index`, `## section`, blanks) do not start with `- ` → skipped.
- Non-greedy `(.+?)` splits at the **first** ` — `, identical to today's behavior, so an
  em-dash inside an annotation is preserved.
- New format: group 1 is the bare `pid` (no bracket strip needed). Old format: group 1
  is `[[pid]] relpath`; the bracket-strip yields `pid`.

### 2. Writers — `src/wiki-index.ts`

`upsertIndexAnnotation`:

- Build `entryLine = `- ${pid} — ${oneLineAnnotation}``.
- Drop the `relPath` computation (the `prefix`/`fullPath.slice` block).
- Keep `deriveSection(...)` — pages still group under `## section` headers.

`pidRe` (used by both `upsertInSection` and `removeIndexAnnotation` to locate a pid's
line) → tolerant of both formats during the transition window:

```ts
const esc = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pidRe = new RegExp(`^- (?:\\[\\[${esc}\\]\\]|${esc}) `);
```

Matches `- [[pid]] ...` (old) and `- pid — ...` (new). The trailing space anchors the
match to a full pid token, preventing prefix collisions (`pid` vs `pid_2`).

### 3. Migration — new `migrateIndexFormat(vault, domains)` (`src/wiki-index.ts` or a small new module)

Standalone, content-detecting, idempotent. **Mechanism chosen at the human checkpoint:
no version flag** — a line without `[[` is already migrated and is skipped, so re-running
is a no-op.

Per domain, read `_index.md` and process line by line:

- Line starts with `- `:
  - Matches old entry `^- \[\[([^\]]+)\]\] \S+ — (.+)$` → rewrite to `- $1 — $2`.
  - Matches new entry `^- \S+ — .+$` → keep unchanged.
  - Matches neither → **unknown format: halt this domain, write nothing, error-log the
    line.** (Stop rule — never silently drop.)
- Any other line (headers, blanks) → keep verbatim.

**Non-destructive guard:** compute `parseIndexAnnotations(before)` and
`parseIndexAnnotations(after)`; their key sets must be identical. On any mismatch →
halt the domain, write nothing, error-log. (Escalate per stop rule.)

Write the file only when something changed **and** the guard passes.

**Write trigger (human checkpoint):** auto-write on plugin load. After processing all
domains, show a one-shot `Notice`: `"index format migrated: N files, M lines"`. No
modal, no second restart.

Signature takes the already-loaded `DomainEntry[]` (matches `migrateDomain`'s style and
avoids re-reading the registry that `main.ts` already loaded).

### 4. Wiring — `src/main.ts` onload

Call `migrateIndexFormat(this.app.vault, domains)` after `runStorageMigration(...)` and
before any phase can run. Domains are already loaded via `domainStore` at that point.

### 5. Docs — `lat.md/`

Update the section that documents the `_index.md` line format (locate via
`lat locate` / `lat search`; candidates: `lat.md/wiki-graph.md`,
`lat.md/operations.md`) to the new `- pid — annotation` format, with a note that the
wikilink was dropped to keep `_index.md` out of the Obsidian graph view. Run `lat check`.

## Out of scope / untouched

- `buildWikiGraph` (`src/wiki-graph.ts`) — **hard constraint, do not touch**; it already
  excludes `_index.md` via `META_FILES`.
- `index_block` prompt assembly — keeps dumping raw index text; the dropped `relpath`
  was never a tool argument, so no regression.
- No new migration framework — reuse the existing load-time migration pattern
  (`runStorageMigration` call site).

## Verification

Project rule: **no functional tests.** Verify by running real code:

1. **Migration on a real domain:** an old-format `_index.md` is rewritten to new format;
   `Notice` reports the counts; re-running on the migrated file changes nothing
   (idempotent).
2. **Parser parity:** `parseIndexAnnotations` returns the same `pid → annotation` key set
   before and after migration.
3. **Ingest + query** on a test domain return the same page set as before the change.
4. **Obsidian graph view:** `_index.md` shows zero edges to pages (hub gone).
5. `npm run lint` clean; `tsc` adds no new errors in touched files; `lat check` green.

## Stop rules (from intent)

- Halt if an entry-looking line (`- ...`) matches neither old nor new format — report,
  do not write.
- Escalate if migration would change the annotation key count (before ≠ after) — write
  nothing.
