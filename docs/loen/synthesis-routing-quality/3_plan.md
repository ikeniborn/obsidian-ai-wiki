# Plan

Mode: `delivery` + research evaluation

Objective: improve article synthesis quality and reduce retries by evaluating multiple pipeline variants on the `os-unix` replay vault, then selecting the best verified pipeline.

## Bounded Deliverable

Produce an evidence-backed optimal ingest synthesis pipeline for article generation on the `os-unix` replay scenario. Do not close the topic after a single promising fix.

## Research Question

Which bounded ingest synthesis pipeline minimizes retries and failures while preserving article quality and strict domain validation for `os-unix`?

## Metrics

- `synthesis_requests`: number of `ingest.synthesize` LLM requests.
- `structured_validation_retries`: count and reasons.
- `structural_errors`: empty/non-JSON/schema repair failures.
- `failed_sources`: source files that fail terminal ingest.
- `pages_created` / `pages_updated`.
- `invalid_paths_written`: must be 0.
- `unknown_entity_key_acceptance`: must be 0.
- `article_quality`: frontmatter present, type/resource/description present, `## Sources` present, no dead wiki links introduced by generated pages, no duplicate canonical page paths.
- `total_output_tokens` and wall-clock duration when available.

## Variants To Evaluate

1. Baseline replay metrics from captured vault logs.
2. Server-owned canonical create paths for all batches. Current pass 1 implementation.
3. Smaller synthesis batch size for high-entity sources.
4. Pathless/content-only create action schema, where create output omits `path` and code injects it after validation by entity key.
5. Pre-synthesis entity-key/type gate: reject or repair evidence packets before synthesis if key/type cannot map to domain routing.
6. Output-budget/profile tuning for replay-style high-token source to avoid empty-output plus repair preflight overrun.

Only keep variants that improve metrics without weakening strict validation.

## Steps

1. Add failing tests for current failure modes.
   - Unknown entity keys must be rejected or repaired within the existing retry budget.
   - Hyphenated stems such as `wiki_os-unix_chromium-flag.md` and missing-prefix paths such as `applications/obsidian.md` must not force avoidable retry churn when canonical create paths are known.
   - Unsupported folders must not be accepted when absent from the domain policy, but configured folders such as replay `methods` must remain valid.
   - Multi-entity create batches must not depend on LLM-selected create paths when canonical paths are known.
   - Replay-like 10-entity synthesis must avoid split cascade caused only by create path spelling.
   - Verify with targeted ingest synthesis tests.

2. Tighten the synthesis prompt and schema contract.
   - Render an explicit allowed entity key list for the current batch.
   - Tell the model not to invent keys and not to choose create routing.
   - Keep patch actions bound to exact existing target paths and page hashes.
   - Keep `entity_types_delta` optional and validated.

3. Move create routing out of model decisions.
   - Compute canonical create paths from server-owned bundle/entity metadata and domain routing policy.
   - Apply canonical create paths for every create action, including multi-entity batches, only after entity coverage is valid.
   - Preserve strict rejection for unknown entity keys and invalid patch paths.
   - Keep `methods`/other configured `wiki_subfolder` values valid when present in domain metadata.

4. Reduce batch retry blast radius without hiding real defects.
   - When semantic validation fails for a multi-entity batch, keep split behavior.
   - Ensure single-entity repair prompt contains compact concrete feedback only.
   - Add a high-token repair preflight regression for replay-style `Prompt requires 32769 estimated tokens but budget is 32768`.
   - Do not relax validation or accept unknown routing.

5. Update documentation if behavior changes.
   - Update iwiki page covering entity-type routing or create a focused page for synthesis-owned content/server-owned routing.
   - Run `wiki_lint` after wiki update.

6. Run research comparisons.
   - Use `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run` as baseline evidence.
   - Use isolated vault copies for live/replay generation when running plugin workflows.
   - Record each variant in `docs/loen/synthesis-routing-quality/evidence/variant-*.json`.
   - Update `5_check.md` and `6_reflect.md` after every variant.
   - Select final pipeline only after at least three viable variants or explicit blocker evidence for the remaining variants.

## Verifier

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/entity-routing.test.ts
npm run lint
```

Supplemental if structured output shared behavior changes:

```bash
node --import tsx --test tests/structured-output.test.ts
```

Evidence paths:

- `docs/loen/synthesis-routing-quality/evidence/latest-test.log`
- `docs/loen/synthesis-routing-quality/evidence/latest-test.json`

## Quality Gates

- No validation weakening.
- No broad refactor outside synthesis/routing contract.
- Tests reproduce at least one unknown-key failure and one non-canonical-path failure.
- Tests cover the replay path set from `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`.
- Retry reduction comes from contract narrowing or deterministic assignment, not from accepting invalid output.

## Stop Conditions

- Stop when targeted tests and lint pass and behavior matches success criteria.
- Stop and hand off if canonical routing requires changing upstream entity extraction semantics beyond this loop scope.
- Stop and hand off if provider/model obedience prevents stable JSON/schema output after routing freedom is removed.

## Rollback Policy

Rollback topic changes only. Preserve strict validation, transport diagnostics, and prompt-budget repair fixes.

## Terminal Condition

Runner may close this loop only when variant comparison evidence exists, the selected pipeline is justified by metrics, verifier commands pass, and final result records why rejected variants lost.
