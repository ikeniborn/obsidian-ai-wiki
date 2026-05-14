# Format Timeout UI + appendMissingLines Abort Fix + Fix Legacy Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `format` timeout in Settings UI, fix appendMissingLines being skipped on abort-during-retry, and delete the unreachable `fix` operation.

**Architecture:** Three independent patches in one PR. Task 1 extracts a tiny pure helper `parseTimeoutString` from the inline `onChange` callback so the parsing logic can be unit-tested. Task 2 moves `missing2` computation outside the `if (!signal.aborted)` guard. Task 3 deletes dead code top-to-bottom (types → runner → controller → phase file → view).

**Tech Stack:** TypeScript, Vitest, esbuild (obsidian-llm-wiki plugin)

---

## File Map

| File | Action |
|---|---|
| `src/settings.ts` | Extract `parseTimeoutString`; expand 4 → 5 parts |
| `src/i18n.ts` | Update `timeouts_desc` in 3 locales (lines 19, 216, 411) |
| `src/phases/format.ts` | Move `missing2` block outside `if (!signal.aborted)` |
| `tests/phases/format.test.ts` | Add abort-during-retry test |
| `tests/settings.test.ts` | New: unit tests for `parseTimeoutString` |
| `src/types.ts` | Remove `"fix"` from `WikiOperation`; remove `fix` from timeouts type + `DEFAULT_SETTINGS` |
| `src/agent-runner.ts` | Remove `runFix` import, `case "fix":` branch, `op === "fix" ||` in `buildOptsFor` |
| `src/controller.ts` | Remove `async fix()` method |
| `src/phases/fix.ts` | Delete file |
| `src/view.ts` | Remove `fixChatEl` field and its two `?.remove()` + `= null` pairs |

---

## Task 1: settings.ts — extract parseTimeoutString + expand to 5 parts

**Files:**
- Modify: `src/settings.ts:110-117`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/settings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTimeoutString } from "../src/settings";

describe("parseTimeoutString", () => {
  it("valid 5-part string → all values", () => {
    const r = parseTimeoutString("300/300/900/3600/600");
    expect(r).toEqual({ ingest: 300, query: 300, lint: 900, init: 3600, format: 600 });
  });

  it("4-part string → null (rejected)", () => {
    expect(parseTimeoutString("300/300/900/3600")).toBeNull();
  });

  it("non-numeric part → null", () => {
    expect(parseTimeoutString("300/300/900/abc/600")).toBeNull();
  });

  it("zero value → null", () => {
    expect(parseTimeoutString("300/300/900/0/600")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
npx vitest run tests/settings.test.ts
```

Expected: FAIL — `parseTimeoutString` is not exported

- [ ] **Step 3: Extract parseTimeoutString and update settings.ts**

In `src/settings.ts`, add export before the class definition (or at top-level):

```typescript
export function parseTimeoutString(v: string): { ingest: number; query: number; lint: number; init: number; format: number } | null {
  const parts = v.split("/").map((x) => Number(x.trim()));
  if (parts.length === 5 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3], format: parts[4] };
  }
  return null;
}
```

Replace the timeout `Setting` block (lines 106–118) with:

```typescript
new Setting(containerEl)
  .setName(T.settings.timeouts_name)
  .setDesc(T.settings.timeouts_desc)
  .addText((t) =>
    t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}/${s.timeouts.format}`)
      .onChange(async (v) => {
        const parsed = parseTimeoutString(v);
        if (parsed) {
          s.timeouts = { ...s.timeouts, ...parsed };
          await this.plugin.saveSettings();
        }
      }),
  );
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
npx vitest run tests/settings.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat: expose format timeout in settings UI (4→5 parts)"
```

---

## Task 2: i18n.ts — update timeouts_desc in all 3 locales

**Files:**
- Modify: `src/i18n.ts:19` (EN), `src/i18n.ts:216` (RU), `src/i18n.ts:411` (ES)

- [ ] **Step 1: Update EN locale (line 19)**

Change:
```typescript
    timeouts_desc: "ingest / query / lint / init",
```
To:
```typescript
    timeouts_desc: "ingest / query / lint / init / format",
```

- [ ] **Step 2: Update RU locale (line 216)**

Change:
```typescript
    timeouts_desc: "ingest / query / lint / init",
```
To:
```typescript
    timeouts_desc: "ingest / query / lint / init / format",
```

- [ ] **Step 3: Update ES locale (line 411)**

Change:
```typescript
    timeouts_desc: "ingest / query / lint / init",
```
To:
```typescript
    timeouts_desc: "ingest / query / lint / init / format",
```

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "i18n: add format to timeouts_desc in all locales"
```

---

## Task 3: format.ts — move missing2 outside abort guard

**Files:**
- Modify: `src/phases/format.ts:166-177`
- Modify: `tests/phases/format.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/phases/format.test.ts`, inside `describe("runFormat", ...)`, add after the last `it(...)`:

```typescript
  it("token-retry: abort во время retry не ломает restored-block", async () => {
    // First pass: drops tokens. Second pass (retry): aborted during call.
    const formatted1 = "# Заметка про ClickHouse\n\nClickHouse 23.8 SQL.";
    const json1 = JSON.stringify({ report: "r", formatted: formatted1 });

    const ctrl = new AbortController();
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 2) ctrl.abort(); // abort during token-retry call
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                if (ctrl.signal.aborted) return;
                yield { choices: [{ delta: { content: json1 }, finish_reason: null }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);
    await collect(runFormat([FILE], vt, llm, "model", false, [], ctrl.signal));

    const written = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string | undefined;
    if (written) {
      // If file was written, it must contain the restored block
      expect(written).toContain("<!-- restored-lines: token loss after retry -->");
    }
    // If abort fired before write, that is also acceptable (no assertion needed)
  });
```

- [ ] **Step 2: Run to verify FAIL**

```bash
npx vitest run tests/phases/format.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — test fails because `written` lacks `restored-lines` block

- [ ] **Step 3: Fix format.ts**

Replace lines 165–177 in `src/phases/format.ts`:

**Before:**
```typescript
    const fullText2 = yield* callOnce(restoreParams);
    if (!signal.aborted) {
      const parsed2 = extractJsonObject(fullText2);
      if (parsed2) {
        finalFormatted = parsed2.formatted;
        finalReport = parsed2.report;
      }
      const missing2 = missingTokensWithContext(original, finalFormatted);
      if (missing2.length > 0) {
        finalFormatted = appendMissingLines(finalFormatted, missing2);
      }
    }
```

**After:**
```typescript
    const fullText2 = yield* callOnce(restoreParams);
    if (!signal.aborted) {
      const parsed2 = extractJsonObject(fullText2);
      if (parsed2) {
        finalFormatted = parsed2.formatted;
        finalReport = parsed2.report;
      }
    }
    // Append missing lines regardless of abort state — vaultTools.write runs after this
    // block unconditionally, so finalFormatted must be complete before it.
    // Scope: covers signal.aborted=true with callOnce completing normally.
    // If callOnce throws, neither this code nor vaultTools.write is reached.
    const missing2 = missingTokensWithContext(original, finalFormatted);
    if (missing2.length > 0) {
      finalFormatted = appendMissingLines(finalFormatted, missing2);
    }
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
npx vitest run tests/phases/format.test.ts --reporter=verbose
```

Expected: all pass including new test

- [ ] **Step 5: Commit**

```bash
git add src/phases/format.ts tests/phases/format.test.ts
git commit -m "fix: appendMissingLines runs regardless of abort state after token-retry"
```

---

## Task 4: types.ts — remove fix from WikiOperation and timeouts

**Files:**
- Modify: `src/types.ts:9` (WikiOperation union), `src/types.ts:122` (timeouts interface), `src/types.ts:157` (DEFAULT_SETTINGS)

- [ ] **Step 1: Remove `| "fix"` from WikiOperation**

In `src/types.ts`, the `WikiOperation` union (lines 4–12):

**Before:**
```typescript
export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "fix"
  | "chat"
  | "init"
  | "format";
```

**After:**
```typescript
export type WikiOperation =
  | "ingest"
  | "query"
  | "query-save"
  | "lint"
  | "chat"
  | "init"
  | "format";
```

- [ ] **Step 2: Remove `fix: number` from timeouts interface**

In `src/types.ts`, the timeouts block (around line 119–125):

**Before:**
```typescript
    ingest: number;
    query: number;
    lint: number;
    fix: number;
    init: number;
    format: number;
```

**After:**
```typescript
    ingest: number;
    query: number;
    lint: number;
    init: number;
    format: number;
```

- [ ] **Step 3: Remove `fix: 900` from DEFAULT_SETTINGS.timeouts**

In `src/types.ts` (around line 157):

**Before:**
```typescript
  timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600, format: 600 },
```

**After:**
```typescript
  timeouts: { ingest: 300, query: 300, lint: 900, init: 3600, format: 600 },
```

**⚠ Do NOT run tests or commit after this task.** Removing `"fix"` from `WikiOperation` causes TypeScript errors in `agent-runner.ts` (import + case) and `controller.ts` (method) until Tasks 5–7 remove those callers. Proceed directly to Task 5. The shared commit happens in Task 7 Step 6.

---

## Task 5: agent-runner.ts — remove fix references

**Files:**
- Modify: `src/agent-runner.ts:5`, `src/agent-runner.ts:23`, `src/agent-runner.ts:80-82`

- [ ] **Step 1: Remove runFix import (line 5)**

**Before:**
```typescript
import { runFix } from "./phases/fix";
```

**After:** delete the line entirely.

- [ ] **Step 2: Remove `op === "fix" ||` from buildOptsFor (line 23)**

**Before:**
```typescript
    const key = (op === "query-save" ? "query" : (op === "fix" || op === "chat") ? "lint" : op) as OpKey;
```

**After:**
```typescript
    const key = (op === "query-save" ? "query" : op === "chat" ? "lint" : op) as OpKey;
```

- [ ] **Step 3: Remove case "fix": block (lines 80–82)**

**Before:**
```typescript
      case "fix":
        yield* runFix(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, req.context, req.instruction);
        break;
```

**After:** delete all three lines.

---

## Task 6: controller.ts — remove fix method

**Files:**
- Modify: `src/controller.ts:203-205`

- [ ] **Step 1: Remove async fix() method**

**Before:**
```typescript
  async fix(domainId: string, lintReport: string, instruction: string): Promise<void> {
    await this.dispatch("fix", [domainId], domainId, lintReport, instruction);
  }
```

**After:** delete all three lines (including blank line after `lint()` method if it was a separator — preserve the blank line between `lint()` and `chat()`).

---

## Task 7: delete fix.ts + view.ts cleanup + commit

**Files:**
- Delete: `src/phases/fix.ts`
- Modify: `src/view.ts:50`, `src/view.ts:275-276`, `src/view.ts:502-503`

- [ ] **Step 1: Delete src/phases/fix.ts**

```bash
git rm src/phases/fix.ts
```

- [ ] **Step 2: Remove fixChatEl field from view.ts (line 50)**

**Before:**
```typescript
  private fixChatEl: HTMLElement | null = null;
```

**After:** delete the line.

- [ ] **Step 3: Remove first fixChatEl pair (lines ~275-276)**

**Before:**
```typescript
    this.fixChatEl?.remove();
    this.fixChatEl = null;
```

**After:** delete both lines.

- [ ] **Step 4: Remove second fixChatEl pair (lines ~502-503)**

**Before:**
```typescript
    this.fixChatEl?.remove();
    this.fixChatEl = null;
```

**After:** delete both lines.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass, no TypeScript errors

- [ ] **Step 6: Commit Tasks 4–7 together**

`src/phases/fix.ts` is already staged from `git rm` in Step 1 — no need to add it again.

```bash
git add src/types.ts src/agent-runner.ts src/controller.ts src/view.ts
git commit -m "refactor: remove dead fix operation (types, runner, controller, view, phase)"
```

---

## Manual Testing Checklist

Run these after all automated tests pass, before Task 8.

- [ ] Open Obsidian Settings → plugin settings → timeout field shows `300/300/900/3600/600`
- [ ] Change format value (e.g. `300/300/900/3600/300`) → save → close settings → reopen → verify new value persisted
- [ ] Run format on a file that triggers token-retry (look for `token loss after first pass` in dev log — use a file whose formatted output is significantly shorter than the original) → verify `.formatted.md` contains `<!-- restored-lines: token loss after retry -->`

---

## Task 8: bump version + build

> Required by `CLAUDE.md`: "Перед каждой сборкой автоматически поднимать patch-версию."

**Files:**
- Modify: `package.json` (version field)
- Modify: `src/manifest.json` (version field)

- [ ] **Step 1: Read current version**

```bash
node -e "console.log(require('./package.json').version)"
```

Note the output, e.g. `0.1.90`.

- [ ] **Step 2: Compute next patch version**

`0.1.90` → `0.1.91`

- [ ] **Step 3: Update package.json**

In `package.json`, change `"version": "0.1.90"` → `"version": "0.1.91"` (use actual values).

- [ ] **Step 4: Update src/manifest.json**

In `src/manifest.json`, change `"version": "0.1.90"` → `"version": "0.1.91"` (use actual values).

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: `main.js` emitted without errors

- [ ] **Step 6: Commit**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore: bump version to 0.1.91, build"
```
