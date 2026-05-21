# Init via source_paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove vault-sampling bootstrap from `runInit`; delegate no-sources path to `runInitWithSources` using the domain's configured `source_paths`.

**Architecture:** Replace ~90-line LLM vault-sampling block in `runInit` with a 10-line guard that validates the domain config and delegates to the already-correct `runInitWithSources`. No changes to `runInitWithSources`, `controller.ts`, or UI.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Change |
|------|--------|
| `src/phases/init.ts` | Delete vault-sampling block (lines 91–206), replace with domain-guard + delegate |
| `tests/phases/init.test.ts` | Delete 9 tests covering old bootstrap path; add 4 new tests for new path |

---

### Task 1: Write failing tests for new `runInit` no-sources behaviour

**Files:**
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Add new describe block at the end of `describe("runInit", ...)`** (before the closing `});` of that block, after the existing `"yields error when domainId is empty"` test)

Insert after line 99 (inside the existing `describe("runInit", ...)` block, after the empty-domainId test):

```ts
  it("yields error when domainId not found in domains", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["unknown"], vt, makeLlm("{}"), "model", [], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("domain not found");
  });

  it("yields error when domain already initialised (has entity_types)", async () => {
    const initialised: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: ["src/docs"],
      entity_types: [{ type: "concept", description: "c", extraction_cues: [] }],
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm("{}"), "model", [initialised], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("already initialised");
  });

  it("yields error when domain has no source_paths configured", async () => {
    const noSources: DomainEntry = { id: "dom", name: "Dom", wiki_folder: "dom", source_paths: [] };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm("{}"), "model", [noSources], "TestVault", new AbortController().signal),
    );
    const err = events.find((e: any) => e.kind === "error") as any;
    expect(err).toBeDefined();
    expect(err.message).toContain("no source_paths");
  });

  it("delegates to runInitWithSources when domain has source_paths — emits init_start", async () => {
    const domainWithSources: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: ["sources"],
    };
    const bootstrapJson = JSON.stringify({
      reasoning: "", id: "dom", name: "Dom", wiki_folder: "dom",
      source_paths: [], entity_types: [], language_notes: "",
    });
    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (path: string) =>
        path === "sources" || path === ""
          ? { files: ["sources/a.md"], folders: [] }
          : { files: [], folders: [] },
      ),
      read: vi.fn().mockResolvedValue("content"),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom"], vt, makeLlm(bootstrapJson), "model", [domainWithSources], "TestVault", new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "init_start")).toBe(true);
  });
```

- [ ] **Step 2: Run new tests to verify they fail (implementation not yet changed)**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | grep -E "(PASS|FAIL|✓|✗|×|domain not found|already initialised|no source_paths|init_start)"
```

Expected: 4 new tests FAIL (old code does vault-sampling, not the new error messages / delegation).

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/phases/init.test.ts
git commit -m "test(init): add failing tests for source_paths delegation path"
```

---

### Task 2: Implement new `runInit` no-sources path

**Files:**
- Modify: `src/phases/init.ts:91–206`

- [ ] **Step 1: Replace lines 91–206 in `runInit`**

Current code block to remove (lines 91–206, everything after the `if (sourcePaths.length)` guard through end of `runInit`):

```ts
  if (existing?.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }

  yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...\n` };

  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const start = Date.now();
  // ... [all vault-sampling + LLM call + domain_created/domain_updated + result] ...
}
```

Replace the entire block from line 91 to closing `}` of `runInit` with:

```ts
  if (!existing) {
    yield { kind: "error", message: `init: domain not found: "${domainId}" — add it in settings first` };
    return;
  }
  if (existing.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }
  const effectiveSources = existing.source_paths ?? [];
  if (!effectiveSources.length) {
    yield { kind: "error", message: `init: no source_paths configured for "${domainId}" — add them in settings` };
    return;
  }
  yield* runInitWithSources(domainId, effectiveSources, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError);
}
```

The precise edit: in `src/phases/init.ts`, replace from the line `  if (existing?.entity_types?.length) {` (line 91) through the closing `}` of `runInit` (line 206) with the block above.

- [ ] **Step 2: Run new tests to verify they now pass**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | grep -E "(PASS|FAIL|✓|✗|×)"
```

Expected: 4 new tests PASS. Some old tests may now fail (vault-sampling tests — expected, handle in Task 3).

- [ ] **Step 3: Commit implementation**

```bash
git add src/phases/init.ts
git commit -m "feat(init): replace vault-sampling bootstrap with source_paths delegation"
```

---

### Task 3: Delete obsolete vault-sampling tests

**Files:**
- Modify: `tests/phases/init.test.ts`

The tests below test the old vault-sampling bootstrap path (calling LLM without `--sources`). They must be deleted.

- [ ] **Step 1: Delete these tests from `describe("runInit", ...)`**

Delete the following test cases (they call `runInit` with no `--sources`, with empty domains `[]`, relying on old LLM bootstrap):

1. `"yields error when domain already exists"` — was coincidentally passing because LLM parse of `{}` failed; replaced by new `"yields error when domain has no source_paths configured"` test
2. `"dry-run returns JSON preview without domain_created event"` — tested old bootstrap dry-run
3. `"yields domain_created with vault-relative wiki_folder (normalization applied)"` — tested old bootstrap domain_created
4. `"yields result event after domain_created"` — tested old bootstrap result

Delete the entire `describe("runInit — ensureRootFiles", ...)` block (5 tests). `ensureRootFiles` is now only called from `runInitWithSources`, which is already tested by the `--sources` path tests.

- [ ] **Step 2: Run full init test suite to verify no regressions**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -20
```

Expected: all remaining tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 4: Commit test cleanup**

```bash
git add tests/phases/init.test.ts
git commit -m "test(init): remove vault-sampling bootstrap tests"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Delete `listFiles("")` + `readAll` + LLM bootstrap call from `runInit` | Task 2 |
| Add `!existing` → error "domain not found" | Task 2 |
| Add `entity_types.length > 0` → error "already initialised" | Task 2 |
| Add `!source_paths.length` → error "no source_paths configured" | Task 2 |
| Delegate to `runInitWithSources(existing.source_paths, ...)` | Task 2 |
| Test: unknown domainId → "domain not found" | Task 1 |
| Test: domain has entity_types → "already initialised" | Task 1 |
| Test: domain has no source_paths → "no source_paths configured" | Task 1 |
| Test: domain has source_paths → delegates (init_start emitted) | Task 1 |
| Delete vault-sampling tests | Task 3 |
| `runInitWithSources` unchanged | ✓ (not touched) |
| `--force` path unchanged | ✓ (not touched) |
| `--sources` path unchanged | ✓ (not touched) |

**Out-of-scope confirmed not touched:** `runInitWithSources`, `controller.ts`, UI, `--force` path.
