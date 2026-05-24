# Intent: init-incremental vs ingest — merge

**Date:** 2026-05-24
**Status:** draft

## Objective

Remove redundancy between `init-incremental` and `ingest` phases. Make `ingest` the primary wiki operation; `init` becomes a thin wrapper that calls `ingest` to bootstrap domain structure. Identified during codebase analysis.

## Desired Outcomes

- `init-incremental.md` phase deleted; logic absorbed into `ingest`
- `ingest` handles both entity type discovery (meta-level) and instance extraction (object-level)
- `init` command still exists for users but delegates to `ingest` internally
- No user-facing behavior change

## Health Metrics

- Domain creation still works (entity types persisted correctly)
- Adding new sources to existing domain still works
- Single-file ingest still works
- Existing tests pass

## Constraints

- Requires architectural design before implementation — affects the full ingest pipeline
- `DomainStore` currently not accessible from ingest phase; access pattern must be designed
- Schema change (`entity_types_delta?` in `WikiPagesOutputSchema`) needs review
- Must not break `init` as a user-facing command

## Autonomy Level

Claude can choose implementation details: delta schema shape, where in the ingest pipeline to persist entity types, internal refactoring within a phase file.

## Stop Rules

Escalate to user before:
- Any architectural change (new dependency between phases, new data flow, DomainStore wiring)
- Changing the public `WikiOperation` type or agent-runner routing
- Removing `init` as a user-facing command
