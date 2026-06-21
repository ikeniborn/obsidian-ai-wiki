---
review:
  intent_hash: a9c67bb4ab05b74f
  last_run: 2026-06-21
  phases:
    structure:    { status: passed }
    completeness: { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
    alignment:    { status: passed }
  findings:
    - id: F-001
      phase: consistency
      severity: WARNING
      section: Constraints
      section_hash: cc607414906f773e
      text: >-
        Permanent (irreversible) source-file deletion is in tension with the
        trust-first priority ("never lose or corrupt data"). Recommend the
        confirm modal explicitly state that source deletion is permanent and
        not recoverable from trash.
      verdict: accepted
      verdict_at: 2026-06-21
    - id: F-002
      phase: consistency
      severity: WARNING
      section: Constraints
      section_hash: cc607414906f773e
      text: >-
        With "continue + collect errors" failure handling plus permanent source
        deletion, a mid-run rebuild failure can leave the source gone forever
        while some multi-source pages stay stale. Recommend deferring the
        permanent source-file deletion until after all rebuilds succeed, or
        recording this ordering risk in the plan.
      verdict: accepted
      verdict_at: 2026-06-21
---
# Intent: Source deletion with wiki-artifact cleanup and multi-source rebuild

**Date:** 2026-06-21
**Status:** approved

## Objective

Deleting a source today leaves orphaned wiki pages in the base — index noise that
degrades retrieval and the graph. There is no first-class "delete source" operation:
users must hunt down and remove pages by hand, then repair `wiki_sources`, backlinks,
and `_index.md` — slow and error-prone. Pages built from several sources keep the
deleted source's contribution as stale, factually-wrong content. The sidebar also has
no distinct delete affordance, so format and a would-be delete are not visually
separated.

Add a dedicated **Delete source** operation that removes the source file and every wiki
artifact tied to it, with no leftovers. When a wiki page derives from more than one
source, it is not deleted but **rebuilt sequentially on the remaining sources** so its
content reflects only those.

## Desired Outcomes

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

## Health Metrics

- **Graph / index integrity.** After deletion: no broken `[[links]]`, no orphaned
  `_index.md` lines, no dangling graph edges, no stale embedding chunks. Wiki lint/check
  reports clean.
- **Other operations untouched.** ingest / lint / format / query / init keep working; the
  new code does not break shared phases or the `RunEvent` stream.
- **Path-traversal guard intact.** Deletion cannot escape the domain/vault
  (`validateArticlePath`); never removes foreign files or files of other domains.
- **Mobile + both backends.** Works on mobile (lazy node-builtins, `requestUrl`) and on
  both backends (Native Agent / Claude); rebuild requires nothing desktop-only.

## Strategic Context

- Interacts with: `ingest` (rebuild), `lint` (backlink/index sync), `wiki-graph`,
  embeddings cache, `DomainStore` (source_paths/analyzed_sources), `AiWikiView` sidebar,
  `VaultTools` (remove/trash), `validateArticlePath`.
- Priority trade-off: **trust** — never lose or corrupt data; preview must be accurate;
  rebuild must not drop remaining sources' contribution; confirmation mandatory. Slower /
  costlier (more LLM calls) is acceptable.

## Constraints

### Steering (behavioral guidance)

- Rebuild mechanic: **wipe + sequential re-ingest** — the multi-source page is deleted and
  rebuilt from scratch by running ingest over each remaining source one at a time
  (matches "пересобрана последовательно на всех источниках"). Chosen over cheap
  strip/merge because trust outranks speed/cost.
- Failure handling: **continue and collect errors** — if one page's rebuild fails, keep
  going with the rest and report the list of failures at the end (maximize progress per
  run), rather than aborting on first error.
- Reuse existing deletion plumbing where possible: `vaultTools.remove`,
  `removeIndexAnnotation`, backlink sync, `validateArticlePath` — do not invent a parallel
  path.

### Hard (architectural enforcement)

- Source file removal is **permanent** (not moved to trash), per user decision.
- Delete operation is **available only for source files** — a non-wiki file present in the
  active domain's `source_paths`. The button is disabled for wiki pages and non-source
  files (mirrors how `formatBtn` is gated to active non-wiki files).
- Every deletion path is validated by `validateArticlePath` (must be `<domain>/<file>.md`
  inside the wiki folder); reject any `..`/`.` segment — no path traversal, no
  cross-domain deletion.
- All development in a `dev/*` branch; merge to `master` only via PR (project branch
  rules).
- Must function on Obsidian mobile and on both backends; no desktop-only API on the
  delete/rebuild path.

## Autonomy Zones

- **Full autonomy (reversible, low risk):** internal code structure of the delete phase,
  the affected-pages computation, wiring the sidebar buttons, unit/eval (out-of-vault)
  tests, `dev/*` branch creation and commits.
- **Guarded (log + confidence threshold):** reuse vs. new helpers in the deletion path;
  exact wording of preview/progress `info_text` strings.
- **Proposal-first (needs approval):**
  - Spec/design before writing code (brainstorm + plan shown for approval).
  - UX of the confirmation modal and the Format/Delete button placement/icons.
  - Real deletion run against a live vault (otherwise use the out-of-vault eval harness).
  - PR creation and merge into `master` (hard project rule; held as a checkpoint
    regardless of the autonomy answer).
- **No autonomy (human only):** none beyond the proposal-first checkpoints above.

> These zones OVERRIDE subagent-driven-development's "continuous execution, don't pause"
> default. Any task touching proposal-first decisions is marked HUMAN CHECKPOINT in the
> plan.

## Stop Rules

- **Halt if:** the affected-pages preview cannot be computed accurately (e.g. unreadable
  `wiki_sources`), or a deletion path fails `validateArticlePath` — do not delete on a
  guess.
- **Escalate if:** rebuild would require touching files outside the active domain, or the
  source-to-page mapping is ambiguous (a page references the source by an unresolvable
  name).
- **Done when:** on a real vault, clicking **Delete** on a source shows a preview with the
  correct delete/rebuild counts and lists; on confirm, the source file is permanently
  removed and dropped from the domain config, every sole-source page is gone, every
  multi-source page is rebuilt on its remaining sources, and wiki lint/check reports zero
  orphans, zero broken links, and no stale index/graph/embedding artifacts — with any
  rebuild failures surfaced in the final report rather than left silent.
