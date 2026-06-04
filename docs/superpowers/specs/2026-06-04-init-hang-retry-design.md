---
review:
  spec_hash: "d64bcb8962cd09cd"
  last_run: "2026-06-04"
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Files changed"
      section_hash: "0261754a0a829ff3"
      text: "src/settings.ts and src/i18n.ts missing from files list; new settings fields need UI and i18n strings."
      verdict: fixed
      verdict_at: "2026-06-04"
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "## Files changed"
      section_hash: "0261754a0a829ff3"
      text: "Wrong test path: src/tests/agent-runner.test.ts → tests/agent-runner.test.ts"
      verdict: fixed
      verdict_at: "2026-06-04"
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "## Watchdog placement: `AgentRunner.run()`"
      section_hash: "c631d3416cab3e18"
      text: "devMode/eval behavior in retry loop unspecified. Added explicit DoD: runs only on final successful attempt."
      verdict: fixed
      verdict_at: "2026-06-04"
chain:
  intent: "docs/superpowers/intents/2026-06-04-init-hang-retry-intent.md"
---
# Design: Init/Ingest/Lint hang detection and auto-retry

**Date:** 2026-06-04
**Status:** approved
**Intent:** `docs/superpowers/intents/2026-06-04-init-hang-retry-intent.md`

## Problem

Init, ingest, and lint operations hang silently between LLM calls — no error, no activity, process alive indefinitely. The existing `timeouts.*` covers total operation duration but not idle gaps between calls.

## Scope

- Operations: `init`, `ingest`, `lint`
- Hang type: silence **between** LLM calls (no `llm_call_stats` / `assistant_text` events)
- Not affected: intra-stream token delays (separate concern), `chat` / `lint-chat` / `format` / `query`

## Settings

Two new top-level fields in `LlmWikiPluginSettings` (stored in `data.json`):

```typescript
llmIdleTimeoutSec: number;  // default: 300 — seconds of LLM silence before abort
llmIdleRetries: number;     // default: 3   — max retry attempts after idle abort
```

These are distinct from `timeouts.*` (which cap total operation duration).

Default values added to `DEFAULT_SETTINGS`.

## Watchdog placement: `AgentRunner.run()`

`run()` wraps `runOperation` in a retry loop. On each attempt:

1. Create `idleCtrl = new AbortController()`
2. Pass `AbortSignal.any([req.signal, idleCtrl.signal])` as the combined signal to `runOperation`
3. Start idle timer: `setTimeout(() => idleCtrl.abort(), idleTimeoutMs)`
4. Reset timer on each `llm_call_stats` or `assistant_text` event from the generator
5. On AbortError: if `req.signal` is still live → retry; otherwise → propagate

```typescript
async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
  const { model, opts } = this.buildOptsFor(req.operation);
  // ... yield system event, early-abort check ...

  const idleTimeoutMs = (this.settings.llmIdleTimeoutSec ?? 300) * 1000;
  const maxRetries = this.settings.llmIdleRetries ?? 3;
  let attempt = 0;

  while (true) {
    const idleCtrl = new AbortController();
    const combined = AbortSignal.any([req.signal, idleCtrl.signal]);
    let idleTimer: ReturnType<typeof setTimeout> | null =
      idleTimeoutMs > 0 ? setTimeout(() => idleCtrl.abort(), idleTimeoutMs) : null;

    const resetTimer = () => {
      if (!idleTimer) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleCtrl.abort(), idleTimeoutMs);
    };

    try {
      for await (const ev of this.runOperation({ ...req, signal: combined }, ...)) {
        if (ev.kind === "llm_call_stats" || ev.kind === "assistant_text") resetTimer();
        yield ev;
        // ... devMode / eval logic unchanged ...
      }
      if (idleTimer) clearTimeout(idleTimer);
      return; // success
    } catch (err) {
      if (idleTimer) clearTimeout(idleTimer);
      const isIdleAbort = !req.signal.aborted && (err as Error).name === "AbortError";
      if (isIdleAbort && attempt < maxRetries) {
        attempt++;
        const sec = Math.round(idleTimeoutMs / 1000);
        yield { kind: "system", message: `LLM idle ${sec}s — retrying (${attempt}/${maxRetries})` };
        continue;
      }
      throw err;
    }
  }
}
```

**Why `AgentRunner` and not `controller.ts`:** AgentRunner owns the operation lifecycle and is testable in isolation from the UI layer.

**Resumability:** ingest/init naturally resume from last position via `analyzed_sources` — no special checkpoint logic needed.

**devMode/eval:** runs only on the final successful attempt (inside the `try` block after the `for await` loop completes). On aborted attempts it is skipped entirely — same as the current behavior when an operation is cancelled.

**`idleTimeoutMs = 0` disables watchdog** (consistent with `timeout = 0` means no-limit pattern in this codebase).

## Event visibility

Retry event uses existing `kind: "system"` — flows through the normal event pipeline:
- Logged to `_agent.jsonl` via `controller.logEvent` (no format change)
- Displayed in UI via `view.appendEvent`

## Tests

Three unit tests for `AgentRunner` with a controllable fake `runOperation`:

1. **Normal run** — idle timer does not fire, no retry, no system retry event emitted
2. **Idle → retry → success** — first attempt emits no LLM events for timeout duration, second attempt completes; verify `kind: "system"` retry message in event stream
3. **Idle exhausted** — all `maxRetries` attempts time out; verify AbortError propagates, correct retry count in system messages

## Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `llmIdleTimeoutSec`, `llmIdleRetries` to interface + defaults |
| `src/agent-runner.ts` | Wrap `runOperation` in idle watchdog retry loop |
| `src/settings.ts` | Add UI fields for `llmIdleTimeoutSec` and `llmIdleRetries` |
| `src/i18n.ts` | Add labels/descriptions for new settings fields |
| `tests/agent-runner.test.ts` | Add 3 new tests |

## Constraints honored

- `_agent.jsonl` format unchanged (uses existing `kind: "system"`)
- `parseWithRetry` untouched
- `chat`/`lint-chat`/`format`/`query` behavior unchanged
- No files outside scope touched
