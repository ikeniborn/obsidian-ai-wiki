# Design: Stream Aggregation for Native Backend

**Date:** 2026-05-14  
**Status:** Draft

## Problem

When using `native-agent` backend (Ollama / OpenAI-compatible API), streaming is enabled for all phases. Each SSE chunk arrives as one `assistant_text` RunEvent. Three compounding issues:

1. **Inflated step counter** — `view.ts` calls `stepCount++` unconditionally. A 500-token response generates ~200 chunks → counter shows 200 steps instead of the actual tool-call count (0–5).
2. **UI thrash** — each chunk triggers `span.setText()` + `scrollSteps()` (= `scrollTop = scrollHeight`, a forced layout reflow). 200 DOM mutations per second saturate Obsidian's render loop.
3. **Log I/O flood** — `controller.ts` `logEvent()` calls `adapter.append()` for every event. With `agentLogEnabled: true`, 200 chunks → 200 file writes to `!Logs/agent.jsonl`. Final text is already captured in the `result` event — chunk-level log entries are noise.

Streaming itself is not the problem and must be preserved. Only the counting, rendering, and logging of `assistant_text` events need fixing.

## Solution

Three targeted fixes across two files. No changes to phases, types, agent-runner, or LlmClient.

### Fix 1 — `src/view.ts`: stepCount excludes `assistant_text`

`stepCount` reflects meaningful progress (tool calls). Text tokens are not steps.

```ts
// before (line ~362):
this.stepCount++;

// after:
if (ev.kind !== "assistant_text") this.stepCount++;
```

Side effect: static status strings yielded by lint (`"Evaluating domain..."`, `"Actualizing..."`, `"Applying fixes..."`) also stop incrementing the counter. This is correct — they are informational markers, not tool calls.

### Fix 2 — `src/view.ts`: throttle `assistant_text` DOM updates via `requestAnimationFrame`

Currently (lines 416–420) every chunk calls `span.setText()` and `scrollSteps()` synchronously. With rAF, all chunks arriving within one frame are flushed together — maximum 60 DOM mutations per second instead of 200+.

Add two private fields:

```ts
private assistantRafHandle: number | null = null;
private reasoningRafHandle: number | null = null;
```

Replace the `assistant_text` branch in `onEvent()`:

```ts
} else if (ev.kind === "assistant_text") {
  if (ev.isReasoning) {
    if (!this.reasoningBlock) {
      this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
      if (this.assistantBlock) {
        this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
      }
      this.reasoningBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
      this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
    }
    this.reasoningBuffer += ev.delta;
    if (!this.reasoningRafHandle) {
      this.reasoningRafHandle = window.requestAnimationFrame(() => {
        this.reasoningRafHandle = null;
        const span = this.reasoningBlock?.querySelector<HTMLElement>(".ai-wiki-reasoning-text");
        if (span) span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
        this.scrollSteps();
      });
    }
  } else {
    if (!this.assistantBlock) {
      this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
      this.assistantBlock.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
      this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
    }
    this.assistantBuffer += ev.delta;
    if (!this.assistantRafHandle) {
      this.assistantRafHandle = window.requestAnimationFrame(() => {
        this.assistantRafHandle = null;
        const span = this.assistantBlock?.querySelector<HTMLElement>(".ai-wiki-assistant-text");
        if (span) span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
        this.scrollSteps();
      });
    }
  }
  // scrollSteps() moved inside rAF — remove the call that was here
}
```

Cancel pending rAF handles on reset (in `setRunning()`):

```ts
if (this.assistantRafHandle !== null) {
  window.cancelAnimationFrame(this.assistantRafHandle);
  this.assistantRafHandle = null;
}
if (this.reasoningRafHandle !== null) {
  window.cancelAnimationFrame(this.reasoningRafHandle);
  this.reasoningRafHandle = null;
}
```

Also cancel both handles in `tool_use` branch (where both `assistantBlock` and `reasoningBlock` are reset):

```ts
if (this.assistantRafHandle !== null) {
  window.cancelAnimationFrame(this.assistantRafHandle);
  this.assistantRafHandle = null;
}
if (this.reasoningRafHandle !== null) {
  window.cancelAnimationFrame(this.reasoningRafHandle);
  this.reasoningRafHandle = null;
}
```

### Fix 3 — `src/controller.ts`: skip `assistant_text` in `logEvent()`

The final LLM response text is already written to the log via the `result` event. Chunk-level entries are redundant and cause 200 file I/O operations per LLM call.

```ts
private async logEvent(..., ev: RunEvent): Promise<void> {
  if (!this.plugin.settings.agentLogEnabled) return;
  if (ev.kind === "assistant_text") return;  // NEW: final text captured in result event
  // ... rest unchanged
}
```

## Scope

**Changed:**
- `src/view.ts` — stepCount fix (1 line), rAF throttle (~20 lines), 4 cancel sites
- `src/controller.ts` — 1 line in `logEvent()`

**Not changed:** phases, `types.ts`, `agent-runner.ts`, `claude-cli-client.ts`, `stream.ts`, settings UI, `chat.ts`.

## Trade-offs

- Streaming preserved — live text feedback in panel still works, just capped at 60fps.
- `claude-agent` backend: same fixes apply and improve behaviour there too (claude-agent also streams `assistant_text`).
- `agentLogEnabled` log now contains: `system` (start/finish), `tool_use`, `tool_result`, `result`, `error`. Complete picture without noise.

## Testing

- Manual with native backend (Ollama): run query/init/lint — step counter shows tool-call count only; panel scrolls smoothly during generation.
- Manual with claude-agent backend: same three operations — verify step counter and scroll behaviour match native backend results.
- Manual with `agentLogEnabled: true`: verify `!Logs/agent.jsonl` contains no `assistant_text` entries; `result` entry contains full response text.
- `tests/phases/` — no changes needed (phase outputs unaffected).
