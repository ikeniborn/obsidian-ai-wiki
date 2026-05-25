# Intent: Ingest Progress — Create vs Update Labels

**Date:** 2026-05-25
**Status:** draft

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

- Interacts with: `src/phases/ingest.ts` (detects write vs update), `src/types.ts#RunEvent` (event shape), controller (renders sidebar/logs)
- Priority trade-off: trust — user must understand what ingest did

## Constraints

### Steering (behavioral guidance)
- Only change what is necessary: event label + render path
- Do not alter vault write logic or ingest LLM pipeline

### Hard (architectural enforcement)
- `RunEvent` in `src/types.ts` may be extended with new variant or field
- No breaking changes to existing event consumers

## Autonomy Zones

- Full autonomy (reversible, low risk): reading ingest.ts to find write point, reading RunEvent shape
- Guarded (log + confidence threshold): extending RunEvent — confirm shape before coding
- Proposal-first (needs approval): UI label wording, RunEvent extension approach (new variant vs field on existing event), sidebar render location
- No autonomy (human only): changing vault write logic

## Stop Rules

- Halt if: vault write behavior changes as side effect
- Escalate if: RunEvent extension breaks existing sidebar render logic
- Done when: sidebar and logs show `Create`/`Update` per page during ingest, all existing tests pass
