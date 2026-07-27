# Act

## Pass 1

Action: made create-page routing server-owned inside synthesis validation.

Changed paths:

- `src/phases/ingest-synthesis.ts`
- `prompts/ingest-synthesis.md`
- `tests/ingest-synthesis.test.ts`
- `tests/ingest-bounded.test.ts`

Implementation:

- `createPathsByEntityKey` is now applied to all create actions, including multi-entity batches.
- Create path lookup is normalized by entity key, so casing/spacing differences do not bypass server-owned create paths.
- The prompt now exposes allowed entity keys and server-owned create paths, and tells the model to echo create paths instead of designing routing.
- Replay regressions cover hyphenated stems, missing `wiki_<domain>_` prefixes, and unknown entity keys.

Observed result:

- Replay path-spelling failures are eliminated in deterministic tests.
- Unknown entity keys remain strict and still trigger split/repair behavior.

## Pass 2

Action: selected and implemented the best verified replay variant.

Changed paths:

- `src/phases/ingest.ts`
- `tests/ingest-bounded.test.ts`
- `scripts/eval-synthesis-routing-variants.ts`

Implementation:

- Production ingest now caps each synthesis request at 2 entity bundles after token-budget batching.
- Existing token-budget batching remains the first gate; the new cap only limits semantic blast radius.
- Added an end-to-end ingest regression proving 5 extracted entities are synthesized as `2/2/1`.
- Added a replay variant evaluator for baseline, server-owned batch-10, server-owned batch-2, pathless create actions, pre-synthesis gate, and output-budget/profile tuning.

Selected variant:

- `server-owned-create-paths-batch2`

Observed result:

- Baseline replay: 20 synthesis requests, 9 validation retries, 2 structural errors, 1 failed source.
- Selected verified variant: 5 synthesis requests, 0 validation retries, 0 structural errors, 0 failed sources, article quality score 1.
- Strict validation remains enabled; unknown entity keys are not accepted.
