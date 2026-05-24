---
review:
  spec_hash: 92dc15133d0d32dd
  last_run: "2026-05-18"
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  section_hashes:
    scope:    5abe90a3dfbe9981
    fix1:     b32cffa6ba49290a
    fix2:     0c75979f1eb6d5b6
    fix3:     e931cdbaef61eb4c
    fix4:     1a30bf86ad87465f
    fix5:     4b3cc2e9a6aed529
    fix5a:    d229764dc84fcf50
    fix5b:    c0985c22b92470cf
    affected: be0db87b0be57412
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Fix 3"
      section_hash: e931cdbaef61eb4c
      text: "Русская строка для i18n-ключа `selectDomainFirst` не указана — только «Russian + English», без самого текста"
      verdict: fixed
      verdict_at: "2026-05-18"
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "Fix 5b"
      section_hash: c0985c22b92470cf
      text: "Поведение индикатора ожидания для события `reasoning` не определено (в 5a упоминается, в 5b — нет)"
      verdict: fixed
      verdict_at: "2026-05-18"
    - id: F-003
      phase: clarity
      severity: INFO
      section: "Fix 4"
      section_hash: 1a30bf86ad87465f
      text: "Кнопка копирования добавляется в `addChatBubble()` для всех сообщений (user + assistant) — намеренно?"
      verdict: fixed
      verdict_at: "2026-05-18"
    - id: F-004
      phase: clarity
      severity: INFO
      section: "Fix 2"
      section_hash: 0c75979f1eb6d5b6
      text: "Терминология: «dead link» (без дефиса) в заголовке vs «dead-link» (с дефисом) в тексте и scope"
      verdict: fixed
      verdict_at: "2026-05-18"
---
# Design: Lint UX Fixes

Date: 2026-05-18  
Status: approved

## Scope

Five independent fixes to lint operation and view layer:
1. Lint writes to `_log.md`
2. Deduplicate dead-link reports
3. Fix "lint-chat requires a domain" error
4. Copy-to-clipboard button on chat messages
5. Progress panel: remove LLM text truncation + add waiting indicator

---

## Fix 1 — Lint appends to `_log.md`

**File:** `src/phases/lint.ts`

Add `appendLintLog()` at the end of `runLint`, called once per domain after `writtenPaths` is computed:

```typescript
async function appendLintLog(
  vaultTools: VaultTools,
  wikiRoot: string,
  domainId: string,
  fixedCount: number,
): Promise<void> {
  const logPath = `${wikiRoot}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — lint — ${domainId}\n- Исправлено страниц: ${fixedCount}\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* non-critical */ }
}
```

Add `tryRead` (mirrors ingest.ts pattern):
```typescript
async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}
```

Call site in `runLint` — after `writtenPaths` is finalized, before moving to next domain:
```typescript
await appendLintLog(vaultTools, wikiVaultPath, domain.id, writtenPaths.length);
```

---

## Fix 2 — Deduplicate dead-links in `checkStructure`

**File:** `src/phases/lint.ts`

Current code reports one issue per occurrence of `[[X]]` in a file. Same link appearing twice → two identical issue lines.

Fix: deduplicate links per file using `new Set`:

```typescript
// before:
const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);

// after:
const links = [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))];
```

This reports each `(file, dead-link)` pair at most once.

---

## Fix 3 — lint-chat domain fallback

**File:** `src/view.ts`

When lint runs on "all domains", `lastContext.domainId` is `undefined`. The existing `domainSelect` at the top of the view holds a user-selected domain.

In the chat `submit()` closure inside `showChatSection()`, resolve domain before dispatching:

```typescript
// existing:
const ctx = this.lastContext;
if (ctx.operation === "lint" || ctx.operation === "lint-chat") {
  void this.plugin.controller.lintApplyFromChat(
    ctx.domainId,
    ctx.report,
    this.chatHistory,
    text,
  );
}

// becomes:
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

**i18n:** Add `selectDomainFirst` key to `i18n.ts`:
- Russian: `"Выберите домен"`
- English: `"Select a domain first"`

---

## Fix 4 — Copy button on chat messages

**File:** `src/view.ts`

In `addChatBubble()`, after the message content is rendered, append a copy button. Applies to both user and assistant bubbles (intentional — user messages are also useful to copy).

```typescript
const copyBtn = el.createEl("button", { cls: "ai-wiki-copy-btn", attr: { "aria-label": "Copy" } });
setIcon(copyBtn, "copy");
copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(text);
  setIcon(copyBtn, "check");
  window.setTimeout(() => setIcon(copyBtn, "copy"), 1500);
});
```

**CSS** (styles.css):
```css
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

---

## Fix 5 — Progress panel: remove text truncation + waiting indicator

**File:** `src/view.ts`

### 5a. Remove ASSISTANT_TEXT_MAX

Delete the constant `ASSISTANT_TEXT_MAX = 600`. In the `assistant_text` branch of `appendEvent()`, remove `truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX)` — use `this.assistantBuffer` directly.

Same for `reasoningBuffer` / reasoning block.

`PREVIEW_INLINE = 140` (for tool_result preview) is kept unchanged.

### 5b. Waiting indicator

New field: `private waitingStep: HTMLElement | null = null` and `private waitingTickHandle: ReturnType<typeof window.setTimeout> | null = null` and `private waitingStartedAt = 0`.

Logic in `appendEvent()`:

- On `tool_result`: call `this.startWaiting()`
- On `tool_use`, `assistant_text`, or `reasoning`: call `this.stopWaiting()`
- On `result` / `error`: call `this.stopWaiting()`

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

`stopWaiting()` also called in `setRunning()` (reset on new operation) and `onClose()`.

---

## Affected files

| File | Changes |
|---|---|
| `src/phases/lint.ts` | Fix 1 (appendLintLog), Fix 2 (dedup links) |
| `src/view.ts` | Fix 3 (domain fallback), Fix 4 (copy btn), Fix 5 (truncation + waiting) |
| `src/i18n.ts` | Fix 3 (selectDomainFirst key) |
| `styles.css` | Fix 4 (copy btn CSS) |

No changes to `controller.ts`, `agent-runner.ts`, or phase files other than `lint.ts`.
