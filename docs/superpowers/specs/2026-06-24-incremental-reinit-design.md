---
review:
  spec_hash: 810e1c64b771bd1f
  last_run: 2026-06-24
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "Component 6 — mtime invariant fix (A2 reorder)"
      section_hash: 1e0e700bb99fa638
      text: "Spec cites parseWikiArticles, but the codebase function is parseWikiArticlesFromFm (src/utils/raw-frontmatter.ts). Naming imprecision; function exists. Fix: rename the reference to parseWikiArticlesFromFm."
      verdict: fixed
      verdict_at: 2026-06-24
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "Component 3 — ReinitModeModal"
      section_hash: ff10384c688e5d53
      text: "Changed-list cap is illustrative only ('capped, e.g. first ~20, with a +K more line'); no exact acceptance value. Fix: state the concrete cap (e.g. cap = 20) so the DoD is testable."
      verdict: fixed
      verdict_at: 2026-06-24
    - id: F-003
      phase: consistency
      severity: INFO
      section: "Observable-behavior delta (Stop-rule boundary)"
      section_hash: null
      text: "Intent Health Metric says full reinit is 'byte-for-byte unchanged'; spec narrows this to 'produced artifacts (pages/index/domain) identical, not the event/IO trace'. Deliberate, explicitly reconciled and flagged HUMAN CHECKPOINT — recorded for traceability, not a contradiction."
      verdict: open
      verdict_at: null
chain:
  intent: docs/superpowers/intents/2026-06-24-incremental-reinit-intent.md
---
# Design: incremental-reinit

**Date:** 2026-06-24
**Status:** approved (design)
**Intent:** [docs/superpowers/intents/2026-06-24-incremental-reinit-intent.md](../intents/2026-06-24-incremental-reinit-intent.md)

## Objective

Domain re-init today supports only a full rebuild: `--force` wipes the whole
wiki folder and re-ingests every source. Add an **incremental** mode: at reinit
start the user chooses **Full** or **Incremental**. Incremental re-ingests only
the sources that changed since the wiki last reflected them, after the user
confirms the list.

A source is "changed" when its vault-file modification time is newer than its
associated wiki page(s), or when it has no wiki page yet (new source).

## Success criteria (from intent)

- At reinit start the user picks Full or Incremental.
- Incremental shows a dialog listing only changed sources + a confirm button;
  the Incremental button is disabled when the list is empty.
- On confirm, ingest runs sequentially over **only** that list; untouched
  sources are never re-ingested.
- A new source (in `source_paths`, no wiki page yet) appears in the list and is
  ingested.
- Full reinit (`--force`) output is unchanged (wiki pages, `_index.md`, domain
  entry identical).
- The changed-source list is a strict subset of all sources — incremental must
  not silently collapse into full.

## Architecture overview

```
reinit click (src/view.ts#runReinit)
  ├─ controller.computeIncrementalPlan(domainId) → { changed: string[], totalSources, wikiFileCount }
  └─ ReinitModeModal(full, incremental(N))            (src/modals.ts)
       ├─ Full        → controller.init(id, false, sources, force=true)        [unchanged path]
       └─ Incremental → list + confirm → controller.init(id, false, changed, force=false, incremental=true)
                          └─ runInit '--incremental' branch (src/phases/init.ts):
                               loop runIngest(file) over `changed`, no wipe / no bootstrap / no reset
```

Touch points (the intent's Strategic Context files, plus the shared-ingest fix):

1. `src/vault-tools.ts` — new mtime accessor (`VaultAdapter.stat`, `VaultTools.mtime`).
2. `src/incremental-sources.ts` — **new** pure module: changed-source detection.
3. `src/modals.ts` — **new** `ReinitModeModal` (Full / Incremental selector + list).
4. `src/view.ts` / `src/controller.ts` — wiring: compute plan, open modal, dispatch.
5. `src/phases/init.ts` — `--incremental` branch (loops `runIngest`).
6. `src/phases/ingest.ts` — **mtime invariant fix (A2 reorder)** — HUMAN CHECKPOINT.

## Component 1 — mtime accessor (`src/vault-tools.ts`)

Add to `VaultAdapter`:

```ts
/** File modification time in epoch ms; null when the path has no stat. */
stat?(path: string): Promise<{ mtime: number } | null>;
```

The Obsidian `DataAdapter` already implements `stat()`. Add to `VaultTools`:

```ts
async mtime(vaultPath: string): Promise<number | null> {
  const s = await this.adapter.stat?.(vaultPath);
  return s ? s.mtime : null;
}
```

Phase code reads mtime only through `VaultTools.mtime` — it must not import
`obsidian` to get it (intent Hard Constraint).

## Component 2 — changed-source detection (`src/incremental-sources.ts`, pure)

Pure, dependency-free, testable out-of-vault (see [[Eval out-of-vault harness]]
pattern; mirrors `eval/format-frontmatter/`).

```ts
export interface SourceFileInfo { stem: string; path: string; mtime: number | null }
export interface WikiPageInfo   { path: string; mtime: number | null; sources: string[] } // sources = wiki_sources stems

export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];
  wikiPages: WikiPageInfo[];
}): { changed: string[] };   // changed = source paths to re-ingest
```

Rule, per source `S`:

1. `associated` = wiki pages whose `wiki_sources` contains `S.stem`.
2. `associated` empty → **include** (new / unreflected source).
3. `mtime(S)` unavailable, or any associated page mtime unavailable → **include**
   (trust bias: when ambiguous, include).
4. `mtime(S) > min(mtime of associated pages)` → **include**.
5. otherwise → skip.

**Strict `>` and `min` aggregation are load-bearing:**

- **`min`** (newer than the *oldest* associated page) maximises inclusion =
  trust bias.
- **Strict `>`** means equal mtimes count as "not changed". This is what makes
  the mtime invariant robust against sub-millisecond filesystem granularity:
  immediately after an ingest the pages are written *after* the source (see
  Component 6), so `min(pages) >= mtime(S)`; with strict `>` the source is not
  re-flagged even if the timestamps land in the same millisecond.

### Why `wiki_sources` is allowed for the source→page mapping

The intent forbids frontmatter fields as the **source of truth for freshness**
(`wiki_added` / `wiki_updated` dates must not drive the decision). The freshness
decision here keys only on `mtime`. `wiki_sources` is used solely to establish
the **structural** source↔page relationship (which page came from which source)
— it is not a timestamp and not the freshness signal. This is the only available
mapping; there is no non-frontmatter way to know which pages a source produced.

## Component 3 — `ReinitModeModal` (`src/modals.ts`)

Follows the existing `IngestScopeModal` / `DeleteSourceModal` pattern.

```ts
new ReinitModeModal(app, {
  changed: string[],        // changed source paths
  totalSources: number,
  wikiFileCount: number,    // pages a full reinit would wipe
}, (mode: "full" | "incremental") => void)
```

Layout:

- Title + a line describing Full (wipes `wikiFileCount` pages, re-ingests all).
- **Full** button → callback `"full"`.
- **Incremental (N)** button, `N = changed.length`; `disabled` when `N === 0`.
  Below it, a human-readable list of the changed source basenames, capped at the
  first 20, with a "+K more" line when the list is longer than 20.
- **Cancel**.

Choosing Incremental fires the callback directly (the list is already shown in
the same modal, satisfying "lists only the changed sources, plus a confirm
button" — the Incremental button *is* the confirm).

## Component 4 — wiring (`src/view.ts`, `src/controller.ts`)

`src/controller.ts`:

- New `computeIncrementalPlan(domainId): Promise<{ changed: string[]; totalSources: number; wikiFileCount: number }>`:
  - Resolve domain, expand `source_paths` to `.md` files (reuse `collectMdInPaths`).
  - For each source file, read `mtime` via `VaultTools.mtime`; derive `stem`.
  - List wiki pages under `domainWikiFolder(wiki_folder)` (exclude `_config`,
    `_index.md`, `_log.md`); for each, read `mtime` and parse `wiki_sources`
    (reuse `parseWikiSources` from `src/utils/vault-walk.ts`).
  - Call `computeChangedSources(...)`; return its result + counts.
- `init(...)` gains an `incremental?: boolean` parameter; when set it appends
  `--incremental` to the args (alongside `--sources <changed...>`, `force=false`).

`src/view.ts#runReinit`:

- Call `controller.computeIncrementalPlan(domainId)`.
- Open `ReinitModeModal` with the plan.
  - `"full"` → `controller.init(id, false, sourcePaths, true)` (unchanged).
  - `"incremental"` → `controller.init(id, false, changed, false, true)`.

`onFileError` wiring (the `FileErrorModal` retry/skip/stop flow) is passed
through exactly as the existing `--sources` init path does.

## Component 5 — incremental run (`src/phases/init.ts`)

New `--incremental` branch in `runInit` (placed before the existing `--force`
and `--sources` branches; mutually exclusive with `--force`).

Requirements:

- Requires an existing, already-initialised domain (has `entity_types`). Error
  otherwise.
- **No** `wipeDomainFolder`, **no** bootstrap (`DomainEntrySchema` call), **no**
  reset of `entity_types` / `analyzed_sources`.
- The explicit changed-source `.md` file list is provided via `--sources`
  (already expanded by the controller); the branch does **not** re-filter
  against `analyzed_sources` (the existing `runInitWithSources` resume-filter
  would wrongly drop already-analysed-but-edited files).

Loop (mirrors the per-source structure of `runInitWithSources` and `runDelete`):

```
yield init_start { totalFiles: changed.length }
for each file in changed:
  yield file_start
  for await ev of runIngest([file], …):              // ingest reused UNCHANGED
    yield ev
    if ev is domain_updated for this domain: merge entity_types into currentDomain
  on error: onFileError(file, err, canRetry) → skip / retry / stop   (same as runInitWithSources)
  if file not in analyzed_sources: append via domain_updated          // new source bookkeeping
  yield file_done
yield result { "<domain>: re-ingested K of N sources." }
```

`controller.dispatch` treats `--incremental` as the `init` op (graph-cache
invalidation already covers `init`).

## Component 6 — mtime invariant fix (A2 reorder) — HUMAN CHECKPOINT

### Problem

`runIngest` always writes the **source** file's frontmatter (`wiki_added` /
`wiki_updated` / `wiki_articles` backlinks). So the source's mtime is bumped to
"now" on **every** ingest — "the source mtime changed" is therefore useless as a
signal on its own. The only reliable discriminator between an ingest-caused bump
and a later **manual** edit is the **order** of the source vs its wiki pages:

- Right after ingest, source and pages were written within the same window.
- A manual edit touches only the source, not its pages.

So the discriminator is "is the source newer than its pages?". To make that
reliable we must guarantee, after every ingest, that **the wiki pages are not
older than the source** (pages written last). Currently the source is written
**last** (`src/phases/ingest.ts:543`, after the page-write loop), so the source
is newer than its pages and an unchanged source would be re-flagged on the next
incremental run — collapsing incremental into full.

This must hold for **all** ingest paths (manual ingest, delete re-ingest, full
reinit) — otherwise the first incremental run after any full reinit would flag
every source.

### Chosen approach: A2 — reorder (write source before pages)

Move the source-frontmatter computation **and write** to *before* the page-write
and delete loops, so the wiki pages are written last. Because the source-write
block currently depends on the *actual* results of the loops (`written[]`,
`deletedPaths[]`), it is recomputed from the **planned** sets, which are known
before any write:

- `pages` — the final planned page list (after path validation + stem-mask guard
  + WikiLink fix, around `ingest.ts:324`).
- `deletes` — `parseResult.value.deletes`, hoisted up and filtered to the valid
  set (same traversal + `validateArticlePath` checks the delete loop applies).

New order inside `runIngest`:

```
… pages finalised (~L324), deletes read & validated →
  plannedDeleteStems / plannedDeletePaths
  source-frontmatter block (computed from PLANNED data):
    existingArticles  = parseWikiArticlesFromFm(normalizedSource) − plannedDeleteStems
    mergedArticles    = union(existingArticles, plannedPageStems)
    wikiFileStems     = (existingPaths + plannedPagePaths) − plannedDeletePaths − _index.md
    write source                         ← SOURCE WRITTEN HERE
    emit source_path_added
  page-write loop                         ← PAGES WRITTEN LAST
  delete loop
  reconcile index, summary, entity_types_delta, refreshCache, result
```

The guard `if (written.length || deletedPaths.length)` becomes
`if (pages.length || plannedDeletePaths.length)`.

### Accepted trade-offs (plan ↔ actual divergence)

Source backlinks are now computed from the planned page set, not the actual
writes. They diverge in two rare cases:

1. **A page write fails** → a backlink points at a page that was not created.
   Rare; `stripDeadLinks` + lint heal it on the next pass.
2. **dedup-merge** (`dedupOnIngest`, default **off**) → a new page is merged into
   an existing `targetPath`, but the planned backlink names `page.path`. Only
   when dedup is enabled; lint heals it.

Neither affects the mtime feature: detection needs only `page mtime >= source
mtime`, which A2 guarantees **structurally** by write order — not by relying on a
rewrite bumping mtime. Backlink accuracy is a separate, self-healing concern.

### Observable-behavior delta (Stop-rule boundary)

A2 changes the shared ingest pipeline for **all** paths:

- **Event order**: `source_path_added` is now emitted before the page-write
  `tool_use` / `tool_result` events.
- **Backlinks** computed from planned vs actual (rare divergence above).

Wiki page **content**, `_index.md`, and the domain entry are **unchanged**. The
intent's "full reinit byte-for-byte unchanged" is read as: the produced artifacts
(pages / index / domain) are identical — not the event/I-O trace. This reorder is
the intent's explicit Proposal-first / HUMAN CHECKPOINT item; it is flagged as
such in the implementation plan.

## Edge cases

- **N = 0** → Incremental button disabled.
- **New source, no wiki page** → `associated` empty → included; ingested.
- **Source whose pages were deleted manually** → `associated` empty → included.
- **Shared page** (one page from several sources) → a later source's ingest
  bumps the shared page's mtime; `min` aggregation + strict `>` keep an unedited
  source un-flagged (verified in the worked example below).
- **Source that yields zero wiki pages** (no extractable entities) → the source
  frontmatter write is skipped (`pages.length === 0`), no pages exist →
  `associated` empty → included on every incremental run, re-ingesting a barren
  source with no effect. Accepted known limitation; documented, not fixed here.
- **Mobile** → reinit and ingest are already desktop-only (the dispatch guard
  blocks `init` / `ingest` on mobile); incremental is desktop-only too.

### Worked example (shared page, strict `>` + min)

```
Source A → pages P1, P2.   Source B → pages P2, P3 (P2 shared).
Ingest A @T0: write source A (T0), then write P1,P2 (T0+ε).        → P1,P2 = T0+ε ;  A = T0
Ingest B @T1: write source B (T1), then write P2,P3 (T1+ε).        → P2,P3 = T1+ε ;  B = T1
Detection for A (unedited, A=T0): min(P1=T0+ε, P2=T1+ε) = T0+ε ; T0 > T0+ε? no → not flagged ✓
User edits A @T2:                                                     T2 > T0+ε? yes → flagged ✓
```

## Verification plan

1. **Unit** — `computeChangedSources` over synthetic inputs: strict `>`, `min`
   aggregation, trust-bias inclusions (null mtime, empty associated). Out-of-vault.
2. **Integration (node fs, no LLM)** — replay the A2 write order against the real
   filesystem (write source, then write page) and assert
   `mtime(page) >= mtime(source)`, then assert `computeChangedSources` returns
   `[]` for the unedited set and `[that file]` after touching one source.
3. **Manual e2e** — scratch vault via the homelab LLM (see [[Prompt test via
   homelab LLM]]): full reinit → incremental shows `0`; edit one source →
   incremental shows `1`; confirm only that source re-ingests.

## i18n

New keys in `src/i18n.ts` for `ru` / `en` / `es`: `ReinitModeModal` title, Full
/ Incremental button labels, the changed-list header and "+K more" line, the
empty-state. Incremental run progress strings go through `resolveLang` like the
rest of the pipeline.

## Out of scope

- Persisted "last re-ingest" timestamps (forbidden by intent).
- Any change to the per-source ingest pipeline beyond the A2 reorder.
- Re-ingesting barren (zero-page) sources more cleverly (known limitation above).
- Mobile support for reinit/incremental.

## Stop rules (from intent)

- **Halt** if full reinit (`--force`) changes produced artifacts (pages / index
  / domain entry).
- **Escalate** if the mtime comparison cannot reliably exclude unmodified sources
  without persisting state.
- **Done** when, on a vault with N sources where only K were edited, the
  incremental dialog shows exactly K (plus new sources), ingest runs only on
  those, and a full reinit on the same vault is unchanged.
