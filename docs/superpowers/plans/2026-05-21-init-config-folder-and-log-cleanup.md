# Init: Config Folder Creation Fix + Root Log Removal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `VaultTools.write` to create all ancestor directories recursively so `!Wiki/.config/` is created on first `init`, and remove the redundant `appendLog` that recreates the legacy `!Wiki/_log.md`.

**Architecture:** Two independent, surgical fixes. Fix 1 patches `VaultTools.write` to walk parent segments and `mkdir` each missing one. Fix 2 deletes a function and its single call site. No API changes, no new files.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Fix `VaultTools.write` — recursive directory creation

**Files:**
- Modify: `src/vault-tools.ts:25-32`
- Test: `tests/vault-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/vault-tools.test.ts` inside the existing `describe("VaultTools")` block, after the existing "write creates missing dir" test:

```typescript
it("write creates all ancestor dirs for deeply nested path", async () => {
  const created: string[] = [];
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockImplementation(async (p: string) => { created.push(p); }),
  });
  const vt = new VaultTools(adapter, "/vault");
  await vt.write("!Wiki/.config/_wiki_schema.md", "content");
  expect(created).toEqual(["!Wiki", "!Wiki/.config"]);
  expect(adapter.write).toHaveBeenCalledWith("!Wiki/.config/_wiki_schema.md", "content");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/vault-tools.test.ts
```

Expected: FAIL — `created` will be `["!Wiki/.config"]` instead of `["!Wiki", "!Wiki/.config"]`

- [ ] **Step 3: Replace `write` with recursive implementation**

In `src/vault-tools.ts`, replace lines 25–32:

```typescript
async write(vaultPath: string, content: string): Promise<void> {
  const segments = vaultPath.split("/").slice(0, -1);
  for (let i = 1; i <= segments.length; i++) {
    const partial = segments.slice(0, i).join("/");
    if (!(await this.adapter.exists(partial))) {
      await this.adapter.mkdir(partial);
    }
  }
  await this.adapter.write(vaultPath, content);
}
```

- [ ] **Step 4: Run all vault-tools tests**

```bash
npx vitest run tests/vault-tools.test.ts
```

Expected: all PASS (existing single-level test still passes — `exists` returns false for `"notes"`, so `mkdir("notes")` is called once; the new nested test expects both ancestors)

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all PASS (no callers change behavior — existing tests mock `exists` to return `true` for the dir, so the loop is a no-op)

- [ ] **Step 6: Commit**

```bash
git add src/vault-tools.ts tests/vault-tools.test.ts
git commit -m "fix(vault-tools): recursive mkdir for all ancestor dirs in write()"
```

---

### Task 2: Remove `appendLog` from `init.ts`

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Remove the `appendLog` call**

In `src/phases/init.ts`, delete this line (currently ~line 382, after the `if (!currentDomain)` block):

```typescript
  await appendLog(vaultTools, wikiRootGuess, domainId);
```

The surrounding code should look like:

```typescript
  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${toAnalyze.length} source files.`,
    outputTokens: outputTokens || undefined,
  };
}
```

- [ ] **Step 2: Remove the `appendLog` function**

Delete the entire `appendLog` function (currently ~lines 401–413):

```typescript
async function appendLog(vaultTools: VaultTools, wikiRoot: string, domainId: string): Promise<void> {
  const logPath = `${wikiRoot}/_log.md`;
  const today = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${today} — init — ${domainId}\n- Домен создан\n`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch { /* не критично */ }
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all PASS — no tests reference `appendLog`

- [ ] **Step 4: Commit**

```bash
git add src/phases/init.ts
git commit -m "fix(init): remove appendLog — root !Wiki/_log.md is legacy, ensureRootFiles already deletes it"
```
