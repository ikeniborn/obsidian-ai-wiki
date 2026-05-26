---
review:
  spec_hash: 2dfc2306b730dc62
  last_run: "2026-05-26"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Components/2.llm-utils.ts"
      text: "wrapStreamWithStats measured ttftMs from after create() — not true TTFT. Fixed: requestStartMs parameter added, set before create() at call sites."
      verdict: fixed
      verdict_at: "2026-05-26"
---

# Design: Token Speed Display in Sidebar Result Block

**Date:** 2026-05-26
**Status:** draft
**Intent:** [2026-05-26-token-speed-display-intent.md](../intents/2026-05-26-token-speed-display-intent.md)

## Overview

Replace the current incorrect `outputTokens / totalDurationMs` metric with accurate per-LLM-call timing. Add `llm_call_stats` RunEvent type emitted by native backend after each LLM call. View accumulates all stats per operation and displays aggregated `in tok/s`, `out tok/s`, and median TTFT. Each call is logged to `agent.jsonl` with structured fields.

---

## Architecture

### Data Flow

```
LlmClient.create() → rawStream
  → wrapStreamWithStats(rawStream)   [llm-utils.ts]
      measures: ttftMs, llmDurationMs
      extracts: inputTokens (prompt_tokens), outputTokens (completion_tokens)
  → phase iterates wrapped stream (unchanged logic)
  → phase yields { kind: "llm_call_stats", ... }   [new RunEvent]
  → AgentRunner → WikiController → view.ts
      controller: logs to agent.jsonl with callIndex
      view: accumulates llmStats[], computes aggregate on "result" event
```

### Scope boundary

- **Native backend only** — `wrapStreamWithStats` called in phases that use `llm.chat.completions.create`
- **claude-cli backend** — `stream.ts` / `claude-cli-client.ts` untouched; no `llm_call_stats` emitted; speed block hidden in view

---

## Components

### 1. `types.ts`

Add new RunEvent variant:
```typescript
| {
    kind: "llm_call_stats";
    inputTokens: number;
    outputTokens: number;
    ttftMs: number;        // time from before create() call to first chunk
    llmDurationMs: number; // time from first chunk to last chunk
    inTokPerSec: number;
    outTokPerSec: number;
  }
```

Remove `usdCost?` from `result` variant:
```typescript
// Before:
| { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
// After:
| { kind: "result"; durationMs: number; text: string; outputTokens?: number }
```

### 2. `llm-utils.ts`

**Update `extractStreamDeltas`** — also extract `inputTokens` from `usage.prompt_tokens`:
```typescript
export function extractStreamDeltas(chunk): {
  reasoning: string;
  content: string;
  outputTokens?: number;
  inputTokens?: number;   // NEW — from usage.prompt_tokens in final chunk
}
```

**Add `LlmStreamStats` interface:**
```typescript
export interface LlmStreamStats {
  inputTokens: number;
  outputTokens: number;
  ttftMs: number;
  llmDurationMs: number;
}
```

**Add `wrapStreamWithStats`:**
```typescript
export function wrapStreamWithStats(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  requestStartMs: number,  // Date.now() called BEFORE llm.chat.completions.create()
): {
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  getStats(): LlmStreamStats | undefined;
}
```

Internally:
- `requestStartMs` passed by call site (set before `create()`) — captures true TTFT including server processing
- On first chunk: `ttftMs = Date.now() - requestStartMs`; records `firstChunkMs = Date.now()`
- On each chunk: yields transparently, accumulates usage
- After last chunk: `llmDurationMs = Date.now() - firstChunkMs`
- `getStats()` returns undefined if stream never yielded (e.g. error before first chunk)

**Add `buildLlmCallStatsEvent`:**
```typescript
export function buildLlmCallStatsEvent(s: LlmStreamStats): RunEvent {
  const durS = s.llmDurationMs / 1000;
  return {
    kind: "llm_call_stats",
    ...s,
    inTokPerSec: durS > 0 ? Math.round(s.inputTokens / durS) : 0,
    outTokPerSec: durS > 0 ? Math.round(s.outputTokens / durS) : 0,
  };
}
```

### 3. `parse-with-retry.ts`

**`streamOnce`** — use `wrapStreamWithStats`, return stats:
```typescript
async function streamOnce(...): Promise<{
  fullText: string;
  outputTokens: number;
  stats: LlmStreamStats | undefined;
}> {
  const requestStartMs = Date.now();
  const rawStream = await llm.chat.completions.create({ ...params, stream: true }, { signal });
  const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
  let fullText = "";
  let outputTokens = 0;
  for await (const chunk of stream) {
    const { content, outputTokens: tok } = extractStreamDeltas(chunk);
    if (content) fullText += content;
    if (tok !== undefined) outputTokens = tok;
  }
  return { fullText, outputTokens, stats: getStats() };
  // Non-streaming fallback: stats = undefined (no TTFT measurable)
}
```

**`parseWithRetry`** — emit event after each attempt:
```typescript
const { fullText, outputTokens, stats } = await streamOnce(...);
if (stats) args.onEvent(buildLlmCallStatsEvent(stats));
```

`ParseWithRetryResult` keeps `outputTokens` for backward compat (used by some phases for token budgeting).

### 4. Direct streaming phases (`query.ts`, `chat.ts`, `format.ts`)

Pattern applied at each streaming call site:
```typescript
const requestStartMs = Date.now();
const rawStream = await llm.chat.completions.create({ ...params, stream: true }, { signal });
const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
for await (const chunk of stream) {
  // existing logic unchanged
}
const stats = getStats();
if (stats) yield buildLlmCallStatsEvent(stats);
```

Non-streaming fallback paths: no `llm_call_stats` emitted (can't measure TTFT). Acceptable — these are rare error-recovery paths.

`ingest.ts:376` (path-correction retry) — **not instrumented** (internal structural call, not user-facing LLM generation).

### 5. `view.ts`

**Replace `lastTokPerSec` with accumulator:**
```typescript
// Remove:
private lastTokPerSec: number | undefined;

// Add:
private llmStats: Array<{
  inputTokens: number; outputTokens: number;
  ttftMs: number; llmDurationMs: number;
}> = [];
```

**`reset()` / new operation start:** `this.llmStats = [];`

**`onEvent` handler:**
```typescript
} else if (ev.kind === "llm_call_stats") {
  this.llmStats.push(ev);
}
```

**`finish()` — replace speed display:**
```typescript
// Remove:
this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");

// Add:
this.resultSpeedEl?.setText(this.buildSpeedText());
```

**`buildSpeedText()`:**
```typescript
private buildSpeedText(): string {
  if (!this.llmStats.length) return "";
  const totalIn = this.llmStats.reduce((s, x) => s + x.inputTokens, 0);
  const totalOut = this.llmStats.reduce((s, x) => s + x.outputTokens, 0);
  const totalDurS = this.llmStats.reduce((s, x) => s + x.llmDurationMs, 0) / 1000;
  const sorted = [...this.llmStats.map(x => x.ttftMs)].sort((a, b) => a - b);
  const medTtft = sorted[Math.floor(sorted.length / 2)];
  if (totalDurS <= 0) return "";
  const inS = Math.round(totalIn / totalDurS);
  const outS = Math.round(totalOut / totalDurS);
  return ` in: ${inS} · out: ${outS} tok/s · latency: ${medTtft}ms`;
}
```

Remove `usdCost` rendering (no longer in event).

### 6. `controller.ts`

**Add `callIndex` counter per dispatch:**
```typescript
// In dispatch():
let llmCallIndex = 0;

// In logEvent() for llm_call_stats:
const extra = ev.kind === "llm_call_stats"
  ? { callIndex: llmCallIndex++ }
  : {};
```

Remove old `tokPerSec` computation from `logEvent`.

**`agent.jsonl` line for `llm_call_stats`:**
```json
{
  "ts": "...", "session": "...", "op": "ingest",
  "backend": "native", "model": "...",
  "callIndex": 2,
  "event": {
    "kind": "llm_call_stats",
    "inputTokens": 1234, "outputTokens": 567,
    "ttftMs": 340, "llmDurationMs": 4200,
    "inTokPerSec": 293, "outTokPerSec": 135
  }
}
```

### 7. `stream.ts`

Remove `usdCost` from `mapResult`:
```typescript
// Remove:
usdCost: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stream yields 0 chunks (immediate error) | `getStats()` returns `undefined` → no event emitted |
| `prompt_tokens` absent in usage chunk | `inputTokens = 0`, `inTokPerSec = 0` |
| `llmDurationMs = 0` (instant response) | `inTokPerSec = outTokPerSec = 0` (guard against div-by-zero) |
| claude-cli backend | No `llm_call_stats` emitted → `llmStats = []` → `buildSpeedText()` returns `""` |
| Non-streaming fallback path | No event emitted; accumulated stats may be partial |

---

## Testing

Manual verification:
1. Run ingest on native backend → result block shows `in: X · out: Y tok/s · latency: Zms`
2. Run query → same display
3. Switch to claude-cli → speed block empty
4. Check `agent.jsonl` → `llm_call_stats` lines with correct `callIndex` sequence
5. Verify `usdCost` gone from logs and view

---

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `llm_call_stats` variant; remove `usdCost` from `result` |
| `src/phases/llm-utils.ts` | Update `extractStreamDeltas`; add `LlmStreamStats`, `wrapStreamWithStats`, `buildLlmCallStatsEvent` |
| `src/phases/parse-with-retry.ts` | `streamOnce` uses wrapper, returns stats; `parseWithRetry` emits event |
| `src/phases/query.ts` | Wrap streaming call, yield stats event |
| `src/phases/chat.ts` | Wrap streaming call, yield stats event |
| `src/phases/format.ts` | Wrap streaming call, yield stats event |
| `src/view.ts` | Replace `lastTokPerSec` with accumulator, add `buildSpeedText()` |
| `src/controller.ts` | Add `callIndex` counter, update `logEvent` |
| `src/stream.ts` | Remove `usdCost` from `mapResult` |
