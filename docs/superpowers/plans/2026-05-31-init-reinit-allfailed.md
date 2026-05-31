---
review:
  plan_hash: c0e27015f74822ba
  spec_hash: a338b7907e095460
  last_run: 2026-05-31
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      severity: WARNING
      section: "Task 3 > Step 2"
      section_hash: fd83fd3c5a31ce60
      text: "Contradictory expected output — says 'Expected: FAIL' then 'Actually the test should still PASS'. Agent cannot determine correct expectation."
      verdict: fixed
chain:
  intent: docs/superpowers/intents/2026-05-31-init-reinit-allfailed-intent.md
  spec:   docs/superpowers/specs/2026-05-31-init-reinit-allfailed-design.md
---

# Fix init/reinit allFailed false-positive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `allFailed` false-positive that halts `init`/`reinit --force` when the wiki is empty, while preserving the real-failure halt for non-empty wikis.

**Architecture:** Two-site fix — (1) correct `allFailed` semantics in `PageSimilarityService` so an empty `allPaths` never signals failure, (2) add defence-in-depth guard in `runIngest`. Tests updated to match new semantics.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Fix `jaccardFallbackAll` in `page-similarity.ts`

**Files:**
- Modify: `src/page-similarity.ts:158`
- Test: `tests/page-similarity.test.ts:204-218`

- [ ] **Step 1: Update the failing test first (TDD)**

Open `tests/page-similarity.test.ts`. Find the test at line 204:

```typescript
it("allFailed=true when annotations map is empty (no candidates at all)", async () => {
```

Change it to:

```typescript
it("allFailed=false when no pages exist (empty wiki)", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("dead"));
  const svc = new PageSimilarityService({
    mode: "embedding", topK: 1, model: "m", dimensions: 3,
    baseUrl: "http://x", apiKey: "k",
  });
  const { results, allFailed } = await svc.selectByEntities(
    [{ name: "Q1" }, { name: "Q2" }],
    new Map(),
    [],
  );
  expect(allFailed).toBe(false);
  expect(results.get("Q1::")).toEqual([]);
  expect(results.get("Q2::")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/ikeniborn/Documents/Project/obsidian-ai-wiki
npm test -- tests/page-similarity.test.ts 2>&1 | tail -20
```

Expected: FAIL — `expect(true).toBe(false)` (old code returns `allFailed: true`).

- [ ] **Step 3: Fix `jaccardFallbackAll` in `src/page-similarity.ts`**

Find line 158:
```typescript
    return { results, allFailed: !anySuccess };
```

Change to:
```typescript
    return { results, allFailed: allPaths.length > 0 && !anySuccess };
```

This is the `return` at the end of the `jaccardFallbackAll` private method (the one before `selectByEntitiesEmbedding`).

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/page-similarity.test.ts 2>&1 | tail -20
```

Expected: PASS — all tests in page-similarity.test.ts green.

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "fix(similarity): allFailed=false when no pages exist (empty wiki)"
```

---

### Task 2: Fix `selectByEntitiesEmbedding` in `page-similarity.ts`

**Files:**
- Modify: `src/page-similarity.ts:237`
- Test: `tests/page-similarity.test.ts` (existing passing tests cover this path)

- [ ] **Step 1: Fix `selectByEntitiesEmbedding` return**

Find line 237 in `src/page-similarity.ts` — the `return` at the end of `selectByEntitiesEmbedding`:
```typescript
    return { results, allFailed: !anySuccess };
```

Change to:
```typescript
    return { results, allFailed: allPaths.length > 0 && !anySuccess };
```

Note: this is a different method from Task 1. `jaccardFallbackAll` ends around line 159, `selectByEntitiesEmbedding` ends around line 238.

- [ ] **Step 2: Run all page-similarity tests**

```bash
npm test -- tests/page-similarity.test.ts 2>&1 | tail -20
```

Expected: PASS — all tests green.

- [ ] **Step 3: Commit**

```bash
git add src/page-similarity.ts
git commit -m "fix(similarity): allFailed=false when no pages exist in embedding path"
```

---

### Task 3: Add defence-in-depth guard in `ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts:151`
- Test: `tests/phases/ingest.test.ts:936-961`

- [ ] **Step 1: Update the ingest allFailed halt test**

Open `tests/phases/ingest.test.ts`. Find the test starting at line 936:

```typescript
it("halts when similarity.selectByEntities reports allFailed with non-empty entities", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockResolvedValue("source"),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
```

Change the `mockAdapter` call — the `list` mock must return a non-meta wiki file for the wiki folder path, so `nonMetaPaths.length > 0`:

```typescript
it("halts when similarity.selectByEntities reports allFailed with non-empty entities", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockResolvedValue("source"),
    list: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("!Wiki/work")
          ? { files: ["!Wiki/work/entities/Foo.md"], folders: [] }
          : { files: [], folders: [] },
      ),
    ),
  });
```

Leave everything else in the test unchanged.

- [ ] **Step 2: Verify baseline still passes**

```bash
npm test -- tests/phases/ingest.test.ts 2>&1 | tail -10
```

Expected: all pass. The updated list mock returns `Foo.md` for the wiki path, so `nonMetaPaths = ["!Wiki/work/entities/Foo.md"]`. The existing guard (`allFailed && entities.length > 0`) still fires — the new `nonMetaPaths.length > 0` condition hasn't been added yet, but it would be true anyway.

- [ ] **Step 3: Fix guard in `src/phases/ingest.ts`**

Find line 151:
```typescript
    if (allFailed && entitiesResult.value.entities.length > 0) {
```

Change to:
```typescript
    if (allFailed && entitiesResult.value.entities.length > 0 && nonMetaPaths.length > 0) {
```

- [ ] **Step 4: Run all ingest tests**

```bash
npm test -- tests/phases/ingest.test.ts 2>&1 | tail -10
```

Expected: all pass. The halt test still fires because `nonMetaPaths` now has `Foo.md`.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "fix(ingest): skip allFailed halt when wiki is empty (nonMetaPaths.length > 0 guard)"
```

---

### Task 4: Update lat.md and run lat check

**Files:**
- Modify: relevant sections in `lat.md/`

- [ ] **Step 1: Update lat.md if any section describes allFailed semantics**

```bash
lat locate "allFailed" 2>&1
lat locate "per-entity retrieval" 2>&1
```

If a section describes `allFailed = !anySuccess` or the halt condition — update it to reflect:
- `allFailed = allPaths.length > 0 && !anySuccess`
- halt fires only when `nonMetaPaths.length > 0`

- [ ] **Step 2: Run lat check**

```bash
lat check 2>&1
```

Expected: no errors. Fix any broken code refs or wiki links before proceeding.

- [ ] **Step 3: Commit lat.md changes (only if changed)**

```bash
git add lat.md/
git commit -m "docs(lat): update allFailed semantics and ingest halt condition"
```
