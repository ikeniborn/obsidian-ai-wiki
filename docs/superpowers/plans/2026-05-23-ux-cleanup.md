---
review:
  plan_hash: 8e0cf4ee4851c7fd
  spec_hash: 2f5327e3900e63fe
  last_run: 2026-05-24
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
      section: "### Task 2: Remove query-save from types and agent-runner"
      section_hash: 391d90f215265211
      text: "Step 4 DoD contradictory: says 'Expected: 0 errors' but parenthetical acknowledges type errors from controller/view remain. Executor cannot determine if intermediate build should succeed or fail."
      verdict: fixed
      verdict_at: 2026-05-24
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "### Task 3: Remove query-save from main.ts and simplify QueryModal"
      section_hash: 6872b460316cf84a
      text: "Step 3 DoD incomplete: says 'remaining errors only in controller.ts and view.ts' but main.ts will also have TypeScript error — controller.query(q) called without required save:boolean param (not removed until Task 4)."
      verdict: fixed
      verdict_at: 2026-05-24
---

# UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three UX fixes — consent modal fires every switch, remove "Ask and save" button + query-save op entirely, auto-collapse Progress on finish.

**Architecture:** All changes are surgical: one condition removal in settings, one dead operation elimination across 7 files, three lines appended to `finish()`.

**Tech Stack:** TypeScript, Obsidian Plugin API, vitest

---

## File Map

| File | Change |
|------|--------|
| `src/settings.ts` | Remove `&& !this.localCache.shellConsentGiven` guard (line 217) |
| `src/types.ts` | Remove `\| "query-save"` from `WikiOperation` (line 7) |
| `src/main.ts` | Remove query-save command block (lines 82-85); simplify QueryModal call |
| `src/modals.ts` | QueryModal: remove `save` param, title always `T.modal.query` |
| `src/controller.ts` | `query()`: remove `save` param; purge all `query-save` branches |
| `src/agent-runner.ts` | Remove `query-save→query` remap and `case "query-save"` |
| `src/view.ts` | Remove `askSaveBtn`; remove `"query-save"` from CHAT_OPS; collapse progress in `finish()` |
| `src/i18n.ts` | Remove `querySave` key from all 3 locales |
| `tests/controller-cache-invalidation.test.ts` | Replace `"query-save"` with `"query"` at line 150 |
| `tests/main-mobile.test.ts` | Remove `"query-save"` from expected command lists at lines 98, 107 |

---

### Task 1: Fix consent modal — fires on every native→claude-agent switch

**Files:**
- Modify: `src/settings.ts:217`

- [ ] **Step 1: Run tests to establish baseline**

```bash
npm test 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 2: Make the one-line change**

In `src/settings.ts` line 217, change:
```typescript
if (v === "claude-agent" && !this.localCache.shellConsentGiven) {
```
to:
```typescript
if (v === "claude-agent") {
```

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "fix(settings): show ShellConsentModal on every native→claude-agent switch"
```

---

### Task 2: Remove query-save from types and agent-runner

**Files:**
- Modify: `src/types.ts:7`
- Modify: `src/agent-runner.ts:27,80-82`

- [ ] **Step 1: Remove `"query-save"` from WikiOperation union in `src/types.ts`**

Line 7 currently: `| "query-save"`  
Delete that line entirely. The union becomes:
```typescript
export type WikiOperation =
  | "ingest"
  | "query"
  | "lint"
  | "lint-chat"
  | "chat"
  | "init"
  | "format";
```
(exact surrounding lines may vary — remove only the `| "query-save"` line)

- [ ] **Step 2: Remove remap in `src/agent-runner.ts` line 27**

Change:
```typescript
const key = (op === "query-save" ? "query" : op === "chat" || op === "lint-chat" ? "lint" : op) as OpKey;
```
to:
```typescript
const key = (op === "chat" || op === "lint-chat" ? "lint" : op) as OpKey;
```

- [ ] **Step 3: Remove `case "query-save"` block in `src/agent-runner.ts` (~lines 80-82)**

Delete:
```typescript
      case "query-save":
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore);
        break;
```

- [ ] **Step 4: Run build to check for type errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```
Expected: errors in controller.ts, main.ts, view.ts, modals.ts (fixed in Tasks 3–5).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agent-runner.ts
git commit -m "refactor: remove query-save from WikiOperation type and agent-runner"
```

---

### Task 3: Remove query-save from main.ts and simplify QueryModal

**Files:**
- Modify: `src/main.ts:78,82-85`
- Modify: `src/modals.ts:50-58`

- [ ] **Step 1: Remove query-save addCommand block from `src/main.ts`**

Delete lines 82-85 (the entire query-save command registration):
```typescript
      id: "query-save",
      name: T.cmd.querySave,
      callback: () => new QueryModal(this.app, true, (q) => void this.controller.query(q, true)).open(),
```
and its surrounding `this.addCommand({...})` wrapper.

Also update the query command on line 78 — drop the `false` argument from QueryModal:
```typescript
callback: () => new QueryModal(this.app, (q) => void this.controller.query(q)).open(),
```

- [ ] **Step 2: Simplify QueryModal in `src/modals.ts`**

Current constructor (line 50):
```typescript
constructor(app: App, private save: boolean, private onSubmit: (q: string) => void) {
```

New constructor:
```typescript
constructor(app: App, private onSubmit: (q: string) => void) {
```

In `onOpen()`, title line currently:
```typescript
contentEl.createEl("h3", { text: this.save ? T.queryAndSave : T.query });
```

Replace with:
```typescript
contentEl.createEl("h3", { text: T.query });
```

Remove the `private save: boolean` field entirely.

- [ ] **Step 3: Run build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```
Expected: remaining errors in controller.ts, main.ts, and view.ts (fixed in Tasks 4–5).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/modals.ts
git commit -m "refactor: remove query-save command and simplify QueryModal"
```

---

### Task 4: Remove query-save from controller.ts

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Simplify `query()` method (~line 196)**

Current:
```typescript
async query(question: string, save: boolean, domainId?: string): Promise<void> {
  if (!question.trim()) return;
  const op: WikiOperation = save ? "query-save" : "query";
  await this.dispatch(op, [question.trim()], domainId);
}
```

New:
```typescript
async query(question: string, domainId?: string): Promise<void> {
  if (!question.trim()) return;
  await this.dispatch("query", [question.trim()], domainId);
}
```

- [ ] **Step 2: Remove `"query-save"` from mobile check (~line 219)**

Change:
```typescript
if (Platform.isMobile && operation !== "query" && operation !== "query-save") {
```
to:
```typescript
if (Platform.isMobile && operation !== "query") {
```

- [ ] **Step 3: Remove query-save description entry (~line 271)**

Find and delete the line:
```typescript
"query-save": "Ответ на запрос с сохранением (query-save)",
```

- [ ] **Step 4: Remove `query-save→query` remap (~line 475)**

Change:
```typescript
: opKey === "query-save" ? "query"
```
Remove this ternary branch entirely. Adjust surrounding expression accordingly.

- [ ] **Step 5: Remove `"query-save"` from mobile op check (~line 573)**

Change:
```typescript
if (Platform.isMobile && op !== "query" && op !== "query-save" && op !== "format") {
```
to:
```typescript
if (Platform.isMobile && op !== "query" && op !== "format") {
```

- [ ] **Step 6: Remove query-save from opKey computations (~lines 588, 602)**

Line 588 change:
```typescript
const opKey = (op === "query-save" ? "query" : op === "lint-chat" ? "lint" : op) as import("./types").OpKey;
```
to:
```typescript
const opKey = (op === "lint-chat" ? "lint" : op) as import("./types").OpKey;
```

Line 602 (same pattern):
```typescript
const opKey = op === "query-save" ? "query" : op === "lint-chat" ? "lint" : op;
```
to:
```typescript
const opKey = op === "lint-chat" ? "lint" : op;
```

- [ ] **Step 7: Remove `"query-save"` from mutatesWiki check (~line 687)**

Change:
```typescript
const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "query-save" || op === "init";
```
to:
```typescript
const mutatesWiki = op === "ingest" || op === "lint" || op === "lint-chat" || op === "init";
```

- [ ] **Step 8: Remove auto-open block (~lines 713-719)**

Delete the entire block:
```typescript
    if (op === "query-save" && status === "done" && !Platform.isMobile) {
      const m = finalText.match(/Создана\s+страница:\s*([^\s`'"]+)/i);
      if (m) {
        const pathInVault = toVaultPath(vaultRoot, m[1]);
        if (pathInVault) await this.app.workspace.openLinkText(pathInVault, "");
      }
    }
```

- [ ] **Step 9: Run build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```
Expected: remaining errors only in view.ts.

- [ ] **Step 10: Commit**

```bash
git add src/controller.ts
git commit -m "refactor: remove query-save from controller"
```

---

### Task 5: Remove query-save from view.ts

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Remove `askSaveBtn` field declaration (~line 46)**

Delete:
```typescript
  private askSaveBtn!: HTMLButtonElement;
```

- [ ] **Step 2: Remove askSaveBtn creation and event (~lines 143-147)**

Delete these two lines:
```typescript
    this.askSaveBtn = askRow.createEl("button", { text: T.view.askAndSave });
```
and:
```typescript
    this.askSaveBtn.addEventListener("click", () => this.submitQuery(true));
```

- [ ] **Step 3: Remove `save` param from `submitQuery` and its callers (~line 444)**

Current `submitQuery`:
```typescript
private submitQuery(save: boolean): void {
  const q = this.queryInput.value.trim();
  if (!q) { new Notice(i18n().view.enterQuestion); return; }
  if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
  void this.plugin.controller.query(q, save, this.domainSelect?.value || undefined);
  this.queryInput.value = "";
}
```

New:
```typescript
private submitQuery(): void {
  const q = this.queryInput.value.trim();
  if (!q) { new Notice(i18n().view.enterQuestion); return; }
  if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
  void this.plugin.controller.query(q, this.domainSelect?.value || undefined);
  this.queryInput.value = "";
}
```

Also update the `askBtn` event listener (line 146) from:
```typescript
    this.askBtn.addEventListener("click", () => this.submitQuery(false));
```
to:
```typescript
    this.askBtn.addEventListener("click", () => this.submitQuery());
```

- [ ] **Step 4: Remove `askSaveBtn.disabled` lines in `setRunning` and `finish`**

In `setRunning` (~line 459), delete:
```typescript
    this.askSaveBtn.disabled = true;
```

In `finish` (~line 739), delete:
```typescript
    this.askSaveBtn.disabled = false;
```

- [ ] **Step 5: Remove `"query-save"` from CHAT_OPS (~line 763)**

Change:
```typescript
const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query", "query-save"];
```
to:
```typescript
const CHAT_OPS: WikiOperation[] = ["lint", "lint-chat", "ingest", "query"];
```

- [ ] **Step 6: Run build — should be clean**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "refactor: remove askSaveBtn and query-save from view"
```

---

### Task 6: Remove querySave from i18n.ts

**Files:**
- Modify: `src/i18n.ts:155,378,599`

- [ ] **Step 1: Delete `querySave` key from all three locales**

Delete line 155 (English):
```typescript
    querySave: "Query and save as page",
```

Delete line 378 (Russian):
```typescript
    querySave: "Запрос и сохранить как страницу",
```

Delete line 599 (Spanish):
```typescript
    querySave: "Consulta y guardar como página",
```

Also check if `T.view.askAndSave` key is defined in i18n and delete it if so:
```bash
grep -n "askAndSave\|askAndSave" src/i18n.ts
```

- [ ] **Step 2: Run build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```
Expected: 0 errors.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -30
```
Expected: failures in controller-cache-invalidation.test.ts and main-mobile.test.ts (fixed next task).

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts
git commit -m "refactor: remove querySave i18n keys"
```

---

### Task 7: Fix tests

**Files:**
- Modify: `tests/controller-cache-invalidation.test.ts:150-154`
- Modify: `tests/main-mobile.test.ts:98,102,107`

- [ ] **Step 1: Fix controller-cache-invalidation.test.ts**

At line 150, change the test description and operation:
```typescript
it("invalidates graphCache for query-save with domainId", async () => {
  // ...
  await priv.dispatch("query-save", ["what is AI?"], "ai");
```
to:
```typescript
it("invalidates graphCache for query with domainId", async () => {
  // ...
  await priv.dispatch("query", ["what is AI?"], "ai");
```

- [ ] **Step 2: Fix main-mobile.test.ts**

Line 98 — remove `"query-save"` from array:
```typescript
      expect.arrayContaining(["open-panel", "ingest-current", "query", "lint", "init", "cancel"]),
```

Line 102 — update test description:
```typescript
  it("mobile: registers only query/open-panel/cancel", async () => {
```

Line 107 — remove `"query-save"` from array:
```typescript
      expect.arrayContaining(["open-panel", "query", "cancel"]),
```

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/controller-cache-invalidation.test.ts tests/main-mobile.test.ts
git commit -m "test: remove query-save from test expectations"
```

---

### Task 8: Auto-collapse Progress on finish

**Files:**
- Modify: `src/view.ts` — `finish()` method (~line 775, after `renderHistory()`)

- [ ] **Step 1: Write a failing test** (if test file for view exists — otherwise skip and note)

```bash
grep -rl "finish\|LlmWikiView" tests/ | head -5
```

If view tests exist, add:
```typescript
it("collapses progress section after finish", async () => {
  // Arrange: view in running state (stepsOpen = true, stepsEl visible)
  view.setRunning("query", ["test"]);
  expect(view["stepsOpen"]).toBe(true);
  expect(view["stepsEl"].hasClass("ai-wiki-hidden")).toBe(false);

  // Act
  await view.finish(mockEntry);

  // Assert
  expect(view["stepsOpen"]).toBe(false);
  expect(view["stepsEl"].hasClass("ai-wiki-hidden")).toBe(true);
  expect(view["progressToggle"].getText()).toBe("▶");
});
```

If no view unit tests exist, skip test step — verify manually.

- [ ] **Step 2: Add collapse logic to `finish()` in `src/view.ts`**

In `finish()`, after the `this.renderHistory()` call (last line of method), append:
```typescript
    this.stepsOpen = false;
    this.stepsEl.addClass("ai-wiki-hidden");
    this.progressToggle.setText("▶");
```

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Run build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): auto-collapse Progress section on operation finish"
```

---

## Self-Review

**Spec coverage:**
- Task 29 (consent every switch) → Task 1 ✓
- Task 30+ (remove query-save) → Tasks 2-7 ✓
- Task 31 (collapse on finish) → Task 8 ✓
- Tests to update (spec section) → Task 7 ✓
- Invariant (keep `save` param in `runQuery` phase function) → NOT touched ✓

**Placeholder scan:** No TBD, no "add validation", no "similar to" — all steps have exact code.

**Type consistency:** `controller.query(q, domainId?)` used consistently in Tasks 4, 5. `submitQuery()` no-arg consistent in Task 5.
