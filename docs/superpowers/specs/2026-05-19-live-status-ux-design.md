---
state: approved
review:
  spec_hash: c29af0e4ed8dfca6
  last_run: "2026-05-19"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Status Content by Event"
      section_hash: 4308e4d417622e35
      text: >
        Строка "waiting" в таблице указывала Status text `⏳ {elapsed}s...`,
        но implementation note говорил "no change needed for Status tick".
        Противоречие устранено: startWaiting() теперь явно обновляет Status.
      verdict: fixed
      verdict_at: "2026-05-19"
    - id: F-002
      phase: clarity
      severity: INFO
      section: "Remove"
      section_hash: 5c124ac6fc4e1992
      text: >
        Перечислены .ai-wiki-step.assistant и .ai-wiki-assistant-text для
        удаления из CSS, но они отсутствуют в dist/styles.css.
        Устранено: несуществующие правила убраны из спеки.
      verdict: fixed
      verdict_at: "2026-05-19"
---

# Live Status UX Design

**Scope:** Replaces the live-response-ux streaming approach. Removes auto-collapse of Progress and streaming of `assistant_text` to Result. Adds a compact Status section that mirrors the current activity from Progress.

## Goals

- Progress panel stays open during operation (no auto-collapse).
- New **Status** section below Progress: one-line live indicator of current activity.
- Result section shows only the final text after `finish()` (no streaming).
- Chat section behavior unchanged (appears in Result after `finish()` for supported operations).

## Layout

```
[Progress header]          ← always visible, click to toggle
[stepsEl]                  ← full history: tool calls, reasoning block, file progress, errors

[Status section]           ← visible only during operation, not collapsible
  {icon} {activity text}  ← single line, updates in real time

[Result section]           ← hidden during operation, shown in finish()
  [finalEl]                ← final markdown text
  [Chat section]           ← query/lint/ingest after finish()
```

## Status Content by Event

| Event | Status text |
|---|---|
| `tool_use` | `🔧 {name}  {truncated_arg}` |
| `assistant_text` isReasoning | `🧠 Analysing...` |
| `assistant_text` non-reasoning | `💬 Forming response...` |
| waiting (after `tool_result`) | `⏳ {elapsed}s...` (existing waiting ticker) |
| `result` / `finish()` | hide Status section |

The Status **does not** scroll or accumulate history — it always shows the current/latest state.

## view.ts Changes

### Fields to remove

```typescript
// Remove entirely — streaming is gone
private assistantStarted = false;
private assistantBuffer = "";
private assistantRenderHandle: ReturnType<typeof setTimeout> | null = null;
private assistantFinalComp: Component | null = null;
```

### Fields to add

```typescript
private liveStatusSection: HTMLElement | null = null;
private liveStatusIconEl: HTMLElement | null = null;
private liveStatusTextEl: HTMLElement | null = null;
```

### onOpen() addition

After `stepsEl` creation, before `resultSection`:

```typescript
this.liveStatusSection = root.createDiv("ai-wiki-live-status ai-wiki-hidden");
this.liveStatusIconEl = this.liveStatusSection.createSpan("ai-wiki-live-status-icon");
this.liveStatusTextEl = this.liveStatusSection.createSpan("ai-wiki-live-status-text");
```

### setRunning() changes

- Remove resets for `assistantStarted`, `assistantBuffer`, `assistantRenderHandle`, `assistantFinalComp`.
- Add: show and clear Status section.

```typescript
// Show Status, clear content
this.liveStatusSection?.removeClass("ai-wiki-hidden");
this.liveStatusIconEl?.setText("");
this.liveStatusTextEl?.setText("");
```

### appendEvent() changes

**Remove** from `assistant_text` non-reasoning handler:
- The `assistantStarted` flag and all auto-collapse logic.
- The `scheduleAssistantRender()` call.
- The entire else-branch becomes a Status update only.

**Add** Status updates:

```typescript
// tool_use handler (after existing step creation)
this.liveStatusIconEl?.setText("🔧");
this.liveStatusTextEl?.setText(`${ev.name}  ${summariseInput(ev.input)}`);

// assistant_text isReasoning branch
this.liveStatusIconEl?.setText("🧠");
this.liveStatusTextEl?.setText("Analysing...");

// assistant_text non-reasoning branch (replaces all streaming logic)
this.liveStatusIconEl?.setText("💬");
this.liveStatusTextEl?.setText("Forming response...");
```

The existing `startWaiting()` / `stopWaiting()` ticker updates `waitingStep` in Progress. Additionally, `startWaiting()` must update the Status section:

```typescript
// In startWaiting() — after creating waitingStep
this.liveStatusIconEl?.setText("⏳");
this.liveStatusTextEl?.setText("0.0s");
// The existing tick callback must also update liveStatusTextEl with elapsed time.
```

`stopWaiting()` does not touch Status — the next `tool_use` or `assistant_text` event overwrites it.

### finish() changes

Hide Status section, keep existing Result render logic unchanged.

```typescript
this.liveStatusSection?.addClass("ai-wiki-hidden");
```

### onClose() changes

Remove `assistantRenderHandle` cleanup. Add null-out of Status refs.

### Method to remove

`scheduleAssistantRender()` — deleted entirely.

## CSS Changes

### Add

```css
.ai-wiki-live-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--background-secondary);
  border-radius: 4px;
  font-family: var(--font-monospace);
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}
.ai-wiki-live-status-icon { flex: 0 0 auto; }
.ai-wiki-live-status-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

### Remove

```css
/* No longer needed — Progress never auto-collapses */
.reasoning--collapsed .ai-wiki-reasoning-text { ... }
.reasoning--collapsed .ai-wiki-step-name::after { ... }
```

## Files Changed

| File | Change |
|---|---|
| `src/view.ts` | Remove streaming fields/logic, add Status section |
| `src/styles.css` | Add `.ai-wiki-live-status`, remove dead rules |
| `package.json` + `src/manifest.json` | patch version bump |
| `dist/main.js` + `dist/manifest.json` | rebuild |

## Manual Verification

After deploy to Obsidian:

1. **query** operation:
   - Progress open throughout, all tool calls visible
   - Status updates: 🔧 → ⏳ → 🔧 → 🧠 → 💬
   - Result hidden during operation
   - After finish: Status hidden, Result shows final markdown, Chat appears

2. **lint** operation: same behavior

3. **ingest**: file progress bar visible in Progress, Status shows current tool_use

4. Cancel mid-operation: Status hides, Progress stays as-is
