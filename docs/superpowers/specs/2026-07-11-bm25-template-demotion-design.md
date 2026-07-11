---
review:
  spec_hash: dbd63435836d2543
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-bm25-template-demotion-intent.md
---
# BM25 and Controlled Template Demotion — Design

Date: 2026-07-11
Status: approved
Intent: `docs/superpowers/intents/2026-07-11-bm25-template-demotion-intent.md`

## Acceptance (from intent)

### Desired Outcomes

- Live HLD eval shows gold quality improvement over current `weighted-lexical`:
  `nDCG@5 > 0.91` or `Recall@5 > 0.76`.
- Average improved `Overlap@5` remains at least `0.65`.
- No query drops below its current legacy-overlap floor.
- `MRR` remains at least `0.90`.
- Top-1 result is never `template-*` or `template-readme`.
- The report explains where BM25 helps, where BM25 hurts, and where controlled
  demotion changes ranking.
- Runtime Query behavior does not change until eval confirms a safe effective
  value.

### Health Metrics

- Per-query legacy floors from the current harness do not regress.
- Average improved `Overlap@5 >= 0.65`.
- Aggregate `MRR >= 0.90`.
- No top-1 boilerplate/template result.
- Runtime Query behavior remains unchanged.
- Eval remains deterministic and offline.

## Approach Options

### Option A — Eval-only demotion variants (chosen)

Keep the current runtime untouched and add new A/B variants inside
`scripts/eval-jsonl-domain-storage.ts`. The variants apply a controlled
boilerplate/template demotion after each base ranked list is produced, then score
the resulting top 5 with the existing gold metrics and legacy-overlap guards.

This option directly answers the current eval finding: raw BM25/RRF does not beat
`weighted-lexical`, and template/readme pages are visible grade-0 blockers in the
report. It keeps the experiment reversible and makes every ranking change visible
in the generated report.

### Option B — Demotion inside runtime lexical scorer

Add a template/readme penalty to `scoreLexicalPage` and `scoreLexicalChunk`.
This is closer to production behavior, but it changes the accepted baseline before
the harness proves a safe value. It also makes rollback and comparison harder.

### Option C — Add plugin setting immediately

Add an advanced setting for template demotion and wire it into runtime Query with a
disabled or conservative default. This creates a user-visible knob before a stable
effective value exists, which conflicts with the intent.

## Decisions

1. **Chosen path: eval-only demotion variants.** Runtime Query, settings UI, and
   persisted settings do not change in this step.
2. **BM25 stays in the comparison set.** The harness continues to evaluate raw BM25
   page/chunk variants and RRF variants, then adds demoted counterparts where useful.
3. **Demotion is rank-level, not score-model mutation.** Apply demotion to ranked
   paths after base rankers run. This avoids touching BM25 internals or runtime
   lexical scorer internals before the experiment proves value.
4. **Parameter sweep is deterministic.** Test a small fixed set of demotion factors,
   for example `0.15`, `0.25`, `0.35`, and `0.50`. The report shows which factor
   wins and which guard rejected each losing factor.
5. **Settings are proposal-first.** If a stable effective value is found, the result
   report names it as a candidate for a future advanced/experimental plugin setting.
   This branch does not add that setting unless the user explicitly approves a
   follow-up scope expansion.

## Boilerplate Detection

The demotion target is intentionally narrow:

- generated eval path basename equals `template-readme`;
- generated eval path basename starts with `template-hld-`.

This targets pages that the current HLD gold set consistently grades as `0` when
they appear in top results. It does not demote arbitrary pages containing the word
`template`, because real HLDs can mention templates as part of their domain content.

Helper shape:

```ts
function isBoilerplatePath(vaultPath: string): boolean
```

The helper is local to the eval harness unless later runtime promotion is approved.

## Demotion Model

Use rank-level demotion over a ranked path list:

1. Start from a base top list and an extended candidate tail from the same variant.
2. Keep non-boilerplate order stable.
3. Move boilerplate pages down by a factor-specific demotion window, or replace them
   with the next non-boilerplate candidates from the same ranked source.
4. Deduplicate and keep top 10 for report visibility.
5. Never synthesize candidates from gold labels.

The implementation can be simple:

```ts
function demoteBoilerplateTop(
  rankedPaths: string[],
  factor: number,
  limit: number,
): string[]
```

The factor represents demotion strength, not an exposed user setting. A higher
factor moves boilerplate farther down. The report should print the chosen factor.

## New Eval Variants

Keep existing variants:

- `weighted-lexical`;
- `bm25-page`;
- `bm25-chunk`;
- `rrf-weighted-bm25`;
- `rrf-weighted-bm25-legacy`.

Add eval-only demoted variants:

- `weighted-lexical-demoted`;
- `rrf-weighted-bm25-demoted`;
- `rrf-weighted-bm25-legacy-demoted`.

BM25 page/chunk alone remain visible but are not the main promotion path because
the prior run showed weaker aggregate gold metrics. If a BM25-only demoted variant
unexpectedly wins during implementation, it must still pass all guards and be
called out in the report before any runtime discussion.

## Acceptance Gate

A variant is acceptable only if all are true:

- every query keeps its current legacy-overlap floor;
- aggregate average improved `Overlap@5 >= 0.65`;
- aggregate `MRR >= 0.90`;
- no query has top-1 `template-*` or `template-readme`;
- aggregate `nDCG@5 > 0.91` or aggregate `Recall@5 > 0.76`;
- if `MRR` drops below the current `1.00` but remains at least `0.90`, the report
  must call it out as an accepted trade-off only when `nDCG@5` or `Recall@5`
  improves.

The best variant ranks by:

1. accepted guard status;
2. `nDCG@5`;
3. `Recall@5`;
4. `MRR`;
5. smaller demotion factor, to prefer the least invasive effective value.

If no variant passes, the verdict stays `needs_tuning` and the report must show why.

## Report Changes

The HLD eval report adds:

- demotion factor per demoted variant;
- per-query top-1 boilerplate pass/fail;
- variant deltas versus `weighted-lexical`;
- a "BM25 contribution" note showing whether BM25-containing variants improved or
  harmed each query;
- a "Demotion contribution" note showing which template/readme pages moved out of
  top 5 and which pages replaced them;
- final setting recommendation:
  - `none` if no stable value wins;
  - `candidate: <factor>` if a value passes all guards and improves gold metrics.

## Error Handling

- An empty candidate tail leaves the original rank order unchanged and records
  `no replacement candidate` in report details.
- If demotion removes a legacy-overlap page and drops below a floor, the variant is
  rejected with a guard reason, not silently accepted.
- If all demotion factors fail, report `needs_tuning`; do not weaken floors.
- If a demotion factor improves one query and hurts another, aggregate metrics and
  per-query guard reasons both remain visible.

## Testing

Add focused tests for:

- `isBoilerplatePath` matches `template-hld-*` and `template-readme`, but not
  normal paths containing "template" in another context.
- Demotion moves boilerplate below non-boilerplate candidates while preserving
  deterministic order.
- Demoted variants report factor and top-1 boilerplate status.
- Synthetic eval can show a demoted variant winning when a template page appears
  above a relevant page.
- Live HLD eval report includes demotion contribution and setting recommendation.

Verification commands:

- `node --import tsx --test tests/eval-jsonl-domain-storage.test.ts`
- `node --import tsx --test tests/bm25.test.ts tests/retrieval-eval-metrics.test.ts tests/eval-jsonl-domain-storage.test.ts tests/lexical-retrieval.test.ts tests/wiki-index-jsonl.test.ts`
- live HLD eval CLI against the Rostelecom HLD source
- `npm run lint`
- `npm run build`
- `wiki_lint(domain="obsidian-ai-wiki")` after docs/wiki updates

## Documentation

Update:

- `docs/rag-quality-recommendations.md` with the final demotion outcome and setting
  recommendation.
- iwiki `jsonl-domain-storage` Eval section with the winning factor or `none`.
- final chain result report.

Do not document a plugin setting as available unless this task explicitly adds it.
