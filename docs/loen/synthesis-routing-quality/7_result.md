# Result

Status: final.

## Outcome

- Server-owned canonical create paths are applied before validation for all synthesis batches.
- Production ingest caps synthesis batches at 2 entity bundles after token-budget batching.
- Replay path spelling issues such as `chromium-flag`, `environment-variables`, `applications/obsidian.md`, and `configurations/proxy-pac.md` no longer require split cascade when entity keys are known.
- Unknown entity keys such as `entity-obsidian` remain strict validation failures.
- Configured domain folders such as `methods` remain valid when present in domain metadata.

## Evidence

- `docs/loen/synthesis-routing-quality/evidence/latest-test.log`
- `docs/loen/synthesis-routing-quality/evidence/latest-test.json`

Verifier passed:

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/entity-routing.test.ts && npm run lint
```

Result:

- 85 tests passed.
- Lint: 0 errors, 4 unrelated existing warnings.

## Variant Comparison

Selected verified variant: `server-owned-create-paths-batch2`.

| Variant | Status | Requests | Retries | Structural Errors | Failed Sources | Quality |
|---------|--------|----------|---------|-------------------|----------------|---------|
| baseline-captured-replay | observed | 20 | 9 | 2 | 1 | 1 |
| server-owned-create-paths-batch10 | verified | 3 | 1 | 0 | 0 | 1 |
| server-owned-create-paths-batch2 | verified | 5 | 0 | 0 | 0 | 1 |
| pathless-create-actions | simulated | 1 | 0 | 0 | 0 | 1 |
| pre-synthesis-key-type-gate | simulated | 3 | 1 | 0 | 0 | 1 |
| reduced-output-budget-profile | simulated | 5 | 0 | 0 | 0 | 0.85 |

`pathless-create-actions` was not selected because it requires a create-action schema migration and was not production-verified in this loop.

## Final Pipeline

1. Extract bounded evidence packets with `entityKey`, `entityType`, facts, source ranges, and links.
2. Build deterministic routing in code from domain metadata:
   - allowed entity keys from current evidence batch;
   - canonical create paths from `buildWikiStem(domain.id, entityKey)` and `effectiveSubfolder(entityType)`.
3. Prompt synthesis with content contract only:
   - allowed keys;
   - server-owned create paths to echo;
   - existing patch targets/page hashes;
   - evidence and replace authorities.
4. Let the model choose only article content, sections, facts, descriptions, links, patch intent, and skip reasons.
5. Before validation, code replaces every create action path for known entity keys with the canonical server-owned path.
6. Strict validation remains the gate for unknown keys, duplicate coverage, path policy violations, patch authority, and schema correctness.
7. Top-level synthesis batches are capped at 2 entity bundles after token-budget batching.
8. Split/retry is reserved for real domain/schema defects or model output failures, not deterministic routing decisions.
