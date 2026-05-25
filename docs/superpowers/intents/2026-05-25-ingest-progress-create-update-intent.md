# Intent: Ingest Progress — Create vs Update Labels

**Date:** 2026-05-25
**Status:** approved

## Objective

Current ingest progress shows "Write" for every page — user cannot distinguish between new pages (Create) and updated pages (Update). Fix this by surfacing the real operation in progress output, in both sidebar and logs.

## Desired Outcomes

- During ingest, new wiki pages show label `Create`
- During ingest, existing wiki pages that are overwritten show label `Update`
- Label appears in sidebar progress view and in logs
- No change to actual vault write logic — label only

## Health Metrics

- Vault write behavior unchanged (same files written, same content)
- `entity_types_delta` merge logic unchanged
- Existing RunEvent consumers unaffected by extension

## Strategic Context

- Interacts with: `src/phases/ingest.ts`, `src/types.ts#RunEvent`, controller (renders sidebar/logs)
- Priority trade-off: trust — user must understand what ingest did

## Constraints

### Steering (behavioral guidance)
- Only change what is necessary: event field + render path
- Do not alter vault write logic or ingest LLM pipeline

### Hard (architectural enforcement)
- Extend existing `RunEvent` variant with a new field (not a new variant)
- No breaking changes to existing event consumers
- Controller determines create vs update by checking file existence before/after write — not `ingest.ts`

## Approved Decisions

- **RunEvent extension:** add field to existing event (e.g. `operation: "create" | "update"`) — no new variant
- **Labels:** `Create` / `Update`
- **Detection point:** controller checks vault file existence before the write, sets `operation` field accordingly

## Autonomy Zones

- Full autonomy (reversible, low risk): reading code, extending RunEvent field, updating render
- Proposal-first (needs approval): any deviation from approved decisions above
- No autonomy (human only): changing vault write logic

## Stop Rules

- Halt if: vault write behavior changes as side effect
- Escalate if: RunEvent extension breaks existing sidebar render logic
- Done when: sidebar and logs show `Create`/`Update` per page during ingest, all existing tests pass
