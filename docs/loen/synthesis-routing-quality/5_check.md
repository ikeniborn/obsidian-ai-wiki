# Check

Verifier:

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/entity-routing.test.ts && npm run lint
```

Result: pass.

Evidence:

- `docs/loen/synthesis-routing-quality/evidence/latest-test.log`
- `docs/loen/synthesis-routing-quality/evidence/latest-test.json`

Details:

- 85 tests passed.
- `npm run lint` completed with 0 errors.
- Lint reported 4 existing warnings in unrelated files:
  - `src/claude-cli-client.ts`
  - `src/okf-export-fs.ts`

Replay baseline from `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`, session `1784747412210`:

- 20 `ingest.synthesize` requests.
- 9 structured validation retries.
- Retry causes included `unknown entity key: entity-obsidian`, hyphenated stems, and missing `wiki_os-unix_` path prefixes.
- 2 structural errors on the next source after an empty structured output and response-format fallback.

Variant comparison evidence:

- `docs/loen/synthesis-routing-quality/evidence/variant-summary.json`
- `baseline-captured-replay`: 20 synthesis requests, 9 validation retries, 2 structural errors, 1 failed source.
- `server-owned-create-paths-batch10`: 3 synthesis requests, 1 validation retry, 0 structural errors, 0 failed sources.
- `server-owned-create-paths-batch2`: 5 synthesis requests, 0 validation retries, 0 structural errors, 0 failed sources.
- `pathless-create-actions`: simulated only; lower projected retry cost, but requires schema migration.
- `pre-synthesis-key-type-gate`: simulated only; cannot catch hallucinated keys inside synthesis output.
- `reduced-output-budget-profile`: simulated only; may reduce article completeness.

Selected verified pipeline:

- `server-owned-create-paths-batch2`
