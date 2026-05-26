---
review:
  plan_hash: 9c4e4cf2d0693fc7
  spec_hash: c1a269834b3e4004
  last_run: "2026-05-26"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---
# Lint Vector Progress Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vector read/write progress events to lint operation, visible only in embedding mode, with a count of updated entries.

**Architecture:** `PageSimilarityService.refreshCache` gains a `{ updated: number }` return value. `runLint` calls `loadCache` before `refreshCache` and emits two `info_text` events gated on `embedding` mode.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/page-similarity.ts` | `refreshCache` return type `void` → `{ updated: number }` |
| `src/phases/lint.ts` | Add `loadCache` + two conditional `info_text` events |
| `tests/page-similarity.test.ts` | Fix existing test + add `refreshCache` return value test |
| `tests/phases/lint.test.js` | Add test: embedding-mode vector events |

---

### Task 1: Update `refreshCache` return type in `page-similarity.ts`

**Files:**
- Modify: `src/page-similarity.ts` (method `refreshCache`)
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Fix the existing test that checks `refreshCache` resolves to `undefined`**

The current test at line 52 of `tests/page-similarity.test.ts` expects `undefined`:
```ts
await expect(svc.refreshCache("domainRoot", {} as never, new Map())).resolves.toBeUndefined();
```

Replace it with:
```ts
it("refreshCache returns { updated: 0 } in Jaccard mode", async () => {
  const svc = makeService(5);
  const result = await svc.refreshCache("domainRoot", {} as never, new Map());
  expect(result).toEqual({ updated: 0 });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/page-similarity.test.ts
```

Expected: FAIL — `refreshCache` still returns `undefined`.

- [ ] **Step 3: Update `refreshCache` in `src/page-similarity.ts`**

Change the method signature from:
```ts
async refreshCache(
  domainRoot: string,
  vaultTools: VaultTools,
  indexAnnotations: Map<string, string>,
): Promise<void>
```

To:
```ts
async refreshCache(
  domainRoot: string,
  vaultTools: VaultTools,
  indexAnnotations: Map<string, string>,
): Promise<{ updated: number }>
```

Change the early-return path (currently `if (toEmbed.length === 0) return;`) to:
```ts
if (toEmbed.length === 0) return { updated: 0 };
```

Add return at the end of the method (after `await vaultTools.write(...)` and `this.cache = cacheFile;`):
```ts
return { updated: toEmbed.length };
```

Also add `return { updated: 0 };` at the top guard returns (the `if (this.config.mode !== "embedding") return;` line and any early returns for missing config):
```ts
if (this.config.mode !== "embedding") return { updated: 0 };
// ...
if (!baseUrl || !model || !dimensions) return { updated: 0 };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/page-similarity.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full test suite to check nothing else broke**

```bash
npx vitest run
```

Expected: all tests pass (ingest calls `refreshCache` but ignores return — TypeScript does not require destructuring `Promise<{ updated: number }>`, so no compile errors).

- [ ] **Step 6: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(page-similarity): refreshCache returns { updated: number }"
```

---

### Task 2: Add `loadCache` + vector events to `runLint`

**Files:**
- Modify: `src/phases/lint.ts` (end of domain loop, lines 218-221)
- Test: `tests/phases/lint.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/phases/lint.test.js` inside the `describe("runLint", ...)` block:

```js
it("emits vector info_text events in embedding mode", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, "/vault");
  const similarity = {
    config: { mode: "embedding" },
    loadCache: vi.fn().mockResolvedValue(undefined),
    refreshCache: vi.fn().mockResolvedValue({ updated: 3 }),
  };
  const events = await collect(
    runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
  );
  const infoEvents = events.filter((e) => e.kind === "info_text");
  expect(similarity.loadCache).toHaveBeenCalled();
  expect(similarity.refreshCache).toHaveBeenCalled();
  expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
  expect(infoEvents.some((e) => e.summary.includes("обновлено векторов: 3"))).toBe(true);
});

it("does not emit vector events in jaccard mode", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, "/vault");
  const similarity = {
    config: { mode: "jaccard" },
    loadCache: vi.fn().mockResolvedValue(undefined),
    refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
  };
  const events = await collect(
    runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
  );
  const vectorEvents = events.filter(
    (e) => e.kind === "info_text" && (e.summary.includes("векторов") || e.summary.includes("кэша"))
  );
  expect(vectorEvents).toHaveLength(0);
});

it("does not emit write event when updated is 0", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, "/vault");
  const similarity = {
    config: { mode: "embedding" },
    loadCache: vi.fn().mockResolvedValue(undefined),
    refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
  };
  const events = await collect(
    runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
  );
  const infoEvents = events.filter((e) => e.kind === "info_text");
  expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
  expect(infoEvents.some((e) => e.summary.includes("обновлено векторов"))).toBe(false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/phases/lint.test.js
```

Expected: FAIL — `loadCache` not called, no `info_text` vector events.

- [ ] **Step 3: Update the similarity block in `src/phases/lint.ts`**

Replace the existing block (lines 218-221):
```ts
if (similarity) {
  const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
  await similarity.refreshCache(wikiVaultPath, vaultTools, parseIndexAnnotations(indexRaw));
}
```

With:
```ts
if (similarity) {
  const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
  const annotations = parseIndexAnnotations(indexRaw);

  if (similarity.config.mode === "embedding") {
    yield { kind: "info_text", icon: "📥", summary: "загрузка кэша векторов..." };
    await similarity.loadCache(wikiVaultPath, vaultTools);
  }

  const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, annotations);

  if (similarity.config.mode === "embedding" && updated > 0) {
    yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
  }
}
```

- [ ] **Step 4: Run lint tests to confirm they pass**

```bash
npx vitest run tests/phases/lint.test.js
```

Expected: PASS (all existing tests + 3 new ones)

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.js
git commit -m "feat(lint): emit vector read/write progress events in embedding mode"
```

---

## Self-Review

**Spec coverage:**
- ✅ "reading vectors" event → `info_text "📥 загрузка кэша векторов..."` before `loadCache`
- ✅ "writing vectors N" event → `info_text "📤 обновлено векторов: N"` when `updated > 0`
- ✅ Events only in embedding mode → gated on `similarity.config.mode === "embedding"`
- ✅ `refreshCache` returns `{ updated: number }` → Task 1
- ✅ `loadCache` added to lint → Task 2
- ✅ Ingest unaffected → existing call ignores return value, no type error
- ✅ Tests cover: embedding with updates, embedding with 0 updates, jaccard (no events)

**Placeholder scan:** none found.

**Type consistency:** `{ updated: number }` defined in Task 1, destructured as `{ updated }` in Task 2. `similarity.config.mode` used consistently.
