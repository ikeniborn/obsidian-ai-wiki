# Design: Step Timing Display (#34)

**Date:** 2026-05-24
**Status:** draft
**Intent:** [2026-05-24-step-timing-intent.md](../intents/2026-05-24-step-timing-intent.md)

## Problem

In `src/view.ts`, `appendEvent()` creates progress steps for multiple event kinds. Only `tool_use`/`tool_result` pairs show elapsed time. Other step types — `system`, `graph_stats`, `reasoning` — have no time label at all. The waiting step initializes with `"0.0s"` text before any time has elapsed.

## Root Causes

| Step type | Bug |
|---|---|
| `system` | No `.ai-wiki-step-time` span added |
| `graph_stats` | No `.ai-wiki-step-time` span added |
| `reasoning` block | No `.ai-wiki-step-time` span added |
| Waiting step | Initializes with `"0.0s"` before first tick |
| `tool_use`/`tool_result` | Correct — no change needed |

## Solution (Approach A — minimal surgical fix)

Add `this.elapsedShort()` timestamp label to non-tool steps at creation time. Fix waiting step initial text.

### Changes in `src/view.ts`

**`system` event handler** (~line 648):
Add after the step-name span:
```typescript
head.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
```

**`graph_stats` event handler** (~line 568):
Add after step-name setText:
```typescript
step.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
```

**`reasoning` block creation** (~line 626):
Add after step-name span:
```typescript
rHead.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
```

**`startWaiting()`** (~line 983):
Change initial text from `"0.0s"` to `""`:
```typescript
this.waitingStep.createSpan({ cls: "ai-wiki-waiting-text" }).setText("");
```

## What Changes

- `system`, `graph_stats`, `reasoning` steps show `@Xs` timestamp (time since operation start) when they appear
- Waiting step no longer flashes `"0.0s"` before first 100ms tick
- Tool step timing unchanged (already correct)

## What Does NOT Change

- `elapsedShort()` implementation — already correct
- `tool_use`/`tool_result` timing logic
- Waiting step tick interval (100ms)
- CSS classes — `.ai-wiki-step-time` already styled

## Testing

- Run ingest on a file, open progress panel, verify all step types show time
- Verify waiting step between tool calls shows no "0.0s" flash
- Verify tool steps still show correct per-step duration
