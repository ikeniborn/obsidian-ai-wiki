---
review:
  intent_hash: d9236cda1ec04930
  last_run: 2026-06-24
  phases:
    structure:    { status: passed }
    completeness: { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
    alignment:    { status: passed }
  findings: []
---
# Intent: incremental-reinit

**Date:** 2026-06-24
**Status:** approved

## Objective

Domain re-init currently supports only a full rebuild: `--force` wipes the
whole wiki folder and re-ingests every source sequentially. That is expensive
when only a handful of sources changed. Users edit a few source notes, then have
to either run a full reinit or manually find and ingest each changed source.

Add an **incremental** re-init mode: at reinit start the user chooses Full or
Incremental. Incremental ingests only the sources that changed since the wiki
last reflected them, after the user confirms the list.

## Desired Outcomes

- At reinit start, the user picks a mode: **Full** or **Incremental**.
- Incremental opens a dialog listing only the sources whose vault file
  modification time is newer than their associated wiki page(s), plus a confirm
  button.
- On confirm, ingest runs sequentially over **only** that list; untouched
  sources are not re-ingested.
- The **Incremental** button is disabled when there is nothing to re-ingest.
- A source that is new (in `source_paths` but has no wiki page yet) appears in
  the list and is ingested.

## Health Metrics

- **Full reinit (`--force`) is byte-for-byte unchanged** — the incremental path
  must not alter the existing full-rebuild flow.
- **Incremental is a strict subset** — the changed-source list ⊆ all sources;
  unmodified sources are *never* re-ingested. (Critical: see the mtime-bump risk
  in Hard Constraints — if every source is always flagged, incremental collapses
  into full and the feature is pointless.)
- **Existing ingest pipeline unchanged** per source — entity extraction, wiki
  stem mask, link & index hygiene behave exactly as today for each listed source.
- **Source frontmatter is not touched** by the new selection logic — it only
  *reads* file mtime.

## Strategic Context

- Interacts with:
  - `src/view.ts` — reinit button / mode-selection UI.
  - `src/controller.ts` — `init` dispatch (`init(domain, dryRun, sourcePaths, force)`).
  - `src/phases/init.ts` — `--force` flow, `runInitWithSources`, `wipeDomainFolder`.
  - `src/phases/ingest.ts` — per-source ingest (reused unchanged).
  - `src/vault-tools.ts` — must expose a file mtime accessor (does not today).
  - `src/modals.ts` — new list+confirm dialog (pattern: `ConfirmModal`,
    `DeleteSourceModal`).
  - `src/domain.ts` — `DomainEntry` / `source_paths`.
- Priority trade-off: **trust**. Correctness over speed: when the mtime
  comparison is ambiguous, *include* the source (re-ingesting an unchanged
  source is acceptable; missing a changed one is not).

## Constraints

### Steering (behavioral guidance)

- When the mtime comparison is ambiguous, include the source (trust bias).
- The dialog list is human-readable (file name) and shows a count.
- Progress / messages follow the current UI language, like the rest of the
  pipeline (`resolveLang`).

### Hard (architectural enforcement)

- Incremental logic keys **only** on file modification time:
  mtime(source file) vs mtime(associated wiki page file). `wiki_added`,
  `wiki_updated`, and any frontmatter field are **forbidden** as a source of
  truth — they are visual/convenience only.
- No persisted "last re-ingest" timestamp. Every incremental run compares
  source mtime vs wiki-page mtime live.
- Full reinit (`--force`) path does not change.
- `VaultTools` gains a mtime-read method; phase code must not import `obsidian`
  directly to get it.
- **mtime invariant (known risk → HUMAN CHECKPOINT):** ingest writes both the
  wiki page and the source's frontmatter, bumping both files' mtime. The
  pipeline must guarantee that after a (re)ingest the associated wiki page is
  **not older** than its source (e.g. write the wiki page last), so an unchanged
  source is not falsely re-flagged on the next incremental run.
- Development on a `dev/*` branch; merge to `master` only via PR. No direct
  commit to `master`.

## Autonomy Zones

- Full autonomy (reversible, low risk): new mtime accessor in `VaultTools`, the
  list+confirm modal, the Full/Incremental mode selector in the reinit UI,
  i18n/text strings, source filtering by mtime.
- Guarded (log + confidence threshold): sequential ingest over the selected
  list, edge cases (new source with no wiki page, source whose wiki pages are
  missing).
- Proposal-first (needs approval): changing the **write ordering inside the
  existing ingest** to satisfy the mtime invariant — risk to the full-reinit
  flow. Marked HUMAN CHECKPOINT in the plan.
- No autonomy (human only): merge to `master` (PR only).

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the full reinit (`--force`) changes observable behavior.
- Escalate if: the mtime comparison cannot reliably exclude unmodified sources
  (i.e. the invariant above cannot be guaranteed without persisting state).
- Done when: on a vault with N sources where only K were edited, the incremental
  dialog shows exactly K (plus any new sources), ingest runs only on those, and
  a full reinit on the same vault is unchanged.
