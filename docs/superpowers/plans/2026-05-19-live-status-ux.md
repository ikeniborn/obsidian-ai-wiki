---
state: draft
review:
  plan_hash: c0a1eeebb75c6a12
  spec_hash: c29af0e4ed8dfca6
  last_run: "2026-05-19"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Task 10: Version bump + build + verify"
      section_hash: 8d84f3a2324b4135
      text: >
        Task 10 Step 4 git add не включает dist/manifest.json,
        тогда как спека (Files Changed) перечисляет dist/manifest.json как rebuild-артефакт.
      verdict: fixed
      verdict_at: "2026-05-19"
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "Task 4: view.ts — setRunning(): show/clear Status, remove assistant resets"
      section_hash: d39c5a71c46be7c1
      text: >
        Task 4 Step 3 «Verify no remaining references to removed fields in setRunning()»
        описывает что проверить, но не даёт grep-команды.
        Разработчику придётся проверять вручную.
      verdict: fixed
      verdict_at: "2026-05-19"
---

# Live Status UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace assistant-text streaming to Result with a compact one-line Status indicator, keep Progress open throughout operation.

**Architecture:** Remove four assistant-streaming fields from LlmWikiView, add three liveStatus DOM fields; create Status section in DOM between stepsEl and resultSection; update appendEvent/startWaiting to write to Status; hide Status in finish(). No new files — surgical edits to view.ts and src/styles.css only.

**Tech Stack:** TypeScript, Obsidian ItemView API, CSS custom properties

> **Note on testing:** LlmWikiView is DOM-heavy Obsidian code with no existing unit test coverage in `tests/`. All verification for this feature is manual (run in Obsidian, follow Manual Verification checklist in spec). Skip TDD loop — it would require a full Obsidian mock harness that doesn't exist.

---

## File Map

| File | Change |
|---|---|
| `src/styles.css` | Add `.ai-wiki-live-status` rules; remove `.reasoning--collapsed` rules |
| `src/view.ts` | Remove 4 fields, add 3 fields; update onOpen/setRunning/appendEvent/startWaiting/scheduleWaitingTick/finish/onClose; delete scheduleAssistantRender |
| `package.json` + `src/manifest.json` | 0.1.110 → 0.1.111 |
| `dist/main.js` + `dist/styles.css` | rebuilt by `npm run build` |

---

### Task 1: CSS — remove dead rules, add live-status styles

**Files:**
- Modify: `src/styles.css:61-62`

- [ ] **Step 1: Remove the two `.reasoning--collapsed` rules**

In `src/styles.css`, delete lines 61–62:

```css
.reasoning--collapsed .ai-wiki-reasoning-text { display: none; }
.reasoning--collapsed .ai-wiki-step-name::after { content: " (collapsed)"; font-size: 0.8em; opacity: 0.6; }
```

(These rules exist because non-reasoning `assistant_text` previously collapsed Progress and added `.reasoning--collapsed` to the reasoning block. That logic is removed in this feature.)

- [ ] **Step 2: Add live-status rules after `.ai-wiki-step--ask`**

After line 84 (`.ai-wiki-step--ask { ... }`) add:

```css
/* Live status — compact one-line activity indicator during operation */
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

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: add ai-wiki-live-status, remove reasoning--collapsed dead rules"
```

---

### Task 2: view.ts — remove streaming fields, add live-status fields

**Files:**
- Modify: `src/view.ts:95-98` (remove), `src/view.ts:102-103` (add after `waitingStep` block)

- [ ] **Step 1: Remove the four assistant-streaming fields (lines 95–98)**

Delete these four lines from the class field declarations:

```typescript
  private assistantStarted = false;
  private assistantBuffer = "";
  private assistantRenderHandle: ReturnType<typeof setTimeout> | null = null;
  private assistantFinalComp: Component | null = null;
```

- [ ] **Step 2: Add three live-status fields after `waitingStartedAt` (currently line 104 after removal)**

Add after `private waitingStartedAt = 0;`:

```typescript
  private liveStatusSection: HTMLElement | null = null;
  private liveStatusIconEl: HTMLElement | null = null;
  private liveStatusTextEl: HTMLElement | null = null;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors about `assistantStarted`, `assistantBuffer`, `assistantRenderHandle`, `assistantFinalComp` still being referenced elsewhere (that's expected — fixed in subsequent tasks). Any other errors are a problem.

---

### Task 3: view.ts — onOpen(): add live-status DOM section

**Files:**
- Modify: `src/view.ts` — between `stepsEl` creation and `resultSection` creation

- [ ] **Step 1: Locate the insertion point**

In `onOpen()`, find these two consecutive lines:

```typescript
    this.stepsEl = root.createDiv("ai-wiki-steps");
    this.stepsEl.addClass("ai-wiki-hidden");

    this.resultSection = root.createDiv("ai-wiki-result-section ai-wiki-hidden");
```

- [ ] **Step 2: Insert live-status DOM between stepsEl and resultSection**

After `this.stepsEl.addClass("ai-wiki-hidden");` and before `this.resultSection = ...`, add:

```typescript
    this.liveStatusSection = root.createDiv("ai-wiki-live-status ai-wiki-hidden");
    this.liveStatusIconEl = this.liveStatusSection.createSpan("ai-wiki-live-status-icon");
    this.liveStatusTextEl = this.liveStatusSection.createSpan("ai-wiki-live-status-text");
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add live-status DOM section in onOpen"
```

---

### Task 4: view.ts — setRunning(): show/clear Status, remove assistant resets

**Files:**
- Modify: `src/view.ts` — `setRunning()` method

- [ ] **Step 1: Remove assistant field resets from setRunning()**

Find and delete these lines in `setRunning()` (currently around lines 381–388):

```typescript
    this.assistantStarted = false;
    this.assistantBuffer = "";
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
```

- [ ] **Step 2: Add status show/clear after `this.stopWaiting();` in setRunning()**

After the line `this.stopWaiting();` in `setRunning()`, add:

```typescript
    this.liveStatusSection?.removeClass("ai-wiki-hidden");
    this.liveStatusIconEl?.setText("");
    this.liveStatusTextEl?.setText("");
```

- [ ] **Step 3: Verify no remaining references to removed fields in setRunning()**

```bash
grep -n "assistantStarted\|assistantBuffer\|assistantRenderHandle\|assistantFinalComp" src/view.ts
```

Expected: only references in other methods (appendEvent, finish, onClose) — not in setRunning. Zero output means all clean for this method.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): setRunning shows Status section, removes assistant streaming resets"
```

---

### Task 5: view.ts — appendEvent() tool_use: remove stale resets, add Status update

**Files:**
- Modify: `src/view.ts` — `tool_use` branch in `appendEvent()`

- [ ] **Step 1: Remove assistantBuffer/Handle resets from tool_use handler**

In the `tool_use` branch of `appendEvent()`, find and delete:

```typescript
      this.assistantBuffer = "";
      if (this.assistantRenderHandle !== null) {
        window.clearTimeout(this.assistantRenderHandle);
        this.assistantRenderHandle = null;
      }
```

(The `reasoningBlock = null`, `reasoningBuffer = ""`, and RAF cancel below these lines stay — reasoning still renders in Progress.)

- [ ] **Step 2: Add Status update after scrollSteps() in tool_use handler**

After `this.scrollSteps();` in the `tool_use` branch, add:

```typescript
      this.liveStatusIconEl?.setText("🔧");
      this.liveStatusTextEl?.setText(`${ev.name}  ${summariseInput(ev.input)}`);
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): tool_use updates Status section"
```

---

### Task 6: view.ts — appendEvent() assistant_text: remove streaming, add Status updates

**Files:**
- Modify: `src/view.ts` — `assistant_text` branch in `appendEvent()`

- [ ] **Step 1: Add Status update to isReasoning branch**

In the `if (ev.isReasoning)` branch, after the RAF scheduling block (the `if (!this.reasoningRafHandle)` block), add:

```typescript
        this.liveStatusIconEl?.setText("🧠");
        this.liveStatusTextEl?.setText("Analysing...");
```

- [ ] **Step 2: Replace the entire else-branch with a Status update**

Find and replace the `else` branch (currently the auto-collapse + streaming logic):

**Remove:**
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

**Replace with:**
```typescript
      } else {
        this.liveStatusIconEl?.setText("💬");
        this.liveStatusTextEl?.setText("Forming response...");
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): assistant_text updates Status instead of streaming to Result"
```

---

### Task 7: view.ts — startWaiting() + scheduleWaitingTick(): update Status

**Files:**
- Modify: `src/view.ts` — `startWaiting()` and `scheduleWaitingTick()`

- [ ] **Step 1: Add Status init to startWaiting()**

In `startWaiting()`, after `this.scheduleWaitingTick();`, add:

```typescript
    this.liveStatusIconEl?.setText("⏳");
    this.liveStatusTextEl?.setText("0.0s");
```

- [ ] **Step 2: Add Status tick update to scheduleWaitingTick()**

In `scheduleWaitingTick()`, after `if (span) span.setText(\`${s}s\`);`, add:

```typescript
      this.liveStatusTextEl?.setText(`${s}s`);
```

The full updated `scheduleWaitingTick()` body should look like:

```typescript
  private scheduleWaitingTick(): void {
    this.waitingTickHandle = window.setTimeout(() => {
      if (!this.waitingStep) return;
      const s = ((Date.now() - this.waitingStartedAt) / 1000).toFixed(1);
      const span = this.waitingStep.querySelector<HTMLElement>(".ai-wiki-waiting-text");
      if (span) span.setText(`${s}s`);
      this.liveStatusTextEl?.setText(`${s}s`);
      this.scheduleWaitingTick();
    }, 100);
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): startWaiting updates Status ticker"
```

---

### Task 8: view.ts — finish() + onClose(): hide Status, remove assistant cleanup

**Files:**
- Modify: `src/view.ts` — `finish()` and `onClose()`

- [ ] **Step 1: Add Status hide to finish()**

In `finish()`, after `this.updateMetrics();` (near the top of the method), add:

```typescript
    this.liveStatusSection?.addClass("ai-wiki-hidden");
```

- [ ] **Step 2: Remove assistant cleanup from finish()**

In `finish()`, find and delete:

```typescript
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
```

- [ ] **Step 3: Remove assistant cleanup from onClose(), add Status null-outs**

In `onClose()`, find and delete:

```typescript
    if (this.assistantRenderHandle !== null) {
      window.clearTimeout(this.assistantRenderHandle);
      this.assistantRenderHandle = null;
    }
    this.assistantFinalComp?.unload();
    this.assistantFinalComp = null;
```

After the `stopWaiting()` call in `onClose()`, add:

```typescript
    this.liveStatusSection = null;
    this.liveStatusIconEl = null;
    this.liveStatusTextEl = null;
```

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): finish hides Status; onClose nulls Status refs"
```

---

### Task 9: view.ts — delete scheduleAssistantRender()

**Files:**
- Modify: `src/view.ts` — remove the method entirely

- [ ] **Step 1: Delete scheduleAssistantRender()**

Remove the entire method (currently lines 893–907):

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

- [ ] **Step 2: Verify no remaining references to removed fields/method**

```bash
grep -n "assistantStarted\|assistantBuffer\|assistantRenderHandle\|assistantFinalComp\|scheduleAssistantRender" src/view.ts
```

Expected: no output. If any remain, fix them.

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): remove scheduleAssistantRender and all streaming fields"
```

---

### Task 10: Version bump + build + verify

**Files:**
- Modify: `package.json`, `src/manifest.json`
- Rebuild: `dist/main.js`, `dist/styles.css`

- [ ] **Step 1: Bump version 0.1.110 → 0.1.111 in package.json**

In `package.json`, change:
```json
"version": "0.1.110",
```
to:
```json
"version": "0.1.111",
```

- [ ] **Step 2: Bump version in src/manifest.json**

In `src/manifest.json`, change `"version": "0.1.110"` to `"version": "0.1.111"`.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: zero errors, `dist/main.js` and `dist/styles.css` updated.

- [ ] **Step 4: Commit**

```bash
git add package.json src/manifest.json dist/main.js dist/styles.css dist/manifest.json
git commit -m "chore: build v0.1.111"
```

- [ ] **Step 5: Manual verification in Obsidian**

Deploy: `ln -sf $(pwd)/dist ~/.config/obsidian/Plugins/obsidian-llm-wiki` (if not already symlinked).

Run **query** operation and verify:
1. Progress stays open — stepsEl visible throughout, no auto-collapse
2. Status bar appears below stepsEl during operation
3. Status updates: `🔧 <tool>` on tool_use → `⏳ 0.0s` (ticking) on waiting → `🧠 Analysing...` on reasoning → `💬 Forming response...` on non-reasoning assistant_text
4. Result section hidden during operation
5. After finish: Status hidden, Result shows final markdown, Chat section appears
6. **lint**: same behavior as query
7. **Cancel mid-operation**: Status hides, Progress stays as-is
