---
title: Live Response UX — streaming to Result section with markdown rendering
date: 2026-05-19
status: approved
review:
  spec_hash: bce1d80a331bdd9e
  last_run: 2026-05-19
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "finish() — one small addition"
      section_hash: 8b9c6811f0e4c6eb
      text: "Заголовок секции «no logic changes» противоречит телу: тело добавляет clearTimeout — это изменение логики. Вводит в заблуждение."
      verdict: fixed
      verdict_at: 2026-05-19
---

## Problem

Three UX issues in the current `LlmWikiView`:

1. **Wrong order**: Reasoning block appears at top of steps, assistant response ("forming response") appears at the bottom — forcing the user to scroll past tool calls to see the answer.
2. **Excessive noise before response**: All `tool_use`, `tool_result`, and waiting steps are visible during execution. Before the answer arrives there is no clear signal of progress for the user.
3. **Plain text streaming**: `assistant_text` events render via `setText()`, which shows raw markdown syntax (`**bold**`, `## Header`) instead of rendered HTML.

## Solution: Approach A — stream to Result section

When the first non-reasoning `assistant_text` event arrives:

1. Auto-collapse the Progress section (hide `stepsEl`).
2. Collapse the reasoning block in-place (hide text, keep header).
3. Show the Result section with the streamed answer rendered as markdown.

## Architecture

### Removed from `view.ts`

| Symbol | Where used | Replaced by |
|---|---|---|
| `assistantBlock: HTMLElement \| null` | stepsEl DOM element | streaming to `finalEl` directly |
| `assistantRafHandle: number \| null` | RAF for setText in stepsEl | `assistantRenderHandle` (setTimeout) |
| `.ai-wiki-step.assistant` DOM creation | `appendEvent` | removed |

### Added to `view.ts`

| Symbol | Purpose |
|---|---|
| `assistantStarted: boolean` | true once first non-reasoning assistant_text received |
| `assistantRenderHandle: ReturnType<typeof setTimeout> \| null` | 150ms debounce for MarkdownRenderer |
| `assistantFinalComp: Component \| null` | Obsidian Component for MarkdownRenderer lifecycle |

### `setRunning()` additions

```typescript
this.assistantStarted = false;
if (this.assistantRenderHandle !== null) {
  window.clearTimeout(this.assistantRenderHandle);
  this.assistantRenderHandle = null;
}
this.assistantFinalComp?.unload();
this.assistantFinalComp = null;
```

### `appendEvent()` — `assistant_text` (non-reasoning)

```typescript
if (!this.assistantStarted) {
  this.assistantStarted = true;
  // 1. Collapse Progress
  this.stepsOpen = false;
  this.stepsEl.addClass("ai-wiki-hidden");
  this.progressToggle.setText("▶");
  // 2. Collapse reasoning
  this.reasoningBlock?.addClass("reasoning--collapsed");
  // 3. Show Result
  this.resultSection.removeClass("ai-wiki-hidden");
  this.resultOpen = true;
  this.resultToggle.setText("▼");
  this.finalEl.removeClass("ai-wiki-hidden");
}
this.assistantBuffer += ev.delta;
this.scheduleAssistantRender();
```

### `scheduleAssistantRender()` — new private method

```typescript
private scheduleAssistantRender(): void {
  if (this.assistantRenderHandle !== null) return;
  this.assistantRenderHandle = window.setTimeout(() => {
    this.assistantRenderHandle = null;
    if (!this.assistantBuffer) return;
    this.finalEl.empty();
    if (!this.assistantFinalComp) {
      this.assistantFinalComp = new Component();
      this.assistantFinalComp.load();
    }
    void MarkdownRenderer.render(
      this.app, this.assistantBuffer, this.finalEl, "", this.assistantFinalComp
    ).then(() => sanitizeLinks(this.finalEl));
  }, 150);
}
```

Debounce at 150ms → ~6 renders/sec during streaming. Single `assistantFinalComp` is reused across ticks to avoid repeated load/unload.

### `finish()` — one small addition

`finish()` already calls `MarkdownRenderer.render(app, entry.finalText, this.finalEl, ...)` which overwrites streaming content with the complete final text. Existing behavior is correct.

Cancel pending render in `finish()` before the final render:
```typescript
if (this.assistantRenderHandle !== null) {
  window.clearTimeout(this.assistantRenderHandle);
  this.assistantRenderHandle = null;
}
```

### `tool_use` event — remove stale references

```typescript
// Before:
this.assistantBlock = null;
this.assistantBuffer = "";
// After:
this.assistantBuffer = "";
// (assistantBlock field removed entirely)
```

### `result` event — remove stale reference

```typescript
// Before:
this.assistantBlock = null;
// After: (removed)
```

## CSS changes (`styles.css`)

```css
/* Reasoning auto-collapse when answer starts */
.reasoning--collapsed .ai-wiki-reasoning-text {
  display: none;
}
.reasoning--collapsed .ai-wiki-step-name::after {
  content: " (collapsed)";
  font-size: 0.8em;
  opacity: 0.6;
}
```

## Scope

- Affects `src/view.ts` and `styles.css` only.
- No changes to `stream.ts`, `types.ts`, `agent-runner.ts`, or phases.
- No new tests required (view rendering is not covered by current test suite).
- All operations (`query`, `lint`, `ingest`, `init`) affected equally — any `assistant_text` triggers the same flow.

## Not in scope

- Chat streaming (`appendChatEvent` / `setChatRunning` / `finishChat`) — separate stream, unchanged.
- Format preview — unchanged.
- Reasoning is not hidden before answer starts; it stays visible in the (open) Progress section until answer begins.
