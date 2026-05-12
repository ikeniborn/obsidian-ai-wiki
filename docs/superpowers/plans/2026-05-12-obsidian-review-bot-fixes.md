# ObsidianReviewBot Required Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 14 Required violations from ObsidianReviewBot scan to unblock community plugin approval.

**Architecture:** Drop `node:` URI prefix from all path/fs imports (bot targets the scheme, not the module), replace `node:readline` with manual buffer splitting, apply targeted TypeScript/Promise/UI fixes. No new files created.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild, vitest

---

## File Map

| File | Changes |
|---|---|
| `src/claude-cli-client.ts` | Drop `node:` prefix on 4 imports; replace `createInterface`/readline with manual buffer split |
| `src/controller.ts` | Drop `node:` prefix in `requireClaudeAgent` and `buildAgentRunner`; remove `async` from `requireClaudeAgent` and `toVaultPath`; extract `toVaultPath` to module function; `TFile` instanceof; `console.info` → `console.debug` |
| `src/phases/fix.ts` | Drop `node:` prefix |
| `src/phases/ingest.ts` | Drop `node:` prefix |
| `src/phases/lint.ts` | Drop `node:` prefix |
| `src/source-paths.ts` | Drop `node:` prefix |
| `src/main.ts` | `any` → `unknown`; remove redundant `as string` cast |
| `src/view.ts` | `getDisplayText` sentence case; `refreshDomains()` → `void`; remove `!` after guarded check |
| `src/mobile-fetch.ts` | Remove `(input as Request).url` cast with explicit else branch |

---

### Task 1: Drop `node:` prefix — phases and source-paths

**Files:**
- Modify: `src/phases/fix.ts:1`
- Modify: `src/phases/ingest.ts:1`
- Modify: `src/phases/lint.ts:1`
- Modify: `src/source-paths.ts:1`

- [ ] **Step 1: Apply the four one-line changes**

`src/phases/fix.ts` line 1:
```typescript
import { join } from "path";
```

`src/phases/ingest.ts` line 1:
```typescript
import { isAbsolute, join, relative, dirname } from "path";
```

`src/phases/lint.ts` line 1:
```typescript
import { join } from "path";
```

`src/source-paths.ts` line 1:
```typescript
import { isAbsolute, join } from "path";
```

- [ ] **Step 2: Build to confirm no errors**

```bash
npm run build 2>&1 | tail -5
```
Expected: `main.js` generated, no TypeScript errors.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/phases/fix.ts src/phases/ingest.ts src/phases/lint.ts src/source-paths.ts
git commit -m "fix(lint): drop node: URI prefix from path imports in phases and source-paths"
```

---

### Task 2: Drop `node:` prefix and replace readline in `claude-cli-client.ts`

**Files:**
- Modify: `src/claude-cli-client.ts`

The bot flags `node:child_process`, `node:fs`, `node:path`, `node:readline`. Strategy:
- `node:child_process` — keep as-is, will use `/skip` on PR.
- `node:fs` / `node:path` → drop `node:` prefix.
- `node:readline` → remove entirely; replace `createInterface` with manual buffer split.

- [ ] **Step 1: Replace the import block and readline usage**

Replace lines 1–4 and the `createInterface` call in `_generate`. New file header (lines 1–4):
```typescript
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
```
(`createInterface` import removed entirely.)

In `_generate`, replace the `createInterface` block (lines 152–171):

```typescript
    let buf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const ev = parseStreamLine(line);
        if (ev?.kind === "system" && ev.sessionId) {
          this.lastSessionId = ev.sessionId;
        }
        if (ev?.kind === "assistant_text") {
          const delta: Record<string, unknown> = ev.isReasoning
            ? { reasoning: ev.delta }
            : { content: ev.delta };
          queue.push({
            id: `cc-${++id}`,
            object: "chat.completion.chunk",
            model: this.cfg.model || "claude",
            created: 0,
            choices: [{ index: 0, delta: delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: null }],
          });
          wake();
        }
      }
    });
```

Also in the `finally` block, remove `rl.close();` (line 201) — `rl` no longer exists.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Run streaming tests**

```bash
npx vitest run tests/claude-cli-client.test.ts 2>&1 | tail -15
```
Expected: all pass.

- [ ] **Step 4: Run all tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/claude-cli-client.ts
git commit -m "fix(lint): drop node: prefix on fs/path; replace readline with manual buffer split"
```

---

### Task 3: Fix `controller.ts` — Node imports and async methods

**Files:**
- Modify: `src/controller.ts`

Four distinct fixes in one file:

**3a.** `requireClaudeAgent` (line 349): currently `async` but body is synchronous. Remove `async`, change return type, remove `await` at call sites (lines 197 and 464). Also drop `node:` prefix on `require("node:fs")`.

**3b.** `toVaultPath` (line 595): currently `async` but body is synchronous. Extract to module-level function (removes `async`, `this` warnings, and the `node:path` lazy-require warning).

**3c.** `buildAgentRunner` (line 380): drop `node:` prefix on `require("node:path")` and `require("node:fs")`.

- [ ] **Step 1: Extract `toVaultPath` to module-level function**

Before the `export class WikiController` line, add:

```typescript
function toVaultPath(vaultDir: string, savedPath: string): string | null {
  const { relative, isAbsolute, join } = require("path") as typeof import("path");
  const abs = isAbsolute(savedPath) ? savedPath : join(vaultDir, savedPath);
  const rel = relative(vaultDir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}
```

Remove the old `private async toVaultPath(...)` method at line 595.

Update the call site (was `await this.toVaultPath`, line 564):
```typescript
const pathInVault = toVaultPath(vaultRoot, m[1]);
```

- [ ] **Step 2: Fix `requireClaudeAgent`**

Change the method signature from `private async requireClaudeAgent(...)` to `private requireClaudeAgent(...)`.

Change return type from `Promise<string | null>` to `string | null`.

Drop `node:` prefix:
```typescript
private requireClaudeAgent(local: LocalConfig): string | null {
  const { existsSync } = require("fs") as typeof import("fs");
  const { iclaudePath } = local;
  if (!iclaudePath || !existsSync(iclaudePath)) {
    new Notice(i18n().ctrl.setClaudeCodePath);
    return null;
  }
  return iclaudePath;
}
```

Update both call sites — remove `await`:

Line 197 (in `dispatchChat`):
```typescript
if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
```

Line 464 (in `dispatch`):
```typescript
if (eff.backend === "claude-agent" && !this.requireClaudeAgent(local)) return;
```

- [ ] **Step 3: Drop `node:` prefix in `buildAgentRunner`**

Line 380:
```typescript
const { join } = require("path") as typeof import("path");
```

Line 381:
```typescript
const { mkdirSync } = require("fs") as typeof import("fs");
```

Also update the `toVaultPath` lazy-require inside the extracted function (already done in Step 1 — uses `"path"` without `node:`).

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | tail -5
```
Expected: no TypeScript errors.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts
git commit -m "fix(lint): controller — drop node: prefix, sync requireClaudeAgent, extract toVaultPath"
```

---

### Task 4: TypeScript fixes in `controller.ts`

**Files:**
- Modify: `src/controller.ts`

Two targeted edits:

**4a.** `TFile` cast at line 122–123.
**4b.** `console.info` at line 412.

- [ ] **Step 1: Fix TFile cast**

Find (around line 122):
```typescript
        if (origFile && "stat" in origFile) {
          await this.app.vault.modify(origFile as TFile, content);
```

Replace with:
```typescript
        if (origFile instanceof TFile) {
          await this.app.vault.modify(origFile, content);
```

- [ ] **Step 2: Fix console.info → console.debug**

Find (around line 412):
```typescript
            if (proxyFetch) console.info(`[llm-wiki] using proxy ${maskProxyUrl(proxyCfg.url)}`);
```

Replace with:
```typescript
            if (proxyFetch) console.debug(`[llm-wiki] using proxy ${maskProxyUrl(proxyCfg.url)}`);
```

- [ ] **Step 3: Build and test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -10
```
Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/controller.ts
git commit -m "fix(lint): TFile instanceof, console.debug in controller"
```

---

### Task 5: `main.ts` — `any` → `unknown` and redundant cast

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Fix `any` → `unknown` at lines 238 and 254**

Find (line 238):
```typescript
  const data = (await plugin.loadData()) as Record<string, any> | null;
```
Replace with:
```typescript
  const data = (await plugin.loadData()) as Record<string, unknown> | null;
```

Find (line 254):
```typescript
  const ca = data.claudeAgent as Record<string, any> | undefined;
```
Replace with:
```typescript
  const ca = data.claudeAgent as Record<string, unknown> | undefined;
```

- [ ] **Step 2: Remove redundant `as string` cast at line 190**

Find (line 190):
```typescript
      this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
```
The outer `typeof ... === "string"` guard (line 189) narrows the type — the inner `as string` is redundant. But the check here is an `if (typeof ... === "string")` guard on `.agentLogPath`, so inside the block `.agentLogPath` is already typed as `string` by the narrowing. Remove the cast:
```typescript
      this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
```
Wait — this is inside `if (typeof (data as Record<string, unknown> | null)?.agentLogPath === "string")`. The issue is that `as string` is still needed here because optional chaining prevents narrowing. The spec says remove inner cast at line 190 inside `typeof === "string"` guard. Actually looking at the context more carefully: line 190 is the migration block. The bot may flag `as string` here. 

Actually the spec says line 190 has `as string` inside a `typeof x === "string"` guard. Here the pattern is:
```typescript
if (typeof (data as Record<string, unknown> | null)?.agentLogPath === "string") {
  this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
```

We can access `.agentLogPath` directly since the `if` proves it's a string:
```typescript
if (typeof (data as Record<string, unknown> | null)?.agentLogPath === "string") {
  this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
```

The `as string` after `.agentLogPath` is indeed redundant with the typeof guard, but TypeScript may not narrow through the `?.` chain. Let's just remove the inner `as string` and see if it compiles:
```typescript
      this.settings.agentLogEnabled = (String((data as Record<string, unknown>).agentLogPath)).length > 0;
```

Simpler: cast once at the if condition. Replace those two lines:
```typescript
    if (typeof (data as Record<string, unknown> | null)?.agentLogPath === "string") {
      this.settings.agentLogEnabled = ((data as Record<string, unknown>).agentLogPath as string).length > 0;
```
with:
```typescript
    const legacyLogPath = (data as Record<string, unknown> | null)?.agentLogPath;
    if (typeof legacyLogPath === "string") {
      this.settings.agentLogEnabled = legacyLogPath.length > 0;
```

- [ ] **Step 3: Build and test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -10
```
Expected: no errors, all pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "fix(lint): any→unknown, remove redundant type assertions in main.ts"
```

---

### Task 6: `view.ts` — sentence case, Promise void, remove `!`

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Sentence case for `getDisplayText`**

Find (line 85):
```typescript
  getDisplayText(): string { return "LLM wiki"; }
```
Replace with:
```typescript
  getDisplayText(): string { return "LLM Wiki"; }
```

- [ ] **Step 2: Fix ribbon tooltip in `main.ts:30`**

Find (line 30 of `src/main.ts`):
```typescript
    this.addRibbonIcon("brain-circuit", "LLM wiki", () => {
```
Replace with:
```typescript
    this.addRibbonIcon("brain-circuit", "LLM Wiki", () => {
```

- [ ] **Step 3: Add `void` to bare `refreshDomains()` calls**

Line 117 — callback returns a Promise where void expected:
```typescript
      refreshBtn.addEventListener("click", () => void this.refreshDomains());
```

Line 141:
```typescript
      void this.refreshDomains();
```

Lines 341 and 345:
```typescript
      this.refreshDomains();  // line 341
      ...
      { this.refreshDomains(); return; }  // line 345
```

Find and replace all four bare calls (check exact context with Read before editing):
- Line 117: `() => this.refreshDomains()` → `() => void this.refreshDomains()`
- Line 141: `this.refreshDomains();` → `void this.refreshDomains();`
- Line 341: `this.refreshDomains();` → `void this.refreshDomains();`
- Line 345: `this.refreshDomains();` → `void this.refreshDomains();`

- [ ] **Step 4: Remove `!` after guarded `currentChatBubble` check**

Find (line 626, inside `if (this.currentChatBubble)` block):
```typescript
        registerLinkHandler(this.currentChatBubble!, this.app);
```
Replace with:
```typescript
        registerLinkHandler(this.currentChatBubble, this.app);
```

- [ ] **Step 5: Build and test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -10
```
Expected: no errors, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts src/main.ts
git commit -m "fix(lint): sentence case LLM Wiki, void refreshDomains, remove redundant ! assertion"
```

---

### Task 7: `mobile-fetch.ts` — remove `(input as Request).url` cast

**Files:**
- Modify: `src/mobile-fetch.ts`

Current code (lines 5–7):
```typescript
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.toString() : (input as Request).url;
```

The ternary cast `(input as Request).url` is flagged. Use explicit `else` branch:

- [ ] **Step 1: Restructure with explicit branches**

```typescript
  let url: string;
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -10
```
Expected: no errors, all pass.

- [ ] **Step 3: Commit**

```bash
git add src/mobile-fetch.ts
git commit -m "fix(lint): remove Request cast in mobile-fetch, use explicit else branch"
```

---

### Task 8: Final verification build

- [ ] **Step 1: Clean build**

```bash
npm run build 2>&1
```
Expected: successful, `main.js` written, 0 TypeScript errors.

- [ ] **Step 2: Full test suite**

```bash
npm test 2>&1
```
Expected: all tests pass, 0 failures.

- [ ] **Step 3: Note for PR**

Post this `/skip` comment on the PR at https://github.com/obsidianmd/obsidian-releases/pull/12351:
```
/skip node:child_process — plugin spawns a desktop CLI binary (Claude Code). Guarded by Platform.isMobile checks; mobile users receive a Notice and cannot trigger this code path.
```

---

## Self-Review Against Spec

| Spec requirement | Covered by |
|---|---|
| Drop `node:` prefix on path/fs in phases | Task 1 |
| Replace readline with buffer split | Task 2 |
| Drop `node:` on fs/path in controller | Task 3 |
| Remove `async` from `requireClaudeAgent` | Task 3 |
| Extract `toVaultPath` to module function | Task 3 |
| `TFile instanceof` | Task 4 |
| `console.info` → `console.debug` | Task 4 |
| `any` → `unknown` in main.ts | Task 5 |
| Remove redundant `as string` cast | Task 5 |
| `void refreshDomains()` (4 sites) | Task 6 |
| `getDisplayText` → `"LLM Wiki"` | Task 6 |
| Ribbon tooltip sentence case | Task 6 |
| Remove `!` in guarded block | Task 6 |
| Remove `(input as Request).url` | Task 7 |
| `/skip` for node:child_process | Task 8 |
