# Dynamic LLM Budget Routing Handoff

## State

Candidate is built and locally verified. External write policy blocked delivery to the test vault. The current Obsidian process loaded the previous evidence-containment bundle, so no new live operation is valid evidence for the source-primary or Query-grounding changes.

## Test Artifact

- Vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`
- Candidate `dist/main.js`: SHA-256 `70a59d056f2ce5ed01aeae8bcc482b44f5e2a260fc2927dec9a4668b6c36538c`
- Current test-vault `main.js`: SHA-256 `aa0fef6c658165bc5309522257fb5e89ee71665dd07d4b70e177a06190983211`
- Settings and source notes were not changed.

## Next Action

Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` to the test-vault plugin directory. Verify matching SHA-256, restart Obsidian, then start one clean force-reinit. Monitor `.obsidian/plugins/ai-wiki/agent.jsonl` through terminal status and run the fixed ten-question Query corpus after completion.

## Acceptance

- 22/22 sources and terminal `done`.
- Zero canonical path, unknown entity-key, schema, or domain-validation failures.
- Lower page count and synthesis-call count than session `1785000201763` without lower source coverage.
- Existing canonical targets remain independent; overflow evidence appears under the source-primary carrier.
- Every generated page passes YAML, canonical type-folder, provenance, index, protocol-marker, alias, and exactly-one-H1 checks.
- Ten Query cases complete with valid selected-context WikiLinks and zero returned unsupported technical units.
- Grounded Query answers remain one-call; an unsupported candidate uses at most one technical repair.

P1 provider deadline handling, server-owned metadata, external URL allowlisting, and synthesis evidence-ledger work remains separate unless this replay exposes a P0 regression.
