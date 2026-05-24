# Step Timing Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix progress steps in LlmWikiView so that `system`, `graph_stats`, and `reasoning` steps show an elapsed-time timestamp, and the waiting step no longer flashes "0.0s" before the first tick.

**Architecture:** Four minimal edits in `src/view.ts` — add `.ai-wiki-step-time` span with `this.elapsedShort()` to three non-tool step types, and change waiting step initial text from `"0.0s"` to `""`. No new methods, no new state.

**Tech Stack:** TypeScript, Obsidian API, esbuild

---

### Task 1: Fix `system` step — add time label

**Files:**
- Modify: `src/view.ts` (around line 648, in `appendEvent` → `ev.kind === "system"` branch)

Current code:
```typescript
} else if (ev.kind === "system") {
  const step = this.stepsEl.createDiv("ai-wiki-step");
  const head = step.createDiv("ai-wiki-step-head");
  head.createSpan({ cls: "ai-wiki-step-icon" }).setText("⚙");
  head.createSpan({ cls: "ai-wiki-step-name muted" }).setText(translateSystemEvent(ev.message));
  this.scrollSteps();
```

- [ ] **Step 1: Edit `src/view.ts` — add time span to `system` handler**

Add one line after `head.createSpan({ cls: "ai-wiki-step-name muted" })...`:

```typescript
} else if (ev.kind === "system") {
  const step = this.stepsEl.createDiv("ai-wiki-step");
  const head = step.createDiv("ai-wiki-step-head");
  head.createSpan({ cls: "ai-wiki-step-icon" }).setText("⚙");
  head.createSpan({ cls: "ai-wiki-step-name muted" }).setText(translateSystemEvent(ev.message));
  head.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
  this.scrollSteps();
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/main.js` updated.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts dist/main.js
git commit -m "fix(view): add elapsed time label to system steps"
```

---

### Task 2: Fix `graph_stats` step — add time label

**Files:**
- Modify: `src/view.ts` (around line 562, in `appendEvent` → `ev.kind === "graph_stats"` branch)

Current code:
```typescript
if (ev.kind === "graph_stats") {
  const cacheHint = ev.fromCache ? " (cache hit)" : "";
  const preview = ev.seeds.slice(0, 3).join(", ");
  const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
  const step = this.stepsEl.createDiv("ai-wiki-step");
  step.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
  step.createSpan({ cls: "ai-wiki-step-name" })
    .setText(`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`);
  this.scrollSteps();
  return;
}
```

- [ ] **Step 1: Edit `src/view.ts` — add time span to `graph_stats` handler**

Add one line after `step.createSpan({ cls: "ai-wiki-step-name" }).setText(...)`:

```typescript
if (ev.kind === "graph_stats") {
  const cacheHint = ev.fromCache ? " (cache hit)" : "";
  const preview = ev.seeds.slice(0, 3).join(", ");
  const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
  const step = this.stepsEl.createDiv("ai-wiki-step");
  step.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
  step.createSpan({ cls: "ai-wiki-step-name" })
    .setText(`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`);
  step.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
  this.scrollSteps();
  return;
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts dist/main.js
git commit -m "fix(view): add elapsed time label to graph_stats steps"
```

---

### Task 3: Fix `reasoning` block — add time label

**Files:**
- Modify: `src/view.ts` (around line 622, in `appendEvent` → `ev.kind === "assistant_text"` → `ev.isReasoning` branch)

Current code:
```typescript
if (!this.reasoningBlock) {
  this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
  const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
  rHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
  rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.analysing);
  this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
}
```

- [ ] **Step 1: Edit `src/view.ts` — add time span to reasoning block creation**

Add one line after `rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(...)`:

```typescript
if (!this.reasoningBlock) {
  this.reasoningBlock = this.stepsEl.createDiv("ai-wiki-step reasoning");
  const rHead = this.reasoningBlock.createDiv("ai-wiki-step-head");
  rHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🧠");
  rHead.createSpan({ cls: "ai-wiki-step-name muted" }).setText(i18n().view.analysing);
  rHead.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
  this.reasoningBlock.createSpan({ cls: "ai-wiki-reasoning-text" });
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/view.ts dist/main.js
git commit -m "fix(view): add elapsed time label to reasoning steps"
```

---

### Task 4: Fix waiting step — remove premature "0.0s"

**Files:**
- Modify: `src/view.ts` (around line 983, in `startWaiting()`)

Current code:
```typescript
private startWaiting(): void {
  this.stopWaiting();
  this.waitingStartedAt = Date.now();
  this.waitingStep = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step--waiting");
  this.waitingStep.createSpan({ cls: "ai-wiki-step-icon" }).setText("⏳");
  this.waitingStep.createSpan({ cls: "ai-wiki-waiting-text" }).setText("0.0s");
  this.scrollSteps();
  this.scheduleWaitingTick();
}
```

- [ ] **Step 1: Edit `src/view.ts` — change initial waiting text from `"0.0s"` to `""`**

```typescript
private startWaiting(): void {
  this.stopWaiting();
  this.waitingStartedAt = Date.now();
  this.waitingStep = this.stepsEl.createDiv("ai-wiki-step ai-wiki-step--waiting");
  this.waitingStep.createSpan({ cls: "ai-wiki-step-icon" }).setText("⏳");
  this.waitingStep.createSpan({ cls: "ai-wiki-waiting-text" }).setText("");
  this.scrollSteps();
  this.scheduleWaitingTick();
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass (no view.ts unit tests exist — this is a UI-only change).

- [ ] **Step 4: Commit**

```bash
git add src/view.ts dist/main.js
git commit -m "fix(view): remove premature 0.0s on waiting step creation"
```

---

### Task 5: Bump version and verify

**Files:**
- Modify: `package.json` (field `version`)
- Modify: `src/manifest.json` (field `version`)

- [ ] **Step 1: Read current version from `package.json`**

Check the `version` field, e.g. `"0.1.137"`.

- [ ] **Step 2: Increment patch**

`0.1.137` → `0.1.138`. Update both `package.json` and `src/manifest.json`.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: `dist/main.js` rebuilt, `dist/manifest.json` updated with new version.

- [ ] **Step 4: Manual smoke test**

Open Obsidian with the plugin. Run a query operation. Open Progress panel. Verify:
- `system` steps show `@Xs` time label
- `graph_stats` step shows `@Xs` time label
- `reasoning` step shows `@Xs` time label
- Waiting step (⏳) does not flash "0.0s" at creation
- Tool steps still show per-step duration (e.g. `1.3s`) after completion

- [ ] **Step 5: Commit**

```bash
git add package.json src/manifest.json dist/
git commit -m "chore: bump version to 0.1.138"
```
