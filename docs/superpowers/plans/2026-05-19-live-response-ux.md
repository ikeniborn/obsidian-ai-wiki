---
review:
  plan_hash: acf8e8858f16c8d4
  spec_hash: bce1d80a331bdd9e
  last_run: 2026-05-19
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: "Task 4: Remove insertBefore from reasoning block creation"
      section_hash: 32ae4d924fe484f8
      text: "Step 2 DoD: grep assistantBlock на tsc-ошибках даст ненулевой результат — appendEvent() else-ветка (код Task 5) ещё содержит this.assistantBlock после завершения Task 4."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "Task 5: Replace non-reasoning assistant_text handler"
      section_hash: 561d5d1e73d1367b
      text: "Step 2 DoD: grep assistantRafHandle даст ненулевой результат — onClose() ещё содержит старую ссылку this.assistantRafHandle (убирается в Task 7)."
      verdict: fixed
      verdict_at: 2026-05-19
    - id: F-003
      phase: coverage
      severity: WARNING
      section: "Task 7: Update finish() and onClose() cleanup"
      section_hash: 7ae585696520f0dd
      text: "Step 1 добавляет assistantFinalComp?.unload() в finish() — спека в разделе finish() показывает только clearTimeout, без unload."
      verdict: accepted
      verdict_at: 2026-05-19
    - id: F-004
      phase: coverage
      severity: WARNING
      section: "Task 7: Update finish() and onClose() cleanup"
      section_hash: 7ae585696520f0dd
      text: "Step 2 (onClose cleanup) не описан в спеке — ни раздела, ни кода для onClose() нет."
      verdict: accepted
      verdict_at: 2026-05-19
---

# Live Response UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream `assistant_text` to the Result section with debounced MarkdownRenderer, auto-collapse Progress and reasoning when the answer starts.

**Architecture:** When the first non-reasoning `assistant_text` arrives, `appendEvent()` collapses the Progress panel, collapses the reasoning block, shows the Result section, and starts streaming the buffer into `finalEl` via a 150ms-debounced `MarkdownRenderer.render()` call. `finish()` cancels any pending render and does its own final render as before.

**Tech Stack:** TypeScript, Obsidian API (`MarkdownRenderer`, `Component`), `src/view.ts`, `src/styles.css`

---

### Task 1: Replace assistant fields in LlmWikiView

**Files:**
- Modify: `src/view.ts:95-99`

Remove `assistantBlock` and `assistantRafHandle`; add `assistantStarted`, `assistantRenderHandle`, `assistantFinalComp`.

- [ ] **Step 1: Edit fields block**

Find and replace this exact block in `src/view.ts` (lines 95–99):

```typescript
  private assistantBlock: HTMLElement | null = null;
  private assistantBuffer = "";
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";
  private assistantRafHandle: number | null = null;
```

Replace with:

```typescript
  private assistantStarted = false;
  private assistantBuffer = "";
  private assistantRenderHandle: ReturnType<typeof setTimeout> | null = null;
  private assistantFinalComp: Component | null = null;
  private reasoningBlock: HTMLElement | null = null;
  private reasoningBuffer = "";
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors about `assistantBlock` or `assistantRafHandle` not existing yet — they're still referenced in other methods; those get fixed in later tasks. Ignore those specific errors for now; focus only on syntax errors in the fields block itself.

---

### Task 2: Update setRunning() reset block

**Files:**
- Modify: `src/view.ts:378-389`

Replace the old reset block with new fields.

- [ ] **Step 1: Edit setRunning() reset block**

Find in `src/view.ts`:

```typescript
    this.assistantBlock = null;
    this.assistantBuffer = "";
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    if (this.assistantRafHandle !== null) {
      window.cancelAnimationFrame(this.assistantRafHandle);
      this.assistantRafHandle = null;
    }
    if (this.reasoningRafHandle !== null) {
      window.cancelAnimationFrame(this.reasoningRafHandle);
      this.reasoningRafHandle = null;
    }
```

Replace with:

```typescript
    this.assistantStarted = false;
    this.assistantBuffer = "";
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    if (this.reasoningRafHandle !== null) {
      window.cancelAnimationFrame(this.reasoningRafHandle);
      this.reasoningRafHandle = null;
    }
```

- [ ] **Step 2: Verify no syntax errors**

```bash
npx tsc --noEmit 2>&1 | grep "setRunning\|view.ts:3[7-9]"
```

Expected: no errors in the setRunning block.

---

### Task 3: Remove stale assistantBlock references from tool_use and result handlers

**Files:**
- Modify: `src/view.ts:479-486` (tool_use)
- Modify: `src/view.ts:572` (result)

- [ ] **Step 1: Fix tool_use handler**

Find in `src/view.ts` (inside the `if (ev.kind === "tool_use")` block):

```typescript
      this.assistantBlock = null;
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      if (this.assistantRafHandle !== null) {
        window.cancelAnimationFrame(this.assistantRafHandle);
        this.assistantRafHandle = null;
      }
      if (this.reasoningRafHandle !== null) {
        window.cancelAnimationFrame(this.reasoningRafHandle);
        this.reasoningRafHandle = null;
      }
```

Replace with:

```typescript
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      if (this.reasoningRafHandle !== null) {
        window.cancelAnimationFrame(this.reasoningRafHandle);
        this.reasoningRafHandle = null;
      }
```

- [ ] **Step 2: Fix result handler**

Find in `src/view.ts` (inside `else if (ev.kind === "result")`):

```typescript
    } else if (ev.kind === "result") {
      this.stopWaiting();
      this.assistantBlock = null;
      if (ev.outputTokens !== undefined && ev.durationMs > 0) {
```

Replace with:

```typescript
    } else if (ev.kind === "result") {
      this.stopWaiting();
      if (ev.outputTokens !== undefined && ev.durationMs > 0) {
```

- [ ] **Step 3: Verify no syntax errors in handlers**

```bash
npx tsc --noEmit 2>&1 | grep "tool_use\|result\|view.ts:4[7-9]\|view.ts:5[7-9]"
```

Expected: no errors in those ranges.

---

### Task 4: Remove insertBefore from reasoning block creation

**Files:**
- Modify: `src/view.ts:523-531`

The `insertBefore(reasoningBlock, assistantBlock)` guard is dead code once `assistantBlock` is removed.

- [ ] **Step 1: Remove the insertBefore guard**

Find in `src/view.ts`:

```typescript
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
```

Replace with:

```typescript
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
          const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
```

- [ ] **Step 2: Check insertBefore is gone**

```bash
npx tsc --noEmit 2>&1 | grep "insertBefore"
```

Expected: no errors mentioning `insertBefore`. Note: `assistantBlock` errors from appendEvent's else-branch are expected at this stage — they are removed in Task 5.

---

### Task 5: Replace non-reasoning assistant_text handler

**Files:**
- Modify: `src/view.ts:542-558`

Remove the old stepsEl DOM creation + RAF; replace with Progress collapse + `scheduleAssistantRender()` call.

- [ ] **Step 1: Replace the else branch**

Find in `src/view.ts`:

```typescript
      } else {
        if (!this.assistantBlock) {
          this.assistantBlock = this.stepsEl.createDiv("ai-wiki-step assistant");
          const aHead = this.assistantBlock.createDiv("ai-wiki-step-head");
          aHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("💬");
          aHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.formingResponse);
          this.assistantBlock.createSpan({ cls: "ai-wiki-assistant-text" });
        }
        this.assistantBuffer += ev.delta;
        if (!this.assistantRafHandle) {
          this.assistantRafHandle = window.requestAnimationFrame(() => {
            this.assistantRafHandle = null;
            const span = this.assistantBlock?.querySelector<HTMLElement>(".ai-wiki-assistant-text");
            if (span) span.setText(this.assistantBuffer);
            this.scrollSteps();
          });
        }
      }
```

Replace with:

```typescript
      } else {
        if (!this.assistantStarted) {
          this.assistantStarted = true;
          this.stepsOpen = false;
          this.stepsEl.addClass("ai-wiki-hidden");
          this.progressToggle.setText("▶");
          this.reasoningBlock?.addClass("reasoning--collapsed");
          this.resultSection.removeClass("ai-wiki-hidden");
          this.resultOpen = true;
          this.resultToggle.setText("▼");
          this.finalEl.removeClass("ai-wiki-hidden");
        }
        this.assistantBuffer += ev.delta;
        this.scheduleAssistantRender();
      }
```

- [ ] **Step 2: Check old else-branch is gone**

```bash
npx tsc --noEmit 2>&1 | grep "assistantBlock\|requestAnimationFrame.*assistantRaf"
```

Expected: no errors from the replaced else-branch. Note: one `assistantRafHandle` error from `onClose()` is expected at this stage — removed in Task 7.

---

### Task 6: Add scheduleAssistantRender() method

**Files:**
- Modify: `src/view.ts` — add new private method after `scrollSteps()`

- [ ] **Step 1: Add the method**

Find in `src/view.ts`:

```typescript
  private scrollSteps(): void {
    this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
  }
```

Replace with:

```typescript
  private scrollSteps(): void {
    this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
  }

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

- [ ] **Step 2: Verify the new method compiles**

```bash
npx tsc --noEmit 2>&1 | grep "scheduleAssistantRender\|view.ts:8[8-9]\|view.ts:9[0-9]"
```

Expected: no errors.

---

### Task 7: Update finish() and onClose() cleanup

**Files:**
- Modify: `src/view.ts:667` (finish)
- Modify: `src/view.ts:198-200` (onClose)

- [ ] **Step 1: Add clearTimeout in finish() before finalEl.empty()**

Find in `src/view.ts`:

```typescript
    this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
    this.finalEl.empty();
```

Replace with:

```typescript
    this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
    this.finalEl.empty();
```

- [ ] **Step 2: Replace assistantRafHandle cleanup in onClose()**

Find in `src/view.ts`:

```typescript
    if (this.assistantRafHandle !== null) {
      window.cancelAnimationFrame(this.assistantRafHandle);
      this.assistantRafHandle = null;
    }
```

Replace with:

```typescript
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
```

- [ ] **Step 3: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

---

### Task 8: CSS — add reasoning--collapsed rules, remove dead assistant styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add reasoning--collapsed rules**

Find in `src/styles.css`:

```css
.ai-wiki-step.reasoning { display: flex; gap: 6px; align-items: flex-start; padding: 4px 0; opacity: 0.6; }
.ai-wiki-reasoning-text { white-space: pre-wrap; word-break: break-word; font-style: italic; color: var(--text-muted); font-size: 0.88em; }
```

Replace with:

```css
.ai-wiki-step.reasoning { display: flex; gap: 6px; align-items: flex-start; padding: 4px 0; opacity: 0.6; }
.ai-wiki-reasoning-text { white-space: pre-wrap; word-break: break-word; font-style: italic; color: var(--text-muted); font-size: 0.88em; }
.reasoning--collapsed .ai-wiki-reasoning-text { display: none; }
.reasoning--collapsed .ai-wiki-step-name::after { content: " (collapsed)"; font-size: 0.8em; opacity: 0.6; }
```

- [ ] **Step 2: Remove dead .ai-wiki-step.assistant and .ai-wiki-assistant-text rules**

Find in `src/styles.css`:

```css
.ai-wiki-step.assistant { display: flex; gap: 6px; align-items: flex-start; padding: 4px 0; }
.ai-wiki-assistant-text { white-space: pre-wrap; word-break: break-word; color: var(--text-normal); }
```

Delete those two lines entirely (they're dead code — the `.ai-wiki-step.assistant` DOM element is no longer created).

---

### Task 9: Build, bump version, commit

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/manifest.json` (version bump)
- Build: `dist/main.js`

- [ ] **Step 1: Read current version**

```bash
node -e "const p=require('./package.json'); console.log(p.version)"
```

Note the output (e.g. `0.1.109`).

- [ ] **Step 2: Bump patch version in package.json and src/manifest.json**

Increment the patch number (Z in X.Y.Z) in both files. For example if current is `0.1.109`:
- `package.json`: `"version": "0.1.109"` → `"version": "0.1.110"`
- `src/manifest.json`: `"version": "0.1.109"` → `"version": "0.1.110"`

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build completes with no errors; `dist/main.js` updated.

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all tests pass (no view tests exist; stream/settings/agent-runner tests should still pass).

- [ ] **Step 5: Commit**

```bash
git add src/view.ts src/styles.css package.json src/manifest.json dist/main.js dist/manifest.json
git commit -m "feat(view): stream assistant_text to Result with live markdown, auto-collapse Progress"
```

---

## Manual Verification Checklist

After deploying to Obsidian (symlink already set up per CLAUDE.md):

1. Run a **query** operation:
   - While tool calls run: Progress panel stays open, reasoning visible
   - When first text token arrives: Progress auto-collapses (▶), reasoning collapses with "(collapsed)" suffix, Result section opens (▼) with streaming markdown
   - `**bold**` and `## headers` render as HTML, not raw syntax
   - After `finish()`: Result section shows final rendered markdown

2. Run a **lint** operation:
   - Same behavior: tool calls visible in Progress until first assistant_text, then collapse + Result shows

3. Run an **ingest** operation:
   - File progress bar (📂) shows in Progress; when assistant summary text starts, Progress collapses

4. Check **chat** section: unaffected — still works as before (chat uses `appendChatEvent`, not `appendEvent`)
