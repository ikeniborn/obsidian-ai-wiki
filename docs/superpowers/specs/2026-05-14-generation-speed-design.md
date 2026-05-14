# Generation Speed Display — Design

**Date:** 2026-05-14  
**Scope:** Show LLM generation speed (tok/s) in the sidebar after operation completes.

## Summary

Extract `output_tokens` from the `result` stream-json event and display `tok/s` in two places in the sidebar:
1. **Progress header** — after the operation finishes
2. **Result section header** — alongside the "Result" label

## Data Source

The claude CLI `--output-format stream-json` result event contains:
```json
{
  "type": "result",
  "duration_ms": 42000,
  "total_cost_usd": 0.012,
  "usage": { "output_tokens": 580 }
}
```

Calculation: `tokPerSec = Math.round(output_tokens / (duration_ms / 1000))`

Guard: if `duration_ms === 0`, skip calculation — treat as no speed data (same as absent `output_tokens`).

If `usage.output_tokens` is absent (other backends, mock), speed is not shown.

## Changes

### `src/types.ts`
Add `outputTokens?: number` to the `result` variant of `RunEvent`:
```ts
| { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
```

### `src/stream.ts` — `mapResult()`
Extract `output_tokens` from `obj.usage`:
```ts
const usage = isRecord(obj.usage) ? obj.usage : null;
const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
return { kind: "result", durationMs, usdCost, text, outputTokens };
```

### `src/view.ts` — two display locations

**New class fields:**
```ts
private lastTokPerSec: number | undefined;
private resultSpeedEl: HTMLElement | null = null;
```

**1. Progress header** (`progressCount` span):
- During run: unchanged — `steps N, 42.1s`
- `updateMetrics()` keeps current logic (clears text when `state !== "running"`)
- After finish: `finish()` sets `progressCount` text **directly after** calling `updateMetrics()`:
  ```ts
  this.updateMetrics(); // clears progressCount since state is now "done"/"error"/"cancelled"
  if (this.lastTokPerSec !== undefined) {
    const dur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
    this.progressCount.setText(
      i18n().view.stepsCount(this.stepCount, dur) + ` · ${this.lastTokPerSec} tok/s`
    );
  }
  ```

**2. Result section header** — `resultSpeedEl` span created during `onOpen()` after the "Result" text, initially empty:
```ts
// in onOpen(), after resultH4.appendText(` ${T.view.result}`)
this.resultSpeedEl = resultH4.createSpan({ cls: "muted ai-wiki-result-speed" });
```
- Set text in `finish()`: `this.resultSpeedEl.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "")`
- Empty text = invisible. No CSS toggling needed.

**Data flow:**
1. `appendEvent({ kind: "result", outputTokens, durationMs })` calculates and stores `this.lastTokPerSec`
2. `finish()` reads `this.lastTokPerSec` → updates `progressCount` and `resultSpeedEl`
3. `setRunning()` resets `this.lastTokPerSec = undefined` and `this.resultSpeedEl?.setText("")`

**Important:** `RunHistoryEntry` intentionally does NOT get `outputTokens` — history entries already record `finalText`; adding token counts adds storage without benefit since speed is only shown for the current/latest run. Speed display resets on next `setRunning()`.

### `tests/fixtures/stream-ingest.jsonl`
Update the final `result` line to include usage:
```json
{"type":"result","subtype":"success","duration_ms":42000,"is_error":false,"result":"Создано 1 страница, обновлено 0","total_cost_usd":0.012,"usage":{"output_tokens":580}}
```

### `src/controller.ts` — backend + model in log

Add private field to controller:
```ts
private _currentLogMeta: { backend: string; model: string } | null = null;
```

In `dispatch()`, inside the existing settings block (after guards pass), compute and store meta — note `eff` is block-scoped here, so set `_currentLogMeta` before the block closes:
```ts
{
  const local = await this.localConfigStore.load();
  const eff = resolveEffective(this.plugin.settings, local);
  if (eff.backend === "native-agent" && !this.requireNativeAgent(eff)) return;
  if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
  const opKey = (op === "query-save" ? "query" : op) as OpKey;
  this._currentLogMeta = {
    backend: eff.backend,
    model: eff.backend === "claude-agent"
      ? (eff.claudeAgent.perOperation ? eff.claudeAgent.operations[opKey].model : eff.claudeAgent.model)
      : (eff.nativeAgent.perOperation ? eff.nativeAgent.operations[opKey].model : eff.nativeAgent.model),
  };
}
```

In `finally {}` of `dispatch()`:
```ts
this._currentLogMeta = null;
```

### `src/controller.ts` — `logEvent()`

Include `backend`, `model`, and computed `tokPerSec` (when available) in every log line:

```ts
const extra = ev.kind === "result" && ev.outputTokens !== undefined && ev.durationMs > 0
  ? { tokPerSec: Math.round(ev.outputTokens / (ev.durationMs / 1000)) }
  : {};
const line = JSON.stringify({
  ts: new Date().toISOString(),
  session: sessionId, op, domainId,
  backend: this._currentLogMeta?.backend,
  model: this._currentLogMeta?.model,
  event: ev,
  ...extra,
}) + "\n";
```

Log entry example for `result` event:
```json
{"ts":"2026-05-14T10:00:00.000Z","session":"abc","op":"ingest","domainId":"ии","backend":"claude-agent","model":"haiku","event":{"kind":"result","durationMs":42000,"usdCost":0.012,"text":"...","outputTokens":580},"tokPerSec":14}
```

If `outputTokens` absent or `durationMs === 0` — `tokPerSec` field omitted.
`backend`/`model` will be `undefined` (and omitted by `JSON.stringify`) for log lines written outside `dispatch()` (e.g. chat flow) — acceptable, chat path can be extended separately.

### Tests

**`tests/stream.test.ts`** — add case:
- Result event with `usage.output_tokens: 580` → parsed event has `outputTokens: 580`
- Result event without `usage` → parsed event has `outputTokens: undefined`

**`tests/agent-runner.integration.test.ts`** — no changes needed (integration test uses mock adapter, doesn't test view rendering).

View rendering logic (`lastTokPerSec` stored in `appendEvent`, displayed in `finish()`, reset in `setRunning()`) is covered by manual browser testing — no unit tests for DOM manipulation (consistent with existing view test coverage: zero).

## Display Format

- Value: `Math.round(tok/s)` — integer, no decimal
- Unit: `tok/s` (language-neutral, not i18n'd — same convention as existing `s` for seconds)
- Separator in Progress header: ` · ` (middle dot with spaces)
- Result header: leading space + `N tok/s` (e.g. ` 150 tok/s`)
- No display if `outputTokens` is undefined (empty string on span, no text in progressCount)

## Out of Scope

- Live speed during generation (no per-chunk token counts in stream protocol)
- Storing speed in history entries
- `input_tokens` or total tokens display
