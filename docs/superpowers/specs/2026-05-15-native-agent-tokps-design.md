# Native-Agent tok/s Display — Design

**Date:** 2026-05-15
**Scope:** Extend tok/s display (spec `2026-05-14-generation-speed-design.md`) to `native-agent` backend.

## Problem

Plan `2026-05-14-generation-speed.md` implemented `output_tokens` extraction only in `src/stream.ts:mapResult()` — claude-agent stream-json path. Native-agent backend bypasses `stream.ts`: phases (`ingest`/`query`/`lint`/`chat`/`init`/`format`) call `LlmClient.chat.completions.create()` directly and emit `result` events without `outputTokens`. Result: tok/s never shows for native-agent in sidebar or log.

## Solution

Propagate `usage.completion_tokens` from OpenAI-compatible responses through phases to `RunEvent.result.outputTokens`.

### Components

| File | Change |
|---|---|
| `src/phases/llm-utils.ts` | `buildChatParams(stream?)` — adds `stream_options:{include_usage:true}` when stream=true. `extractStreamDeltas()` — also returns `outputTokens?`. New `extractUsage(resp)` for non-stream. |
| `src/phases/ingest.ts` | Accumulator `outputTokens`, sum across calls, pass to final `result`. |
| `src/phases/query.ts` | Same. |
| `src/phases/lint.ts` | Same. |
| `src/phases/chat.ts` | Same. |
| `src/phases/init.ts` | Same (4 result events — each with own accumulator scope). |
| `src/phases/format.ts` | Same (3 result events). |
| `tests/phases/*` | Where existing — extend with usage-emitting mock; assert `result.outputTokens`. |

### API changes

```ts
// buildChatParams — add 5th positional arg
function buildChatParams(model, messages, opts, schema?, stream = false): Record<string, unknown>

// extractStreamDeltas — extended return
{ reasoning: string; content: string; outputTokens?: number }

// new
function extractUsage(resp: OpenAI.Chat.ChatCompletion): number | undefined
```

### Phase pattern (per LLM call)

Streaming:
```ts
let outputTokens = 0;
const stream = await llm.chat.completions.create(buildChatParams(...args, true), { signal });
for await (const chunk of stream) {
  const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
  if (tok !== undefined) outputTokens += tok;
  // ...
}
yield { kind: "result", durationMs: Date.now() - start, text, outputTokens: outputTokens || undefined };
```

Non-stream:
```ts
const resp = await llm.chat.completions.create(buildChatParams(...args), { signal });
const tok = extractUsage(resp);
if (tok !== undefined) outputTokens += tok;
```

Multi-call phases (`ingest`/`init`/`format`/`lint`): accumulator declared at phase start, summed across all calls, included in **final** `result` event.

### Semantics

- `tok/s = totalOutputTokens / totalDurationSeconds` — matches spec.
- Provider without `include_usage` support → chunk.usage absent → `outputTokens` stays 0 → emit `outputTokens: undefined` → tok/s suppressed (existing fallback in `view.ts` and `controller.ts`).
- claude-agent path unchanged — `stream.ts:mapResult()` continues to extract `usage.output_tokens`.

### Testing

- Unit: `extractStreamDeltas` parses chunk with `usage.completion_tokens`.
- Unit: `extractUsage` returns `completion_tokens` from non-stream response.
- Integration: mock LlmClient yielding chunks with usage → run one phase → assert final `result.outputTokens` equals sum.

### Out of scope

- Per-call breakdown of tokens (only total exposed).
- Input/prompt tokens.
- Caching tokens.
