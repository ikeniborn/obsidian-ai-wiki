---
review:
  spec_hash: a91c2d4bc0eefc9d
  last_run: 2026-06-21
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-06-21-source-deletion-intent.md
---
# Design: Delete source operation

**Date:** 2026-06-21
**Status:** draft
**Intent:** [`docs/superpowers/intents/2026-06-21-source-deletion-intent.md`](../intents/2026-06-21-source-deletion-intent.md) (approved)

A dedicated **Delete source** operation for the Obsidian AI wiki plugin. Deleting a
source removes the source file and every wiki artifact tied to it; wiki pages built from
more than one source are not deleted but rebuilt sequentially on their remaining sources.
A preview modal shows, before any change, how many pages will be deleted and how many
rebuilt. The sidebar exposes Format and Delete as separate buttons, both enabled only for
a source file of the active domain.

## Acceptance (from intent)

Carried verbatim from the approved intent doc — these are FIXED inputs.

### Desired Outcomes

- **Preview with counts before deletion.** A confirmation modal shown before any change
  lists: N wiki pages to be deleted (with the list), M wiki pages to be rebuilt (with the
  list) caused by removing this source. Deletion proceeds only on explicit confirm.
- **Full artifact cleanup.** Sole-source pages (where the deleted source is the only entry
  in `wiki_sources`) are physically removed, and so is the source file; the source is
  removed from `source_paths` / `analyzed_sources` of the domain; `_index.md` lines,
  `wiki-graph` edges, embeddings-cache chunks, and `wiki_articles` backlinks in other
  files are all cleaned. Zero orphans remain.
- **Multi-source pages rebuilt.** Pages with >1 source are rebuilt on the remaining
  sources; the deleted source's contribution is gone and `wiki_sources` is updated.
- **Separate sidebar buttons.** Format and Delete are two distinct buttons; both are
  enabled only on a source file (a non-wiki file that is in `source_paths`).

### Done when

On a real vault, clicking **Delete** on a source shows a preview with the correct
delete/rebuild counts and lists; on confirm, the source file is permanently removed and
dropped from the domain config, every sole-source page is gone, every multi-source page is
rebuilt on its remaining sources, and wiki lint/check reports zero orphans, zero broken
links, and no stale index/graph/embedding artifacts — with any rebuild failures surfaced
in the final report rather than left silent.

### Honored intent constraints

- **Hard:** source-file removal is permanent (`VaultTools` has no trash — `vault.adapter.remove`); Delete available only for source files in the active domain's `source_paths`; every deletion path validated by `validateArticlePath`; dev/* branch + PR to master; works on mobile and both backends.
- **Steering:** rebuild = wipe + sequential re-ingest; failure = continue + collect errors; reuse existing deletion plumbing (`vaultTools.remove`, `removeIndexAnnotation`, backlink sync, `validateArticlePath`).
- **Accepted review findings:** (F-001) the confirm modal explicitly states deletion is permanent and not recoverable; (F-002) the source file is deleted only after all multi-source rebuilds succeed — on any rebuild failure the source file is kept for retry.

## Existing infrastructure (reused, not reinvented)

The codebase already carries partial source-removal plumbing; the new operation builds on it.

- `WikiController.cleanupRemovedSources` (`src/controller.ts:381`) — iterates wiki pages, parses `wiki_sources`, deletes pages whose sources are all removed. **Gap:** uses `adapter.remove` directly (no `removeIndexAnnotation`), does not delete the source file, does not rebuild multi-source pages, no preview.
- `ManageSourcesModal` + `WikiController.updateDomainSources` (`src/controller.ts:375`) — edits `source_paths`.
- `parseWikiSources` (`src/utils/vault-walk.ts:19`), `parseWikiArticlesFromFm` (`src/utils/raw-frontmatter.ts:381`) — frontmatter readers.
- `runIngest` (`src/phases/ingest.ts:55`) — per-source ingest; reused for rebuild.
- `removeIndexAnnotation` (`src/wiki-index.ts:88`), `validateArticlePath` (`src/wiki-path.ts:26`) — deletion plumbing.
- Format dispatch reference: `WikiController.format` (`src/controller.ts:68`), sidebar `formatBtn` gating (`src/view.ts:391`).

## Architecture

Three isolated units, each independently testable:

1. **Pure planner** (`src/source-deletion.ts`) — no vault, no LLM. Single source of truth for what a deletion entails. Used by BOTH the preview modal and the execution phase, so displayed counts and the real action never diverge.
2. **Execution phase** (`src/phases/delete.ts`) — async generator yielding `RunEvent`s; orchestrates cleanup and rebuild, reusing `runIngest`.
3. **UI** — `DeleteSourceModal` (preview/confirm) + a sidebar `deleteBtn` (`src/view.ts`).

### 1. Pure planner — `src/source-deletion.ts`

```ts
interface DeletionPlan {
  toDelete: string[];          // sole-source page vault-paths (wiki_sources == {S})
  toRebuild: string[];         // multi-source page vault-paths (S ∈ wiki_sources, |sources| > 1)
  remainingSources: string[];  // dedup union(wiki_sources(toRebuild)) minus S, resolved to domain source paths
}

function computeDeletionPlan(
  sourcePath: string,
  domain: DomainEntry,
  pages: Map<string /*vaultPath*/, string /*content*/>,
): DeletionPlan;

function isSourceFile(path: string, domain: DomainEntry): boolean; // non-wiki AND path resolves into source_paths
```

- **Stem matching.** A page references the source when its `wiki_sources` contains the source's stem by exact stem equality (the source file's basename without `.md`), NOT the loose `s.includes(r)` substring test used by the legacy `cleanupRemovedSources` (which can false-match `note` against `note-2`). `remainingSources` resolves remaining `wiki_sources` stems back to actual files in `domain.source_paths`; a remaining stem that resolves to nothing is dropped and logged (it cannot be re-ingested).
- **`isSourceFile`** = path does not start with `!Wiki/` AND path equals a `source_paths` entry or sits under a `source_paths` folder entry. `source_paths` entries may be files or folders.
- Pure and deterministic → covered by an out-of-vault eval.

### 2. Execution phase — `src/phases/delete.ts`

New `WikiOperation` value `"delete"`. `AgentRunner.run` dispatches it to `runDelete`. The phase recomputes the plan itself via `computeDeletionPlan` (does not trust args beyond the source path), then:

```
1. Domain config: remove S from source_paths + analyzed_sources
   → emit source_path_removed (new event) + domain_updated{ analyzed_sources }
2. Wipe toRebuild pages: vaultTools.remove + removeIndexAnnotation (each path validateArticlePath-checked)
3. For each remainingSource (sequential): yield* runIngest(remainingSource, ...)
   → rebuilds the affected pages; collect per-source errors, DO NOT abort (continue + collect)
4. Delete toDelete (sole-source) pages: vaultTools.remove + removeIndexAnnotation
5. Backlink cleanup: strip deleted page stems from wiki_articles of other source files
6. IF zero rebuild failures → permanently delete S (vaultTools.remove on the source file)
   ELSE → keep S, report "source kept, K rebuilds failed — retry"
7. Invalidate domain graph + similarity caches (embeddings self-heal via the step-3 ingest)
8. Emit result: "Deleted source X. Pages deleted N, rebuilt M (K failed). [failure list]"
```

- **Ordering honors F-002:** the source file (step 6) is removed only after the rebuild loop (step 3) completes with no failures. The deleted source is never an input to any rebuild (rebuilds run on *remaining* sources), so its removal cannot corrupt a rebuild.
- **Path safety:** every page deletion validated by `validateArticlePath` (`<domain>/<file>.md`, no `..`); reject otherwise (Stop Rule: halt on invalid path).
- **Progress:** `info_text` events per step; the final `result` event carries the counts and failure list.

### 3. UI

**Sidebar** (`src/view.ts`): add `deleteBtn` next to `formatBtn` on both the desktop button row (~`src/view.ts:349`) and the mobile row (~`src/view.ts:180`), with a distinct icon (e.g. `trash`) so Format and Delete are visually separate. In `updateButtonAvailability()` replace the current Format gate (`!path.startsWith("!Wiki/")`) with a shared `isSourceFile(activeFile.path, domain)` test applied to BOTH `formatBtn` and `deleteBtn`. This tightens Format to source files of the active domain (intent Desired Outcome #4).

**`DeleteSourceModal`** (new, under the existing modals location): the controller scans via `computeDeletionPlan` and passes the plan to the modal, which renders:

> Delete source **`<name>`**? This **permanently** deletes the source file and **N** wiki pages: [list]. **M** pages will be rebuilt on their remaining sources: [list]. This action is permanent and cannot be undone (not recoverable from trash).

Confirm → `controller.deleteSource(domainId, path)` → `dispatch("delete", [path], domainId)`. Cancel → no-op.

**`WikiController.deleteSource(domainId, path)`** — loads the domain, reads the wiki pages map, builds the plan, opens `DeleteSourceModal`; on confirm dispatches the `delete` operation.

### Data flow

```
sidebar deleteBtn (gated isSourceFile)
  → controller.deleteSource(domainId, path)
    → computeDeletionPlan (scan pages)         [pure]
    → DeleteSourceModal (preview N/M + lists, permanent warning)
      → confirm → dispatch("delete", [path], domainId)
        → AgentRunner.run → runDelete
          → computeDeletionPlan (recompute)    [pure, single source of truth]
          → config update / wipe / yield* runIngest×remaining / delete sole / backlinks
          → conditional source-file delete (F-002) / cache invalidate
          → RunEvent stream → controller dispatch loop persists domain events → view renders progress + result
```

## Error handling

- **Rebuild failure (per source):** caught, recorded, loop continues (steering: continue + collect). Surfaced in the final result and as an `info_text`. Source file kept (F-002).
- **Invalid deletion path:** `validateArticlePath` rejects → skip that path, emit a warning (never delete outside `<domain>/<file>.md`).
- **Source path resolves to nothing / plan cannot be computed:** halt before any deletion, report (Stop Rule).
- **Abort signal:** honored between steps like other phases (`RunRequest.signal`).
- **Mobile / both backends:** no desktop-only API on the path; rebuild uses the same `runIngest` that already runs on mobile and both backends.

## Testing

- **Out-of-vault eval** `eval/source-deletion/run.ts` over `computeDeletionPlan` (esbuild `--alias:obsidian=stub`, mirroring `eval/format-frontmatter/`):
  - sole-source page → `toDelete`, not `toRebuild`.
  - multi-source page → `toRebuild`, `remainingSources` excludes S.
  - page not referencing S → ignored.
  - two rebuild pages sharing a remaining source → `remainingSources` deduped.
  - stem matching: `note` vs `note-2` does not false-match; path-style vs stem-style `wiki_sources` entries both resolve.
  - remaining stem resolving to no source file → dropped.
  - `isSourceFile`: wiki page → false; file under a `source_paths` folder → true; unrelated file → false.
- **Real-vault manual run** (proposal-first, with user consent): execute a delete on a domain with both a sole-source and a multi-source page; verify counts in the modal, the source file gone, sole page gone, multi page rebuilt, and `lat`/lint check clean. Verifies the "Done when" outcome (green eval ≠ outcome).

## Out of scope

- Bulk/multi-source deletion in one action (one source at a time).
- Undo / trash recovery (deletion is permanent by intent).
- Changes to `ManageSourcesModal` / `cleanupRemovedSources` beyond what the new path needs (no unrelated refactor); the legacy cleanup stays for the source-paths-edit flow.
