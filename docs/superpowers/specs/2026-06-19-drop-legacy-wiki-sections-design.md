---
review:
  spec_hash: b5817842867f5851
  last_run: 2026-06-19
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "4. A/B eval (out of vault)"
      section_hash: c6aa57b4fedde471
      text: "'Δ negligible' / 'on-topic scores ≈ equal' lacks a numeric threshold; set an explicit epsilon (e.g. |Δ| < 0.02 cosine) as the assertion bound."
      verdict: open
      verdict_at: null
chain:
  intent: null
---
# Drop legacy wiki sections (Related concepts + Change history) — Design

## Problem

Generated wiki pages carry two sections that duplicate data held elsewhere and add
noise to the vector index:

- **`## Связанные концепции` / `## Related concepts`** — a body restatement of the
  `wiki_outgoing_links` frontmatter. The knowledge graph is built **only** from
  `wiki_outgoing_links` (`src/fusion.ts` → `src/wiki-graph.ts`); the body section
  contributes nothing to graph retrieval.
- **`## История изменений` / `## Change history`** — a body restatement of the domain
  log (`src/wiki-log.ts`: timestamp, source, per-path CREATED/UPDATED) plus the
  `wiki_sources` / `wiki_updated` frontmatter.

Both sections become their own embedding chunks (each H2 = one chunk in
`buildChunkInputs`), so they can only ever surface a page as a false positive.

## Why removal is safe and helpful (analytical proof)

Retrieval is hybrid: vector ⊕ graph, fused with RRF (`src/rrf.ts`, `src/fusion.ts`).

- **Graph side** is built purely from `wiki_outgoing_links`. Removing the
  `Связанные концепции` body section cannot change graph retrieval at all.
- **Vector side** scores a page as `maxCosine` across its chunk vectors
  (`src/page-similarity.ts`). Each section is a separate chunk. Removing a chunk can
  only **lower or keep** a page's max score, never raise it:
  - For an on-topic query, the winning chunk is a content section — unaffected.
  - The noise chunks (`Связанные концепции`, `История изменений`) can be the max
    **only** for off-topic queries (dates, "change history", bare link lists) — i.e.
    spurious matches.
  - Therefore removal strictly removes false positives: **precision up, recall
    unchanged.**
- **Bonus:** fewer chunks → fewer embedding API calls and a smaller cache.

This is provable from the architecture, not merely empirical. The A/B eval below
confirms it with real embeddings on a real page.

## Current state

- `## Связанные концепции` is already *optional* in the schema ("only when there is
  explanatory context"); `## История изменений` is recommended on updates.
- Decision: **fully remove both** from the template/schema so the LLM stops
  generating them.
- Re-indexing is **automatic**: `refreshCache` (`src/page-similarity.ts`) hashes
  chunks by content. Once a page body loses the sections, its chunk set changes,
  stale chunks drop, and only current-body chunks remain. No separate embeddings
  migration is needed.

## Components

### 1. Schema / template — stop generating both sections

- `src/phases/llm-utils.ts` `wikiSections()`: drop `related` and `history` from the
  optional list and from all three language heading maps (ru/en/es).
- `templates/_wiki_schema.md`: remove the change-history rule in `## Content`
  ("When adding information from a new source — record the date and source in the
  change-history section").
- Verify `src/phases/format.ts` and `src/phases/lint.ts` do not re-add these
  headings or flag their absence.

### 2. Pure helper `stripLegacySections(body)`

New module in `src/` exporting a pure function that removes the two H2 sections
(all three languages: `Связанные концепции`/`Related concepts`/`Conceptos
relacionados` and `История изменений`/`Change history`/`Historial de cambios`),
each from its heading up to the next H2 or EOF. Preserves frontmatter, H1, intro,
and all other sections. One real function, reused by both the migration and the
eval (mirrors the format-frontmatter eval philosophy of testing real pure logic).

### 3. Auto-migration on load — `src/migrate-drop-sections.ts`

Wired in `src/main.ts` `onload()` after the existing migrations. Idempotent, guarded
by a flag in local config (same pattern as `migrated_v1`).

For every domain wiki page (skip service files `_index.md`, `_log.md`,
`_wiki_schema.md`):

1. **Safety net:** before stripping, union any `[[links]]` found inside the
   `Связанные концепции` section into `wiki_outgoing_links` — guarantees no graph
   edge is lost even if a body link was missing from frontmatter.
2. Apply `stripLegacySections` to the body and write back.

After all pages are rewritten, trigger the existing vector refresh (`refreshCache`)
so the noise chunks fall out of the embeddings cache.

### 4. A/B eval (out of vault) — `eval/legacy-sections/run.ts`

Standalone TS harness (pattern of `eval/format-frontmatter/run.ts`): no Obsidian, no
live plugin.

- **Fixture:** the content of
  `notes/vaults/Work/!Wiki/adm-architect/tables/wiki_adm-architect_scd1.md`
  (inlined, since the eval must run independently of any vault).
- **Deterministic part (no key required):** run `splitSections` / `buildChunkInputs`
  on the fixture before and after `stripLegacySections`. Assert the two noise chunks
  disappear and the content chunks are byte-identical.
- **Retrieval A/B (only when embedding env vars are set):** embed both chunk variants
  plus a small query set:
  - on-topic: "SCD1 версионирование", "перезапись таблицы"
  - noise probes: "когда создана страница", "история изменений", "связанные концепции"

  Compute `maxCosine` page score per variant. Assert:
  - on-topic scores are ≈ equal across variants (Δ negligible — content chunk wins
    in both),
  - noise-probe scores **drop** after removal (the spurious match is gone),
  - additionally report *which chunk wins* per query to show the noise chunk is the
    max only for off-topic probes.

  When no embedding key is present, SKIP the embedding part and print a clear notice.

- Single-page fixture is sufficient (which-chunk-wins demonstrates the claim). A
  cross-page ranking test (a couple of sibling pages as fixtures) is an optional
  extension, not required.

- **Eval doc:** `docs/superpowers/evals/2026-06-19-legacy-sections-eval.md` —
  how to run, env vars, expected output.

### 5. Documentation

Update `lat.md/` (section conventions / retrieval) to reflect that the two sections
are no longer part of the page schema. Run `lat check` — all links and code refs
must pass.

## Verification

- `npm run build` (tsc + esbuild) is green.
- `eval/legacy-sections/run.ts` — all assertions pass (deterministic part always;
  embedding part when a key is configured).
- Migration is idempotent: a second run is a no-op (config flag).
- `lat check` reports no errors.

## Alternatives considered (rejected)

- Keep `Связанные концепции` as an optional section — rejected; both fully removed.
- Run the sweep via `lint actualize` or a manual script — rejected in favor of an
  auto-migration on load.
- Rely on analysis alone without a measured A/B — rejected; both analysis and a
  light A/B are produced.
