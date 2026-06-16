---
review:
  intent_hash: d38840d0b9b32010
  last_run: 2026-06-17
  phases:
    structure:    { status: passed }
    completeness: { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
    alignment:    { status: passed }
  findings: []
---
# Intent: drop wikilinks from _index.md

**Date:** 2026-06-17
**Status:** approved

## Objective
The per-domain `_index.md` stores one line per page as `- [[pid]] relpath — annotation`.
Each `[[pid]]` is a wikilink, so Obsidian's graph view renders `_index.md` as a single
hub node linked to every page in the domain — visual noise that buries the real
page-to-page structure.

Remove the `[[ ]]` wikilink syntax from `_index.md` lines so the index hub disappears
from the Obsidian graph view, **without** degrading ingest/query quality. The internal
BFS wiki graph (`buildWikiGraph`) already excludes `_index.md` via `META_FILES`, so the
retrieval graph is unaffected — the hub is purely an Obsidian graph-view artifact.

The only programmatic dependency on the line format is `parseIndexAnnotations`, which
extracts the `pid` (key for seeds/similarity/annotations across the whole domain) and the
annotation text. The `relpath` field is currently NOT consumed by any tool path — query
re-globs the vault and reads pages by reconstructed `${wikiVaultPath}/${pid}.md`; ingest
uses LLM-proposed paths. The `relpath` lives only as raw text inside the LLM context block.

## Desired Outcomes
- Obsidian graph view: `_index.md` has zero edges to pages (hub gone).
- `parseIndexAnnotations` extracts the same `pid → annotation` map as before — query seeds,
  similarity ranking, and ingest dedup are byte-for-byte unaffected.
- New line format is `- pid — annotation` (no wikilink, no path).
- On plugin update, all existing `_index.md` files are auto-migrated from the old
  `- [[pid]] relpath — annotation` format to the new format, idempotently.
- `npm run lint` clean, `lat check` green, ingest + query on a test domain return the same
  page set as before the change.

## Health Metrics
- Query seed quality: same top-K pages for the same test questions (pid keys unchanged).
- Ingest dedup: same cosine threshold and same merge decisions.
- LLM context (`index_block`): no programmatic regression — the dropped `relpath` was never
  used for tool calls; `pid + annotation` remains.
- Parser: after migration, `parseIndexAnnotations` parses the new format correctly; the old
  `[[pid]] relpath` format no longer appears in any index.
- Migration idempotency: re-running migration on an already-migrated index is a no-op.

## Strategic Context
- Interacts with: `query.ts` (seeds, similarity, `index_block`), `ingest.ts` (dedup,
  `indexContent`, upsert/remove), `lint.ts` (read annotations, upsert on fix),
  `wiki-index.ts` (parser + upsert/remove — regex and line format change here), the plugin
  migration mechanism (`storage-migration.ts` / `migrate-wiki-prefix.ts` pattern), and the
  Obsidian graph view (end consumer). People: user browsing the Obsidian graph; the LLM
  reading index text in prompts.
- Priority trade-off: **trust**. Migration must never corrupt an existing `_index.md` —
  a lost annotation means lost seeds for the whole domain. Speed and cost are irrelevant here.

## Constraints
### Steering (behavioral guidance)
- Minimum code, surgical edits, match surrounding style.
- Reuse the existing migration mechanism (`storage-migration.ts` / `migrate-wiki-prefix.ts`
  pattern) — do not introduce a new migration framework.
- Update `lat.md/` (wiki-graph or the index-format section) to describe the new line format.

### Hard (architectural enforcement)
- Do NOT touch the BFS wiki graph `buildWikiGraph` — it already excludes `_index.md`;
  changing it would break query.
- `parseIndexAnnotations` MUST keep returning a correct `pid → annotation` map (the seed key
  for the entire domain).
- Migration MUST be non-destructive: no annotation is lost; on parse failure, do not write a
  corrupted index.
- `npm run lint` clean; `tsc` introduces no NEW errors in touched files; `lat check` green.
- No functional tests (project rule) — verify by running real ingest/query and inspecting output.

## Autonomy Zones
- Full autonomy (reversible, low risk): regex change in `parseIndexAnnotations`, line format
  in `upsertIndexAnnotation`/`removeIndexAnnotation`, `lat.md` update, lint fixes.
- Guarded (log + confidence threshold): migration execution — log how many files and lines
  were converted.
- Proposal-first (needs approval): the migration hook point in the plugin lifecycle (where it
  runs on update); show a dry-run preview before writing files. **HUMAN CHECKPOINT.**
- No autonomy (human only): overwriting `_index.md` files without first validating that every
  annotation is preserved. **HUMAN CHECKPOINT.**

## Stop Rules
- Halt if: a line in an existing index does not match the old-format regex (unknown format) —
  do not silently drop it; report and stop.
- Escalate if: migration loses any annotation (before/after count mismatch).
- Done when, on a real domain:
  1. Obsidian graph view shows `_index.md` with no edges to pages.
  2. `parseIndexAnnotations` yields the same `pid → annotation` count before and after.
  3. ingest + query on a test domain return the same page set as before.
  4. `npm run lint` and `lat check` are both green.
