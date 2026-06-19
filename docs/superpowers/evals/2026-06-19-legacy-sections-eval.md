# Eval — Drop Legacy Wiki Sections

**Date:** 2026-06-19
**Branch:** `dev/drop-legacy-wiki-sections`
**Spec:** `docs/superpowers/specs/2026-06-19-drop-legacy-wiki-sections-design.md`
**Plan:** `docs/superpowers/plans/2026-06-19-drop-legacy-wiki-sections.md`

## Purpose & scope

Prove, outside any Obsidian vault, that removing the `Связанные концепции`/`Related concepts`
and `История изменений`/`Change history` sections **strictly removes false positives**: it
deletes exactly the two noise chunks, leaves every content chunk byte-identical, and (with a
key) lowers retrieval scores only for off-topic noise probes while on-topic scores stay flat.

The harness exercises the **real** `splitSections` / `buildChunkInputs` (`src/page-similarity.ts`)
and the **real** `stripLegacySections` / `extractRelatedLinks` / `addOutgoingLinks`
(`src/strip-legacy-sections.ts`) against an inlined single-page SCD1 fixture.

## How to run

```bash
# Deterministic part (no key):
node_modules/.bin/esbuild eval/legacy-sections/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
  --outfile=eval/legacy-sections/run.cjs
node eval/legacy-sections/run.cjs

# Retrieval A/B (real embeddings):
EVAL_EMBED_BASE_URL=... EVAL_EMBED_API_KEY=... EVAL_EMBED_MODEL=... \
  [EVAL_EMBED_DIMENSIONS=...] node eval/legacy-sections/run.cjs
```

`obsidian-stub.ts` supplies the only `obsidian` symbol the import tree references
(`requestUrl`, never actually called). The embedding path uses the global `fetch`.

## Thresholds

- `EPS_ONTOPIC = 0.02` — max allowed cosine |Δ| for on-topic queries.
- `MIN_NOISE_DROP = 0.05` — min required cosine drop for noise-probe queries.

## Cases

| Case | What it checks |
|------|----------------|
| D1–D5 | The two noise chunks vanish; exactly two chunks removed; content windows byte-identical. |
| H1–H7 | `stripLegacySections` idempotent + structure-preserving; `extractRelatedLinks` scope; `addOutgoingLinks` union + no-op. |
| E (ontopic) | `|score_with − score_without| < EPS_ONTOPIC` for "SCD1 версионирование", "перезапись таблицы". |
| E (noise) | `score_with − score_without ≥ MIN_NOISE_DROP` for the three noise probes. |

## Results (current)

Deterministic: `TOTAL: 12 passed, 0 failed` (embedding A/B SKIPPED without a key).
Fill in the embedding-A/B numbers here after running with a key.

## Note on the fixture

`splitSections` → `mergeShort` (`src/page-similarity.ts`) folds any section shorter than
`minChars` (200) into the preceding section, so the fixture's sections are sized above that
threshold to guarantee each H2 becomes its own chunk — otherwise the noise sections would
fold into a neighbour and "drop exactly two chunks" could not be observed.
