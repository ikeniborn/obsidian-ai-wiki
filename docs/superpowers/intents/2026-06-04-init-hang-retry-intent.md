# Intent: Init/Ingest/Lint hang detection and auto-retry

**Date:** 2026-06-04
**Status:** approved

## Objective

Init, ingest, and lint processes hang silently — no errors, no LLM activity, process stays alive indefinitely. Need to detect prolonged idle and automatically restart the last step from the same position (resumable, not from scratch).

## Desired Outcomes

- Process detects absence of LLM activity beyond timeout threshold
- Automatically restarts last step (resumable — continues from where it stopped)
- Works for init, ingest, lint operations
- Normal (non-hanging) runs are unaffected

## Health Metrics

- Correctness of init/ingest/lint on normal (non-hanging) passes must not degrade
- Existing `parseWithRetry` logic (retry on parse errors) must not be affected
- Chat operation behavior must not change

## Strategic Context

- Interacts with: `parseWithRetry`, `AgentRunner`, `src/phases/init.ts`, ingest phases, lint phases
- Priority trade-off: reliability (never hang) over speed (minimal overhead)

## Constraints

### Steering (behavioral guidance)

- Timeout setting stored in plugin `data.json`
- Default value: 300 seconds per LLM operation

### Hard (architectural enforcement)

- Do not change `_agent.jsonl` format
- Do not touch files outside the scope of this task

## Autonomy Zones

- Full autonomy (all decisions): implementation approach, watchdog placement, data.json field design, retry logic

## Stop Rules

- Halt if: normal flow (non-hanging runs) breaks
- Done when: timeout detects hangs and restarts last step; init/ingest/lint no longer hang; normal flow passes; tests pass
