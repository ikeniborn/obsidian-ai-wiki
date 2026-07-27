# Goal

Topic: `synthesis-routing-quality`

Objective: improve ingest synthesis article quality and reduce structured validation retries by removing unnecessary LLM freedom over entity identity and wiki routing.

## Success Criteria

- Synthesis prompts expose the exact allowed entity keys for each batch and make unknown keys invalid by contract.
- Create-page routing is deterministic in code: canonical create paths are computed server-side from entity key and resolved entity type/subfolder.
- The synthesis model is responsible for content decisions only: page sections, facts, descriptions, links, and patch intent.
- Strict validation remains enabled and continues to reject unknown entity keys, non-canonical wiki paths, unsupported folders, and schema-invalid operations.
- Targeted tests cover the current failure modes:
  - unknown entity key such as `entity-obsidian`;
  - non-canonical path such as `!Wiki/os-unix/methods/wiki_os-unix_chromium-flag.md`;
  - batch synthesis where all create paths are normalized or assigned by server-owned canonical paths;
  - schema-invalid operations still fail or repair without weakening guards.
- Verification passes with targeted synthesis/ingest tests and lint.

## Constraints

- Do not weaken validation to reduce retries.
- Do not ask the LLM to choose entity type folders when deterministic routing is available.
- Do not allow new entity keys outside the current batch.
- Do not regress repair-budget behavior already fixed for compact repair prompts.
- Keep changes surgical around ingest synthesis, schema/prompt contracts, and targeted tests.

## Mutable Scope

- `src/phases/ingest-synthesis.ts`
- `src/phases/zod-schemas.ts`
- `prompts/ingest-synthesis.md`
- relevant ingest synthesis tests under `tests/`
- documentation for the synthesis routing contract if behavior changes

## Protected Scope

- transport diagnostics and adapter behavior
- prompt-budget governor architecture outside synthesis-specific packing
- unrelated lint, query, export, deletion, and UI flows
- strict validation semantics that protect wiki integrity

## Verifier

Primary verifier:

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/ingest-bounded.test.ts tests/entity-routing.test.ts
npm run lint
```

Supplemental verifier when touching shared structured output behavior:

```bash
node --import tsx --test tests/structured-output.test.ts
```

## Budget

- Maximum loop passes: 3.
- Stop after first pass that satisfies tests and retry-quality assertions.
- Handoff if failures require a new entity extraction architecture or model-provider changes.

## Rollback Policy

Revert only files changed for this topic. Keep strict validation and prior transport/budget fixes intact.
