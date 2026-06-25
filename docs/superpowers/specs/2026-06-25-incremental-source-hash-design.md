---
review:
  spec_hash: 6ebbab4dd08e0a6a
  last_run: 2026-06-25
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings: []
chain:
  intent: null
---
# Design: incremental-source-hash

**Date:** 2026-06-25
**Status:** approved (design)
**Supersedes (detection only):** the mtime-based `computeChangedSources` from
[2026-06-24-incremental-reinit-design.md](2026-06-24-incremental-reinit-design.md)

## Problem

Incremental re-init keeps re-flagging sources that did **not** change. On the
`ai-agent` vault, every plan re-lists `agent-building-guide`,
`agent-creation-guide`, `agent-systems-guide` even though nothing was edited
after the last ingest.

### Root cause (confirmed from `_config/_agent.jsonl`)

Detection (`src/incremental-sources.ts:39-40`) marks a source changed when:

```
src.mtime > Math.min(...associated wiki page mtimes)   // strict >, min over ALL associated pages
```

Two facts make this permanently true after any ingest:

1. **The source mtime is bumped on every ingest.** `runIngest` always rewrites
   the source frontmatter (`wiki_updated: <today>` + `wiki_articles` backlinks,
   `src/phases/ingest.ts:349-371`), with no content guard. The source's mtime
   becomes "now" on every run.
2. **Only a subset of a source's pages is rewritten per run.** The ingest LLM
   emits only the pages it deems changed. Log evidence: ingesting
   `agent-systems-guide.md` reported `обновлено 11 стр.` while the source is
   associated (via `wiki_sources`) with ~28 pages. The other ~17 pages keep
   their original mtime (`2026-06-20`). So `min(associated pages)` stays at the
   old date, which is older than the freshly bumped source mtime.

The **A2 reorder** (write source before pages) only guarantees
`page.mtime >= source.mtime` for pages written *in the same run*. Pages created
in earlier runs and not re-emitted violate the invariant. The
`2026-06-24` spec's worked example assumed an ingest rewrites **all** of a
source's pages; it does not. This is exactly the Stop-rule that spec named:
*"Escalate if the mtime comparison cannot reliably exclude unmodified sources
without persisting state."* We hit it. mtime cannot carry this signal.

## Decision

Detect a source change by **content hash**, not mtime. Persist the hash on the
**wiki side** (`_config/_domain.json`) so source files are never touched for
bookkeeping. The wiki page mtimes and `wiki_sources` are removed from the
freshness decision entirely.

Decisions locked with the user:

- **Signal:** hash of the source **body** (frontmatter stripped).
- **Storage:** in the domain registry, **not** in source frontmatter.
- **Shape:** merge into the existing `analyzed_sources` field — it becomes a map
  `source path → hash`. The key set already equals "sources that were ingested",
  so a single field is the honest model and avoids a parallel map that could
  desync.
- **Migration of already-ingested sources:** **silent baseline** — on the first
  plan after upgrade, compute and store the current hash without re-ingesting
  (assume the wiki already reflects the source).

## Data model

`src/domain.ts` — `DomainEntry.analyzed_sources` changes type:

```ts
// before
analyzed_sources?: string[];
analyzed_sources_v2?: boolean;

// after
analyzed_sources?: Record<string, string>;  // source vault path → content hash
analyzed_sources_v2?: boolean;               // kept (legacy reset migration)
analyzed_sources_v3?: boolean;               // list → map migration flag
```

Semantics:

- **Key present** = source has been ingested (former list-membership semantics).
- **Value** = `"<algo>:<hex>"` content hash of the source body, e.g.
  `"fnv1a:9a3c1f7b"`. The `algo:` prefix is forward-compat (swap algorithm later
  without ambiguity).
- **Value `""`** = ingested but hash not yet computed (post-migration, pre-baseline).

### Example (`_config/_domain.json`, `ai-agent` domain)

```json
{
  "id": "ai-agent",
  "wiki_folder": "ai-agent",
  "source_paths": ["ИИ/Agent/"],
  "analyzed_sources": {
    "ИИ/Agent/agent-building-guide.md": "fnv1a:9a3c1f7b",
    "ИИ/Agent/agent-creation-guide.md": "fnv1a:1b40e2c9",
    "ИИ/Agent/agent-guide.md":          "fnv1a:7e55aa01",
    "ИИ/Agent/agent-systems-guide.md":  "fnv1a:c4d9038f"
  },
  "analyzed_sources_v2": true,
  "analyzed_sources_v3": true
}
```

### Migration

`src/domain.ts` — add a v3 migration (alongside `migrateDomainsV2`):

- For each domain where `analyzed_sources` is an **array** and `!analyzed_sources_v3`:
  convert `["a.md", "b.md"]` → `{"a.md": "", "b.md": ""}`, set
  `analyzed_sources_v3 = true`.
- Migration is pure (no vault access), so values start as `""`; the silent
  baseline fills them on the first plan.
- `analyzed_sources_v2` stays untouched (it is a separate, earlier reset).

## Components

### 1 — pure hash + body extraction (`src/incremental-sources.ts`)

Keep the module pure / dependency-free (out-of-vault testable, mirrors
`eval/format-frontmatter/`). Add:

```ts
/** Source content with the leading YAML frontmatter block removed, trailing
 *  whitespace trimmed. Whole content when there is no frontmatter. */
export function sourceBodyForHash(content: string): string;

/** Deterministic FNV-1a (32-bit) over a string → "fnv1a:<hex>". No deps. */
export function hashSource(content: string): string;  // = "fnv1a:" + fnv1a(sourceBodyForHash(content))
```

Rationale for **body-only** (frontmatter stripped):

- Immune to the plugin's own frontmatter writes (`wiki_added` / `wiki_updated` /
  `wiki_articles`) and to any reordering by `upsertRawFrontmatter`.
- The ingest extracts entities from the body; body change = real content change.
- **Known limitation:** a frontmatter-only edit (e.g. adding a `tags:` entry)
  does not trigger re-ingest. Acceptable — frontmatter is not ingested content.

FNV-1a is chosen over crypto so the module stays pure (no `node:crypto`); a
non-cryptographic hash is sufficient for change detection.

### 2 — detection rewrite (`computeChangedSources`, `src/incremental-sources.ts`)

New signature — drops `wikiPages` and all mtime inputs:

```ts
export interface SourceFileInfo { path: string; hash: string }  // hash = current body hash

export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];               // current on-disk sources
  analyzed: Record<string, string>;            // domain.analyzed_sources (path → stored hash)
}): { changed: string[]; baselined: Record<string, string> };
```

Rule, per source `S`:

1. `S.path` **not** in `analyzed` → **changed** (new / never-ingested source).
2. `analyzed[S.path] === ""` → **silent baseline**: add `S.path → S.hash` to
   `baselined`; **not** changed.
3. `analyzed[S.path] !== S.hash` → **changed** (body edited since last ingest).
4. else → skip.

`changed` = source paths to re-ingest. `baselined` = hashes the caller must
persist into the domain entry (migration fill — no ingest).

Remove the now-unused `WikiPageInfo` interface and the `mtime` field on
`SourceFileInfo`. `parsePageSources` stays (eval-covered, part of the module
API) but is no longer used by detection.

### 3 — plan wiring (`controller.computeIncrementalPlan`, `src/controller.ts`)

Replace the mtime/wiki-page gathering (`controller.ts:385-399`) with:

- For each source file: read its content, compute `hash = hashSource(content)`,
  push `{ path, hash }`.
- Drop the entire `wikiTFiles` / `wikiPages` block (no longer needed for
  detection). `wikiFileCount` (used by `ReinitModeModal` to describe what a full
  reinit wipes) is still derived from a plain file count under
  `domainWikiFolder(entry.wiki_folder)` (excluding `_config`).
- Call `computeChangedSources({ sourceFiles, analyzed: entry.analyzed_sources ?? {} })`.
- **Persist `baselined`**: if non-empty, merge into the domain entry and save via
  the existing domain-store path (a `domain_updated` patch with the merged
  `analyzed_sources`, or a direct `domainStore` write — whichever matches the
  surrounding code). This makes the silent baseline durable on first plan.
- Return `{ changed, totalSources, wikiFileCount }` unchanged in shape.

Remove the now-orphaned `VaultTools.mtime` consumers here; if `VaultTools.mtime`
has no other consumer, remove it too (and the `VaultAdapter.stat` member if it
was added solely for it — verify during implementation).

### 4 — hash write at ingest (the bookkeeping seam)

After a source is successfully ingested, store its fresh body hash so the next
plan sees a match. The hash is written **wherever `analyzed_sources` is updated
today**, so all ingest paths (full reinit, `--sources`, `--incremental`, and any
manual single-source ingest) are covered uniformly:

- `src/phases/init.ts` — the two bookkeeping spots that append to
  `analyzed_sources` (`init.ts:350-361` per-file complete; `init.ts:438-444`
  new-source bookkeeping). Instead of pushing a path into a list, set
  `analyzed_sources[file] = hashSource(<source content>)`.
  - The source content used for the hash is the **pre-ingest body** read for
    that file (the body is unchanged by the wiki_* frontmatter write, so reading
    before or after the write yields the same `sourceBodyForHash`).
- `src/types.ts` — the `domain_updated` patch `analyzed_sources` field type
  changes `string[]` → `Record<string, string>`.
- `src/domain.ts` — `applyDomainEvent` already merges `domain_updated` patches
  shallowly (`{ ...next[i], ...ev.patch }`, `domain.ts:72`); a full replacement
  map is passed in the patch (read-modify-write the map in `init.ts`, as the
  list is read-modify-written today).

### 5 — consumers retyped (mechanical, `string[]` → map)

`analyzed_sources` is read as a list in a few places; each switches to the map:

- `src/phases/init.ts:155-159` — `isResuming` / `alreadyAnalyzed`: build the set
  from `Object.keys(existing.analyzed_sources ?? {})`.
- `src/phases/init.ts:283-295` — initialisation of `analyzed_sources` to `[]`
  becomes `{}`.
- `src/phases/delete.ts:71-78` — dropping a source on delete: `delete
  map[path]` (or rebuild the map without the key) instead of `Array.filter`;
  emit the updated map in the `domain_updated` patch.

## Removed / no-longer-load-bearing

- **Wiki page mtimes + `wiki_sources` in detection** — gone from the decision.
- **A2 reorder** (`src/phases/ingest.ts:326-378`, write source before pages) was
  introduced *solely* to keep the mtime invariant honest. With hash-based
  detection it is no longer load-bearing. **Leave it in place** — it is benign
  and removing it is a separate, out-of-scope behavior change (event order).
  Noted here so a future reader knows it is now optional.

## End-to-end flow (the stuck vault)

```
Upgrade → migrate v3: analyzed_sources list → {path: ""} for all 4 ai-agent sources.
First plan:
  each source: cur = hashSource(body); analyzed[path] == "" → baseline: analyzed[path]=cur, NOT changed.
  persist baselined → _domain.json now holds real hashes.
  changed = []  →  Incremental button shows 0.   ← fixes the bug
Edit agent-systems-guide body:
  next plan: cur != stored → changed = [agent-systems-guide].
Re-ingest:
  bookkeeping sets analyzed[agent-systems-guide] = new hash.
  next plan: cur == stored → not changed.
```

## Edge cases

- **New source** (in `source_paths`, no `analyzed_sources` key) → changed →
  ingested; bookkeeping adds key+hash.
- **Source deleted from disk but key remains** → not in `sourceFiles` → never
  evaluated; key is pruned when the source is removed via `delete.ts`. A stale
  key for a vanished file is inert (no source to flag).
- **Source manually deleted from vault then re-added with same body** → key
  exists with old hash; if body identical → not changed (correct, wiki already
  reflects it). If body differs → changed.
- **Barren source (zero pages extracted)** → still gets a key+hash at ingest
  bookkeeping, so it is **not** re-flagged every run (an improvement over the
  prior mtime design, which re-listed barren sources forever).
- **Frontmatter-only edit** → body hash unchanged → not re-ingested (documented
  limitation in Component 1).
- **Hash collision** (FNV-1a, 32-bit) → a real edit hashing to the same value is
  missed. Probability negligible for this use; if ever a concern, widen to
  64-bit FNV without changing the shape (the `fnv1a:` prefix already gates it).

## Verification plan

1. **Unit (out-of-vault, `eval/incremental-source-hash/`)** —
   `sourceBodyForHash` (frontmatter strip, no-frontmatter passthrough),
   `hashSource` determinism + prefix, and `computeChangedSources` across: new
   source (no key), baseline (`""` → baselined, not changed), unchanged
   (`hash == stored`), changed (`hash != stored`). Assert `baselined` is returned
   for the `""` case only.
2. **Migration unit** — `migrateDomainsV3` converts a list domain to a map with
   `""` values and sets the flag; idempotent on a second run; leaves a
   map-shaped (already-v3) domain untouched.
3. **Integration (node fs, no LLM)** — write a source, baseline it, assert
   `changed == []`; edit the body, assert `changed == [that file]`; re-store the
   new hash, assert `changed == []` again.
4. **Manual e2e** — on the real `ai-agent` vault: open incremental reinit →
   after baseline, the dialog shows **0** for the three stuck sources; edit one
   source body → it shows **1**; confirm only that source re-ingests; re-open →
   **0**.

## Out of scope

- Removing the A2 reorder (kept, now optional).
- Re-ingesting barren sources more cleverly.
- 64-bit hash (32-bit FNV-1a is sufficient; widening path noted).
- Mobile (reinit/ingest already desktop-only).

## Stop rules

- **Halt** if full reinit (`--force`) changes produced artifacts (pages / index /
  domain entry) beyond the `analyzed_sources` shape change.
- **Done** when, on the `ai-agent` vault, the incremental dialog shows `0` after
  baseline with no source edited, shows exactly the edited source after a body
  edit, and a re-ingest returns the dialog to `0`.
