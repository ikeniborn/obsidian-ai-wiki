# Intent: bundled-only schemas (`_wiki_schema.md` / `_format_schema.md`)

**Date:** 2026-06-07
**Status:** approved

## Objective
Schemas currently live in two places: bundled (`templates/*.md`) and a vault copy (`!Wiki/_config/`) read at runtime. Bundled changes do not propagate to existing vaults, and init/format overwrite or conflict with the vault copy — non-deterministic delivery. Make the bundled template the single source of truth so schema updates ship deterministically with each plugin release. Now, because verbatim→business-interpretation prompt changes just landed and must reach users.

## Desired Outcomes
- After init, `!Wiki/_config/` contains NO `_wiki_schema.md` / `_format_schema.md`.
- ingest, lint, lint-chat, init, format build their `schema_block` from the bundled constant.
- Existing users' stale vault copies are removed on plugin load.
- A new plugin release is the only delivery mechanism for schema changes.

## Health Metrics
- ingest/lint/format still receive a populated `schema_block` (now from bundle).
- Old `.config` → `_config` storage migration still works.
- `npm test`, `npm run build`, `npm run lint` stay green.

## Strategic Context
- Interacts with: `src/phases/{ingest,lint,lint-chat,init,format}.ts`, `src/storage-migration.ts`, `src/wiki-path.ts`, `src/main.ts`, `src/phases/query.ts`.
- Priority trade-off: trust (deterministic, predictable delivery) over per-vault customization speed.

## Constraints
### Steering (behavioral guidance)
- Surgical changes; reuse existing bundled imports (`schemaTemplate`, `formatSchemaDefault`).
### Hard (architectural enforcement)
- Zero runtime reads or writes of schema files in the vault.
- No fallback to a vault schema file.
- Manual per-vault schema edits are no longer supported.

## Autonomy Zones
- Full autonomy (reversible, low risk): code edits, test edits, doc edits.
- Guarded: best-effort deletion of existing vault copies on load (swallow errors, never block onload).
- Proposal-first: none beyond the approved plan.
- No autonomy: none.

## Stop Rules
- Halt if: removing the vault read breaks `schema_block` population in any phase.
- Escalate if: deleting vault copies risks data outside the two known schema files.
- Done when: fresh init produces no schema files in `!Wiki/_config`, all phases use the bundled schema, stale copies are removed on load, and test/build/lint are green.
