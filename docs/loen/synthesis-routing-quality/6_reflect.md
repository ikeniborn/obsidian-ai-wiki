# Reflect

Decision: keep the selected production pipeline and close the loop.

Why:

- The replay path-spelling cascade is addressed at the correct layer: deterministic server-owned create path assignment.
- Strict validation remains intact for real defects such as unknown entity keys and invalid patch targets.
- Configured folders such as replay `methods` stay valid because path policy still comes from domain `entity_types`.
- Production ingest now caps synthesis requests at 2 entity bundles, which removed the large-batch unknown-key retry in the verified replay variant.
- Tests show multi-entity batches no longer split only because the model wrote hyphenated create paths.

Remaining risk:

- Unknown entity keys can still trigger split/repair when they appear in small batches. This is acceptable because unknown keys are real domain defects.
- Large output/empty structured response behavior remains a separate model/provider-budget concern. The selected pipeline reduces avoidable retries and request blast radius, but output-profile tuning needs live model evaluation before adoption.

Final selected pipeline:

1. Evidence extraction produces bounded entity packets with `entityKey` and `entityType`.
2. Code builds allowed entity keys and canonical create paths from domain metadata:
   - `entityKey` -> `wiki_<domain>_<slug>.md`
   - `entityType` -> `effectiveSubfolder(entity_type)`
3. Synthesis prompt gives the model only:
   - allowed entity keys;
   - server-owned create paths to echo;
   - existing patch targets and page hashes;
   - evidence, facts, source ranges, page context, and replace authorities.
4. Model writes content and patch intent only:
   - create content;
   - annotation;
   - patch sections;
   - skip reasons;
   - optional entity type delta.
5. Code overwrites create paths with canonical paths before strict action validation.
6. Strict validation rejects:
   - unknown entity keys;
   - duplicate coverage;
   - duplicate paths after canonicalization;
   - patching absent pages;
   - creating existing pages;
   - invalid replace authority;
   - invalid configured path policy.
7. Ingest caps top-level synthesis batches at 2 entity bundles after token-budget batching.
8. Multi-entity split remains only for real semantic defects or context/JSON failures, not route spelling.

Rejected variants:

- `pathless-create-actions`: best simulated score, but rejected for this loop because it requires a schema migration and was not production-verified.
- `server-owned-create-paths-batch10`: improves baseline, but still has 1 validation retry under replay large-batch hallucination.
- `pre-synthesis-key-type-gate`: useful upstream hardening, but not sufficient for hallucinated synthesis output.
- `reduced-output-budget-profile`: separate live-model tuning problem with article completeness risk.
