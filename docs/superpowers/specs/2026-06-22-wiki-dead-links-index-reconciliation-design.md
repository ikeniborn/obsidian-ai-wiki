---
review:
  spec_hash: 5ac0478ad0860003
  last_run: 2026-06-22
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: null
---

# Wiki Dead-Link Removal & Index Reconciliation — Design

**Date:** 2026-06-22
**Branch:** `dev/wiki-link-index-hygiene`
**Status:** Design — awaiting review

## Problem

Investigation of a real wiki (`!Wiki/rtk-task`, 52 pages) surfaced two correctness defects that degrade query quality and add noise. Both share one root cause.

### Bug 1 — Dead links survive ingest and lint

A `[[stem]]` pointing to a page that does not exist (no wiki page and no source note for that stem) is never removed from article **bodies**, even with LLM disabled. Example: `wiki_rtk-task_ch_mete_s3_ddrd.md` links to `[[wiki_rtk-task_ch_mete_s3_ddrdrg]]` six times (body prose, characteristics table, frontmatter `wiki_outgoing_links`); no such file exists anywhere in the vault.

Current deterministic handling is incomplete and self-conflicting:

- `fixWikiLinks` (`src/wiki-link-validator.ts`, called from `ingest.ts:313` and the lint LLM loop `lint.ts:378`) re-derives `wiki_outgoing_links` **from the body**. Dead links are only pushed to `warnings`; they are never stripped. A dead link in the body therefore propagates into the frontmatter.
- `filterStaleWikiLinks` (`src/utils/raw-frontmatter.ts:276`, lint post-loop `lint.ts:535`) removes dead entries **from `wiki_outgoing_links` only** — it never touches the body. This desyncs body and frontmatter; a later `fixWikiLinks` pass re-adds the dead link to the frontmatter from the still-dirty body.

Net: a dead link in an article body is removed by no deterministic pass, and the two existing mechanisms fight over the frontmatter. The lint prompt (`prompts/lint.md:11`, "remove or replace dead links") delegates this to the LLM, so it only ever happens (partially) with LLM enabled.

### Bug 2 — Pages missing from the index are invisible to retrieval

`_index.md` and the on-disk page set drift apart in **both** directions. Measured on `rtk-task` (45 index entries vs 52 page files):

- **11 pages on disk, absent from the index:** `ch_mete_s3_ddrd`, `clickhouse`, `dds`, `dg`, `dwm_89729` (a task, not just a reference entity), `dw_src_ord_key`, `gp`, `greenplum`, `jaga`, `minio`, `s3`.
- **4 index entries with no page on disk (orphans):** `dwm_86664`, `dwm_89228`, `dwm_89709`, `mmd`. (`dwm_89709` indexed but `dwm_89729` on disk suggests a rename/merge that never cleaned the index.)

This is critical because the index annotation is the **sole corpus for retrieval**. `refreshCache` (`src/page-similarity.ts:676,689`) embeds per index annotation: a pid with no index annotation is skipped from embedding (`if (!annotations[i] || ...) continue`) and scores ≈ 0 at query time (matches only pid tokens). The docs confirm this (`docs/wiki/retrieval.md#Embedding Cache`: "one `summary` vector (the one-line annotation)"). A page absent from the index is therefore invisible to query retrieval, per-entity retrieval at ingest, and lint context selection — it exists on disk but contributes nothing to any wiki query. Orphan index entries are the inverse noise: they get embedded and surface in results, pointing at non-existent pages.

## Root cause (unified)

The wiki relies on the LLM to (a) emit an `annotation` per page and (b) avoid dead links. Both are **prompt instructions, not enforced invariants**:

- `annotation: z.string().optional()` (`src/phases/zod-schemas.ts:44`). The ingest prompt asks for an annotation per page (`prompts/ingest.md:29`), but the LLM omits it for secondary reference entities. The ingest write loop gates indexing on `if (page.annotation)` (`ingest.ts:408`) and silently skips when absent — no fallback, no error.
- Dead-link avoidance is prompt-only (`prompts/ingest.md:31-33`). The deterministic validators (`fixWikiLinks`, `checkStructure`, `checkGraphStructure`) **detect and warn** but never **repair**.
- No reconciliation step guarantees the invariants `every page on disk ∈ index` and `every [[link]] resolves`. Lint backfills the index only for pages it actively rewrites with a fresh annotation (`lint.ts:398-401`); a correct-but-unindexed page is never recovered.

The fix is to add **deterministic enforcement** (repair, not just warn), independent of the LLM, at the points where pages are written.

## Decisions (confirmed with user)

1. **Dead link → remove the link entirely** (delete the `[[...]]` token, including its visible text), with whitespace/punctuation cleanup. Empty table cells are left as-is (consistent with "remove entirely").
2. **Index fix → both prevention and cure.** Prevent new gaps at ingest; cure existing drift (legacy pages + orphans) at lint.
3. **Reconciliation is bidirectional:** add missing pages to the index, remove orphan entries whose file is gone.
4. **Fallback annotation source:** `H1 + first body sentence + Type`, deterministic, LLM-free.
5. All new behavior must work **without the LLM** (the user observed dirty state even with LLM disabled).

## Approach

**Extend existing modules** (chosen over a new orchestrator module or schema-required annotation). Surgical, reuses existing call sites and helpers, follows repo patterns. All new logic is pure functions, unit-testable via the headless eval harness.

### Component 1 — `stripDeadLinks` (`src/wiki-link-validator.ts`)

New pure function: `stripDeadLinks(content: string, knownStems: Set<string>): string`.

1. Remove from the **body** every `[[stem]]` whose `stem ∉ knownStems`. `knownStems` is vault-wide (all `.md` stems + pages written this run + title-map stems), so a link to a real source note is **not** dead.
2. Clean artifacts left by removal: collapse double spaces, drop dangling ` ,` / ` .` / ` ;`, trim trailing spaces. Leave emptied table cells intact.
3. Re-derive `wiki_outgoing_links` from the **cleaned** body (reuse existing `setFmLinks`). Body and frontmatter end clean and synced — no desync, no re-add, no conflict with `filterStaleWikiLinks`.

Integrated into the `fixWikiLinks` flow so it runs **unconditionally** (not gated on `maxPasses`/retries), since it is deterministic and safe.

### Component 2 — `deriveFallbackAnnotation` (`src/wiki-index.ts`)

New pure function: `deriveFallbackAnnotation(content: string, entityType?: string): string`.

- Output: `"<H1> — <first non-empty body sentence>. Type: <entityType ?? 'general'>"`, single line (no newlines), truncated to ~600–800 chars to match the index annotation format.
- `entityType` resolved from the page's wiki subfolder or frontmatter by the caller; falls back to `general`.
- Produces a valid one-line annotation → on the next `refreshCache` the page gets a summary embedding and becomes retrievable. LLM lint later upgrades it to full `Covers:/Type:/Terms:`.

### Component 3 — `reconcileIndex` (`src/wiki-index.ts`)

New pure function: `reconcileIndex(indexContent, pageFiles, getAnnotation) → { adds: Array<{pid, section, annotation}>, removes: string[] }`.

- **Add:** a page file whose stem passes `GENERIC_WIKI_STEM_REGEX` and is not `_*`, but whose pid is absent from the index. Annotation = the run's annotation if present, else `deriveFallbackAnnotation`. Section via existing `deriveSection`.
- **Remove:** a pid present in the index with no corresponding page file on disk.
- Caller applies results through existing `upsertIndexAnnotation` / `removeIndexAnnotation` (the latter already drops empty sections).

### Integration points

**`src/phases/ingest.ts`**
- Wire `stripDeadLinks` into the `fixWikiLinks` step (~line 313); `knownStems` already computed there.
- Prevention: in the write loop, always index — `page.annotation ?? deriveFallbackAnnotation(content, type)` (replaces the `if (page.annotation)` skip at line 408).
- After the write loop: `reconcileIndex` over the domain's page files (`nonMetaPaths`).

**`src/phases/lint.ts`**
- In the always-on post-loop block (outside `if (useLlm)`, near line 535): run `stripDeadLinks` over every page body using the vault-wide `knownStems` (line 219), then re-sync frontmatter. This closes the body gap that `filterStaleWikiLinks` leaves; the existing `filterStaleWikiLinks` call may remain (now redundant for `wiki_outgoing_links`, harmless) — its removal is left to the implementation plan.
- Run `reconcileIndex` over the domain's page files — bidirectional. Runs with and without the LLM.

### Error handling

- Index writes stay non-critical (existing `try/catch … /* non-critical */` pattern) — a reconciliation failure must not abort ingest/lint.
- `stripDeadLinks` is pure string work; on a malformed page (no frontmatter) it operates on the whole content as body, matching `fixOnePass`'s existing fallback.
- Reconciliation never deletes page files — it only edits `_index.md`. Page deletion remains owned by `cleanupInvalidPages` / the delete phase.

## Testing

Headless eval harness (esbuild `--alias:obsidian=stub`, template `eval/format-frontmatter/`). No general unit-test suite exists; add pure-function coverage:

- `stripDeadLinks`: removes dead body link + frontmatter entry; keeps links to existing wiki pages and to source notes; whitespace/punctuation cleanup; emptied table cell tolerated; body/frontmatter stay synced.
- `reconcileIndex`: adds missing page (with real and fallback annotation); removes orphan; section placement; empty-section cleanup on removal.
- `deriveFallbackAnnotation`: `H1 + first sentence + Type`; single line; truncation; missing H1 / missing type fallbacks.

Fixtures derived from `rtk-task`: the `ch_mete_s3_ddrd` page (dead link + missing index entry) and the 4 orphan pids.

## Non-goals

- `format.ts` dead-link removal — a single-file format pass has no vault-wide corpus to judge deadness (would strip everything).
- Auto-creating stub pages for missing link targets.
- Making `annotation` schema-required with LLM retry (risks failing the whole batch; does not fix existing pages).
- Improving annotation quality beyond the fallback (LLM lint owns that).

## Docs update (post-implementation)

Update `docs/wiki/` via `iwiki:iwiki-ingest`, then `/iwiki-lint`:
- `operations.md` (Ingest, Lint Cleanup Pass) — new deterministic dead-link removal + index reconciliation.
- `retrieval.md` (Embedding Cache) — fallback annotation now guarantees every page has a summary vector.

## Verification criteria

1. After ingest **or** lint (LLM on or off) on `rtk-task`, `grep` finds no `[[wiki_rtk-task_ch_mete_s3_ddrdrg]]` in any page (body or frontmatter).
2. Index ↔ disk diff is empty: every page file has an index entry; no index entry lacks a file.
3. `ch_mete_s3_ddrd` (and the other 10) appear in `_index.md` and, after `refreshCache`, return from a relevant query.
4. New eval tests pass; no new `tsc` errors in touched files (baseline is not clean — gate on new errors only).
