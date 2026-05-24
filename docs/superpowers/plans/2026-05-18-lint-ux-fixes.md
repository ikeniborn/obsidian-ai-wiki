---
review:
  plan_hash: 5d657906be4ec6bf
  spec_hash: 92dc15133d0d32dd
  last_run: "2026-05-18"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    file_map:    8f44025d5b9dbc86
    task1:       d4d0fcc0e333d999
    task2:       5e2d01ad0e72eb95
    task3:       8b541ce9fe775384
    task4:       e5242f761e143446
    task5a:      8d705be929e087f9
    task5b:      8ed164782c0bfd39
    self_review: 2a7f8e7aff6d91d1
  findings: []
---
# Lint UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent lint/view fixes: _log.md append, dead-link dedup, lint-chat domain fallback, copy button, progress panel improvements.

**Architecture:** All changes are isolated — two source files (`lint.ts`, `view.ts`), one i18n file, one CSS file. No new modules needed. Fix 5b adds three private fields and three private methods to `LlmWikiView`; all other fixes are in-place edits.

**Tech Stack:** TypeScript, Obsidian API (`setIcon`, `Notice`, `navigator.clipboard`), Vitest for tests.

---

## File Map

| File | Task(s) |
|---|---|
| `src/phases/lint.ts` | Task 1 (appendLintLog), Task 2 (dedup links) |
| `src/view.ts` | Task 3 (domain fallback), Task 4 (copy btn), Task 5a (remove truncation), Task 5b (waiting indicator) |
| `src/i18n.ts` | Task 3 (selectDomainFirst) |
| `src/styles.css` | Task 4 (copy btn CSS) |
| `tests/phases/lint.test.ts` | Tasks 1, 2 |

---

## Task 1: Fix 1 — Lint appends to `_log.md`

**Files:**
- Modify: `src/phases/lint.ts:18-220`
- Test: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/phases/lint.test.ts` inside `describe("runLint", ...)`:

```typescript
it("appends lint entry to _log.md after fix pass", async () => {
  let logContent = "";
  const adapter = mockAdapter({
    list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockImplementation((path: string) => {
      if (path === "!Wiki/work/_log.md") return Promise.resolve(logContent);
      return Promise.resolve("---\nwiki_status: stub\n---\n# Page");
    }),
    write: vi.fn().mockImplementation((path: string, content: string) => {
      if (path === "!Wiki/work/_log.md") logContent = content;
      return Promise.resolve();
    }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  await collect(
    runLint(["work"], vt, makeLlm("No issues."), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  expect(logContent).toContain("## ");
  expect(logContent).toContain("lint");
  expect(logContent).toContain("work");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `_log.md` is never written.

- [ ] **Step 3: Add `tryRead` and `appendLintLog` to `src/phases/lint.ts`**

Insert after the `META_FILES` constant (after line 18) and before `runLint`:

```typescript
async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

async function appendLintLog(
  vaultTools: VaultTools,
  wikiVaultPath: string,
  domainId: string,
  fixedCount: number,
): Promise<void> {
  const logPath = `${wikiVaultPath}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — lint — ${domainId}\n- Исправлено страниц: ${fixedCount}\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* non-critical */ }
}
```

- [ ] **Step 4: Call `appendLintLog` in `runLint` after `writtenPaths` block**

In `src/phases/lint.ts`, after the `if (writtenPaths.length > 0)` block (around line 172-178), insert:

```typescript
await appendLintLog(vaultTools, wikiVaultPath, domain.id, writtenPaths.length);
```

The surrounding context should look like:

```typescript
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
      for (const p of writtenPaths) {
        try {
          pages.set(p, await vaultTools.read(p));
        } catch { /* non-critical */ }
      }
    }

    await appendLintLog(vaultTools, wikiVaultPath, domain.id, writtenPaths.length);

    const backlinks = new Map<string, Set<string>>();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): append run entry to _log.md after each domain fix pass"
```

---

## Task 2: Fix 2 — Deduplicate dead-link reports in `checkStructure`

**Files:**
- Modify: `src/phases/lint.ts:222-235`
- Test: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/phases/lint.test.ts`, after the imports (since `checkStructure` is exported):

```typescript
import { checkStructure } from "../../src/phases/lint";
```

Add a new `describe` block after the existing one:

```typescript
describe("checkStructure", () => {
  it("reports each dead link at most once per file even when repeated", () => {
    const pages = new Map([
      ["wiki/A.md", "---\n---\n# A\n\n[[Missing]] and [[Missing]] again."],
    ]);
    const result = checkStructure(pages);
    const matches = result.match(/dead link \[\[Missing\]\]/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — two "dead link [[Missing]]" entries reported.

- [ ] **Step 3: Apply dedup fix in `checkStructure`**

In `src/phases/lint.ts`, line 228, replace:

```typescript
    const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
```

with:

```typescript
    const links = [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))];
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "fix(lint): deduplicate dead-link reports per file in checkStructure"
```

---

## Task 3: Fix 3 — lint-chat domain fallback + i18n key

**Files:**
- Modify: `src/view.ts:694-717` (submit closure inside `showChatSection`)
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add `selectDomainFirst` key to `src/i18n.ts`**

In `src/i18n.ts`, in the `en.view` object (around line 133, after `initialising`):

```typescript
    initialising: "Initialising",
    selectDomainFirst: "Select a domain first",
```

In `ru.view` (around line 346, after `initialising`):

```typescript
    initialising: "Инициализация",
    selectDomainFirst: "Выберите домен",
```

In `es.view` (around line 558, after `initialising`):

```typescript
    initialising: "Inicializando",
    selectDomainFirst: "Selecciona un dominio primero",
```

Also update the `type I18n = typeof en` check — TypeScript will catch any mismatch at build time.

- [ ] **Step 2: Run build to check types**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds (es and ru implement the new key or TypeScript will error).

- [ ] **Step 3: Fix lint-chat submit in `src/view.ts`**

In `src/view.ts`, replace the lint branch in `submit` (lines 700-707):

```typescript
      if (ctx.operation === "lint" || ctx.operation === "lint-chat") {
        void this.plugin.controller.lintApplyFromChat(
          ctx.domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      }
```

with:

```typescript
      if (ctx.operation === "lint" || ctx.operation === "lint-chat") {
        const domainId = ctx.domainId ?? this.domainSelect?.value || undefined;
        if (!domainId) {
          new Notice(i18n().view.selectDomainFirst ?? "Select a domain first");
          return;
        }
        void this.plugin.controller.lintApplyFromChat(
          domainId,
          ctx.report,
          this.chatHistory,
          text,
        );
      }
```

- [ ] **Step 4: Run build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts src/i18n.ts
git commit -m "fix(view): resolve domain from domainSelect when lint-chat context has no domainId"
```

---

## Task 4: Fix 4 — Copy-to-clipboard button on chat messages

**Files:**
- Modify: `src/view.ts:721-733` (`addChatBubble`)
- Modify: `src/styles.css`

- [ ] **Step 1: Add CSS for copy button to `src/styles.css`**

Append at the end of `src/styles.css`:

```css
/* Copy button on chat messages */
.ai-wiki-chat-msg {
  position: relative;
}
.ai-wiki-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
}
.ai-wiki-chat-msg:hover .ai-wiki-copy-btn {
  opacity: 1;
}
```

Note: the existing `.ai-wiki-chat-msg` rule on line 70 adds padding/border-radius — the new rule only adds `position: relative`, so both apply without conflict.

- [ ] **Step 2: Add copy button in `addChatBubble` in `src/view.ts`**

In `src/view.ts`, `addChatBubble` ends with `el.scrollIntoView(...)` and `return el`. Add the copy button block before `el.scrollIntoView`:

```typescript
  private addChatBubble(role: "user" | "assistant", text: string): HTMLElement {
    const el = this.chatMessagesEl!.createDiv(`ai-wiki-chat-msg ai-wiki-chat-msg--${role}`);
    if (role === "user") {
      el.setText(text);
    } else {
      const comp = new Component();
      comp.load();
      void MarkdownRenderer.render(this.app, text, el, "", comp).then(() => sanitizeLinks(el));
      registerLinkHandler(el, this.app);
    }
    const copyBtn = el.createEl("button", { cls: "ai-wiki-copy-btn", attr: { "aria-label": "Copy" } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(text);
      setIcon(copyBtn, "check");
      window.setTimeout(() => setIcon(copyBtn, "copy"), 1500);
    });
    el.scrollIntoView({ block: "end" });
    return el;
  }
```

- [ ] **Step 3: Run build to verify no errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts src/styles.css
git commit -m "feat(view): add copy-to-clipboard button on chat message bubbles"
```

---

## Task 5a: Fix 5a — Remove LLM text truncation from progress panel

**Files:**
- Modify: `src/view.ts:39, 527, 543`

- [ ] **Step 1: Delete `ASSISTANT_TEXT_MAX` constant**

In `src/view.ts`, line 39, delete:

```typescript
const ASSISTANT_TEXT_MAX = 600;
```

(Keep `PREVIEW_INLINE = 140` on line 38 — it is used for `tool_result` previews and must stay.)

- [ ] **Step 2: Remove truncation from reasoning RAF callback**

In `src/view.ts`, inside the `ev.isReasoning` branch RAF callback (around line 527), replace:

```typescript
            if (span) span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
```

with:

```typescript
            if (span) span.setText(this.reasoningBuffer);
```

- [ ] **Step 3: Remove truncation from assistant RAF callback**

In `src/view.ts`, inside the assistant branch RAF callback (around line 543), replace:

```typescript
            if (span) span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
```

with:

```typescript
            if (span) span.setText(this.assistantBuffer);
```

- [ ] **Step 4: Run build to verify no errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds. TypeScript will error if `ASSISTANT_TEXT_MAX` is still referenced somewhere — fix any remaining use.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "fix(view): remove ASSISTANT_TEXT_MAX truncation from progress panel text"
```

---

## Task 5b: Fix 5b — Waiting indicator in progress panel

**Files:**
- Modify: `src/view.ts` — class fields, `appendEvent`, `setRunning`, `onClose`, new private methods

- [ ] **Step 1: Add three new private fields to `LlmWikiView`**

In `src/view.ts`, after the existing private fields (around line 100, after `private reasoningRafHandle`), add:

```typescript
  private waitingStep: HTMLElement | null = null;
  private waitingTickHandle: ReturnType<typeof window.setTimeout> | null = null;
  private waitingStartedAt = 0;
```

- [ ] **Step 2: Add three private methods to `LlmWikiView`**

Add after the `scrollSteps()` method (around line 861):

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

  private stopWaiting(): void {
    if (this.waitingTickHandle !== null) {
      window.clearTimeout(this.waitingTickHandle);
      this.waitingTickHandle = null;
    }
    this.waitingStep?.remove();
    this.waitingStep = null;
  }

  private scheduleWaitingTick(): void {
    this.waitingTickHandle = window.setTimeout(() => {
      if (!this.waitingStep) return;
      const s = ((Date.now() - this.waitingStartedAt) / 1000).toFixed(1);
      const span = this.waitingStep.querySelector<HTMLElement>(".ai-wiki-waiting-text");
      if (span) span.setText(`${s}s`);
      this.scheduleWaitingTick();
    }, 100);
  }
```

- [ ] **Step 3: Wire `startWaiting` / `stopWaiting` into `appendEvent`**

In `appendEvent`, in the `tool_result` branch (around line 494), after `this.currentToolStep = null;` add:

```typescript
      this.startWaiting();
```

So the end of the `tool_result` block becomes:

```typescript
      if (step) {
        const head = step.querySelector(".ai-wiki-step-head");
        head?.addClass(ev.ok ? "ok" : "err");
        const dur = ((Date.now() - this.currentToolStartedAt) / 1000).toFixed(1);
        const t = step.querySelector(".ai-wiki-step-time");
        if (t) t.setText(`${dur}s`);
        if (ev.preview) {
          const p = step.createDiv("ai-wiki-step-preview");
          p.setText(truncate(ev.preview.replace(/\s+/g, " "), PREVIEW_INLINE));
        }
        this.currentToolStep = null;
      }
      this.startWaiting();
```

In the `tool_use` branch (around line 470), at the start of the block, add `this.stopWaiting()`:

```typescript
    if (ev.kind === "tool_use") {
      this.stopWaiting();
      this.toolCount++;
      // ... rest unchanged
```

In the `assistant_text` branch (around line 512), add `this.stopWaiting()` at the start:

```typescript
    } else if (ev.kind === "assistant_text") {
      this.stopWaiting();
      if (ev.isReasoning) {
```

In the `result` branch (around line 556), add `this.stopWaiting()`:

```typescript
    } else if (ev.kind === "result") {
      this.stopWaiting();
      this.assistantBlock = null;
```

In the `error` branch (around line 553), add `this.stopWaiting()`:

```typescript
    } else if (ev.kind === "error") {
      this.stopWaiting();
      this.stepsEl.createDiv("ai-wiki-step err").setText(`✗ ${ev.message}`);
```

- [ ] **Step 4: Call `stopWaiting` in `setRunning` and `onClose`**

In `setRunning` (around line 342), before or alongside the existing `this.mobileWaitingEl = null` reset, add:

```typescript
    this.stopWaiting();
```

Place it after `this.tickHandle` cleanup:

```typescript
    if (this.tickHandle !== null) { window.clearTimeout(this.tickHandle); this.tickHandle = null; }
    this.stopWaiting();
    this.scheduleMetricsTick();
```

In `onClose` (around line 191), add `this.stopWaiting()` alongside the other cleanup:

```typescript
  onClose(): void {
    if (this.tickHandle !== null) window.clearTimeout(this.tickHandle);
    if (this.chatTickHandle !== null) window.clearTimeout(this.chatTickHandle);
    this.stopWaiting();
    // ... rest unchanged
```

- [ ] **Step 5: Run build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): add waiting indicator between tool_result and next LLM event"
```

---

## Self-Review: Spec Coverage

| Spec section | Task | Status |
|---|---|---|
| Fix 1 — `_log.md` append | Task 1 | covered |
| Fix 2 — dedup dead links | Task 2 | covered |
| Fix 3 — lint-chat domain fallback + i18n `selectDomainFirst` | Task 3 | covered |
| Fix 4 — copy button (user + assistant, hover-reveal CSS) | Task 4 | covered |
| Fix 5a — remove `ASSISTANT_TEXT_MAX` truncation (assistant + reasoning) | Task 5a | covered |
| Fix 5b — `startWaiting` on `tool_result`, `stopWaiting` on `tool_use`/`assistant_text`/`reasoning`/`result`/`error`, reset in `setRunning`/`onClose` | Task 5b | covered |

All `PREVIEW_INLINE = 140` (tool_result preview) preserved — not touched.
