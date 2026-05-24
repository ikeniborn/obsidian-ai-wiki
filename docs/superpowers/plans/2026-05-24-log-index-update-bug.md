# Fix _log/_index Not Updated After Init/Ingest/Lint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `VaultTools.write()` silently failing for files in hidden directories (`.config`) when Obsidian vault indexer is present.

**Architecture:** Wrap `vault.create()` in try/catch; on error fall back to `adapter.write()`. Obsidian doesn't index hidden dirs, so `getAbstractFileByPath()` returns `null` and `create()` throws "File already exists" because the file is on disk but not in the index.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/vault-tools.ts` | Wrap `vault.create()` in try/catch with `adapter.write()` fallback (lines 46–48) |
| `tests/vault-tools.test.ts` | Add one new test: vault.create throws → adapter.write called |

---

### Task 1: Write the Failing Test

**Files:**
- Modify: `tests/vault-tools.test.ts`

- [ ] **Step 1: Add the failing test**

Open `tests/vault-tools.test.ts` and append this test inside the `describe("VaultTools", ...)` block, after the last test:

```typescript
it("write falls back to adapter.write when vault.create throws (hidden dir)", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    write: vi.fn().mockResolvedValue(undefined),
  });
  const vault = {
    getAbstractFileByPath: vi.fn().mockReturnValue(null),
    create: vi.fn().mockRejectedValue(new Error("File already exists")),
    modify: vi.fn(),
  };
  const vt = new VaultTools(adapter, "/vault", vault);
  await vt.write("!Wiki/.config/_log.md", "new content");
  expect(vault.create).toHaveBeenCalledWith("!Wiki/.config/_log.md", "new content");
  expect(adapter.write).toHaveBeenCalledWith("!Wiki/.config/_log.md", "new content");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/vault-tools.test.ts 2>&1 | tail -20
```

Expected: test fails — `adapter.write` was not called (current code doesn't have the fallback).

---

### Task 2: Implement the Fix

**Files:**
- Modify: `src/vault-tools.ts:46–48`

- [ ] **Step 3: Apply the fix**

In `src/vault-tools.ts`, replace lines 46–48:

```typescript
// Before:
      } else {
        await this.vault.create(vaultPath, content);
      }
```

```typescript
// After:
      } else {
        try {
          await this.vault.create(vaultPath, content);
        } catch {
          // Obsidian doesn't index hidden dirs (.config) — vault.create() throws if file exists on disk
          await this.adapter.write(vaultPath, content);
        }
      }
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run tests/vault-tools.test.ts 2>&1 | tail -20
```

Expected: all tests pass, including the new one.

- [ ] **Step 5: Run all tests to check for regressions**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/vault-tools.ts tests/vault-tools.test.ts
git commit -m "fix(vault-tools): fall back to adapter.write when vault.create throws for hidden dirs"
```
