# Intent: Token Speed Display in Sidebar Result Block

**Date:** 2026-05-26
**Status:** draft

## Objective

Current sidebar result block shows `tok/s` computed as `outputTokens / totalProcessDurationMs` — this is wrong because `totalProcessDurationMs` includes BFS, embedding, tool calls, etc., not just LLM generation time. The displayed number is misleadingly low. Fix: measure pure LLM generation speed (first chunk → last chunk), show input and output speeds separately, show TTFT as median across all LLM calls in the operation.

## Desired Outcomes

- Sidebar result block shows: `in: 45 tok/s · out: 120 tok/s · latency: 340ms`
- `out tok/s` = `outputTokens / llmDurationMs` (time from first chunk to last chunk)
- `in tok/s` = `inputTokens / llmDurationMs` (prefill throughput, useful for capacity analysis)
- `latency` = median TTFT across all LLM calls in the current operation run
- Speed block hidden when usage data unavailable (e.g. claude-cli backend)
- Every LLM call logged to `agent.jsonl` as `llm_call_stats` event with structured fields
- `usdCost` removed from result block and `result` RunEvent

## Health Metrics

- claude-cli backend: zero changes, no speed display
- Existing `result` RunEvent consumers unaffected (except `usdCost` removal)
- If native backend returns no usage data: speed block silently hidden, no errors

## Strategic Context

- Interacts with: `src/types.ts` (RunEvent union), `src/phases/llm-utils.ts` (usage extraction), `src/stream.ts` (result event builder), `src/controller.ts` (logEvent), `src/view.ts` (renderResult)
- Priority trade-off: **clean architecture** — new `llm_call_stats` RunEvent type per call; view accumulates

## Constraints

### Steering (behavioral guidance)

- `llm_call_stats` event emitted only from native backend, per LLM call
- View accumulates stats for current operation, resets on new operation start
- Median TTFT calculated over all `llm_call_stats` events in the operation
- `agent.jsonl` log format must be machine-parseable and consistent

### Hard (architectural enforcement)

- Do NOT touch `src/claude-cli-client.ts`
- Remove `usdCost` from `RunEvent "result"` and all view rendering
- New event type added to discriminated union in `src/types.ts`
- `llm_call_stats` logged to `agent.jsonl` via existing `logEvent` mechanism

### Log format standard

Each `llm_call_stats` entry in `agent.jsonl`:
```json
{
  "ts": "2026-05-26T10:00:00.000Z",
  "session": "...", "op": "ingest", "domainId": "...",
  "backend": "native", "model": "...",
  "event": {
    "kind": "llm_call_stats",
    "callIndex": 2,
    "inputTokens": 1234,
    "outputTokens": 567,
    "ttftMs": 340,
    "llmDurationMs": 4200,
    "inTokPerSec": 293,
    "outTokPerSec": 135
  }
}
```

## Autonomy Zones

- Full autonomy (reversible, low risk): median algorithm, display format details, internal field naming, `callIndex` tracking logic
- Guarded: none
- Proposal-first: none
- No autonomy: none

## Stop Rules

- Halt if: claude-cli client is touched
- Escalate if: native backend streaming API does not provide `prompt_tokens` in usage
- Done when:
  - [ ] Native backend emits `llm_call_stats` RunEvent per LLM call with `callIndex`, `inputTokens`, `outputTokens`, `ttftMs`, `llmDurationMs`, `inTokPerSec`, `outTokPerSec`
  - [ ] View accumulates and displays `in tok/s`, `out tok/s`, median TTFT in result block
  - [ ] Speed block hidden when no stats available (claude-cli or missing usage)
  - [ ] Every `llm_call_stats` event logged to `agent.jsonl`
  - [ ] `usdCost` removed from `result` RunEvent and view
  - [ ] claude-cli backend unchanged
