# Intent: timeout=0 means no limit per operation

**Date:** 2026-05-25
**Status:** draft

## Objective

Users can set a per-operation timeout to `0` to remove the time limit entirely. Some operations have unpredictable duration and must not be forcibly killed. Currently, `0` in any timeout field causes broken behavior (subprocess killed immediately or max-of-all logic miscalculates the effective limit).

## Desired Outcomes

- UI never shows "Timeout after Xs" when the operation's timeout is `0`
- Process runs until completion or user-initiated Cancel — no forced abort at the HTTP / subprocess level
- Cancel button in UI always works regardless of timeout value

## Health Metrics

- Operations with `timeout > 0` still abort exactly as before
- `parseTimeoutString` rejects negative values; accepts `0` as valid
- `buildAgentRunner` receives the per-operation timeout value, not `Math.max(all)`

## Strategic Context

- Interacts with: `src/controller.ts` (`runOp`, `buildAgentRunner`), `src/claude-cli-client.ts` (`_generate`, `_collect`), `src/settings.ts` (`parseTimeoutString`), `src/types.ts` (defaults), `src/i18n.ts` (field description hint)
- Priority trade-off: reliability — correctness of abort behavior trumps simplicity

## Constraints

### Steering (behavioral guidance)

- `0` is valid per-field: `0/300/900/3600/600` means ingest=unlimited, others capped
- Each operation passes its own timeout to `buildAgentRunner`, not `Math.max` of all
- When `timeoutSec = 0` in `claude-cli-client`, skip the `setTimeout` kill entirely
- Settings UI description should hint that `0` means unlimited

### Hard (architectural enforcement)

- Negative timeout values are forbidden — `parseTimeoutString` must reject them
- Existing `timeoutMs > 0` guard in `runOp` (controller.ts:625) must remain the single source of truth for the abort signal

## Autonomy Zones

- Full autonomy (reversible, low risk): all implementation decisions — `parseTimeoutString`, `buildAgentRunner` signature, `claude-cli-client` guard, i18n hint text

## Stop Rules

- Halt if: changing `buildAgentRunner` signature breaks the claude-agent (subprocess) path
- Done when: all three timeout paths (`runOp` abort, `_generate` kill, HTTP `timeout`) skip their limit when the operation's value is `0`, and non-zero behavior is unchanged
