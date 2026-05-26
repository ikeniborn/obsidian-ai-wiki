---
review:
  plan_hash: 39e19a0908adba70
  spec_hash: 37e458c5b4aae61e
  last_run: 2026-05-26
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---
# Ingest Progress Create/Update Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change per-page `tool_use` event label from "Write" to "Create"/"Update" during ingest, and update the final summary text to show created/updated counts separately.

**Architecture:** Single-file change in `src/phases/ingest.ts`. `existingContent` is already read before the write — use it to set the `tool_use` name. Derive counts from `logEntries` (already populated) and pass them to a refactored `buildIngestSummary`. No changes to `types.ts`, `view.ts`, or `controller.ts`.

**Tech Stack:** TypeScript, Vitest. Test file: `tests/phases/ingest.test.ts`. Run tests: `npx vitest run tests/phases/ingest.test.ts`.

---

### Task 1: Per-page Create/Update label

**Files:**
- Modify: `tests/phases/ingest.test.ts` (add two tests)
- Modify: `src/phases/ingest.ts:174`

- [ ] **Step 1: Write two failing tests**

Add inside `describe("runIngest", ...)` in `tests/phases/ingest.test.ts`:

```typescript
it("emits tool_use with name 'Create' for new wiki page", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === "Sources/doc.md") return "source text";
      throw new Error("not found"); // wiki page does not exist yet
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify({
    reasoning: "x",
    pages: [{ path: "!Wiki/work/entities/New.md", content: "# New" }],
  });
  const events = await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, makeLlm(llmResponse), "llama3.2",
      [domain], VAULT_ROOT, new AbortController().signal,
    ),
  );
  const tu = events.find(
    (e: any) => e.kind === "tool_use" && (e.input as any)?.path === "!Wiki/work/entities/New.md",
  ) as any;
  expect(tu?.name).toBe("Create");
});

it("emits tool_use with name 'Update' for existing wiki page", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === "Sources/doc.md") return "source text";
      if (path === "!Wiki/work/entities/Existing.md") return "# Old content";
      throw new Error("not found");
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify({
    reasoning: "x",
    pages: [{ path: "!Wiki/work/entities/Existing.md", content: "# Updated content" }],
  });
  const events = await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, makeLlm(llmResponse), "llama3.2",
      [domain], VAULT_ROOT, new AbortController().signal,
    ),
  );
  const tu = events.find(
    (e: any) => e.kind === "tool_use" && (e.input as any)?.path === "!Wiki/work/entities/Existing.md",
  ) as any;
  expect(tu?.name).toBe("Update");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: both new tests FAIL with `expected "Write" to be "Create"` / `expected "Write" to be "Update"`.

- [ ] **Step 3: Implement the label change**

In `src/phases/ingest.ts`, find line 174 (inside the `for (const page of pages)` loop, after the `existingContent` read):

```typescript
// before
yield { kind: "tool_use", name: "Write", input: { path: page.path } };

// after
yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
```

Only this one `yield` changes — the error-case yields at lines 148, 155, 166 (blocked/invalid paths) keep `name: "Write"`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all tests PASS, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add tests/phases/ingest.test.ts src/phases/ingest.ts
git commit -m "feat(ingest): show Create/Update instead of Write in progress events"
```

---

### Task 2: Summary text breakdown by create/update

**Files:**
- Modify: `tests/phases/ingest.test.ts` (add three tests)
- Modify: `src/phases/ingest.ts` (counts derivation + `buildIngestSummary` refactor)

- [ ] **Step 1: Write three failing tests**

Add inside `describe("runIngest", ...)` in `tests/phases/ingest.test.ts`:

```typescript
it("result text shows 'создано N стр.' when all pages are new", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === "Sources/doc.md") return "source text";
      throw new Error("not found");
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify({
    reasoning: "x",
    pages: [
      { path: "!Wiki/work/entities/A.md", content: "# A" },
      { path: "!Wiki/work/entities/B.md", content: "# B" },
    ],
  });
  const events = await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, makeLlm(llmResponse), "llama3.2",
      [domain], VAULT_ROOT, new AbortController().signal,
    ),
  );
  const result = events.find((e: any) => e.kind === "result") as any;
  expect(result?.text).toMatch(/создано 2 стр\./);
  expect(result?.text).not.toMatch(/обновлено/);
});

it("result text shows 'обновлено N стр.' when all pages exist", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === "Sources/doc.md") return "source text";
      // all wiki pages exist
      return "# existing content";
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify({
    reasoning: "x",
    pages: [{ path: "!Wiki/work/entities/Existing.md", content: "# Updated" }],
  });
  const events = await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, makeLlm(llmResponse), "llama3.2",
      [domain], VAULT_ROOT, new AbortController().signal,
    ),
  );
  const result = events.find((e: any) => e.kind === "result") as any;
  expect(result?.text).toMatch(/обновлено 1 стр\./);
  expect(result?.text).not.toMatch(/создано/);
});

it("result text shows 'создано C, обновлено U' for mixed ingest", async () => {
  const adapter = mockAdapter({
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === "Sources/doc.md") return "source text";
      if (path === "!Wiki/work/entities/Existing.md") return "# Old";
      throw new Error("not found"); // New.md does not exist
    }),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llmResponse = JSON.stringify({
    reasoning: "x",
    pages: [
      { path: "!Wiki/work/entities/New.md", content: "# New" },
      { path: "!Wiki/work/entities/Existing.md", content: "# Updated" },
    ],
  });
  const events = await collect(
    runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, makeLlm(llmResponse), "llama3.2",
      [domain], VAULT_ROOT, new AbortController().signal,
    ),
  );
  const result = events.find((e: any) => e.kind === "result") as any;
  expect(result?.text).toMatch(/создано 1, обновлено 1/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: three new tests FAIL (result.text still says "записано N стр.").

- [ ] **Step 3: Add count derivation after the write loop**

In `src/phases/ingest.ts`, find the line after the `for (const page of pages)` loop closes (currently line ~198). The `logEntries` array is already populated. Add count derivation before the `buildIngestSummary` call:

```typescript
// existing (keep)
const resultText = buildIngestSummary(domain.id, sourceVaultPath, written, pages.length);
```

Replace with:

```typescript
const createdCount = logEntries.filter(e => e.action === "СОЗДАНА").length;
const updatedCount = logEntries.filter(e => e.action === "ОБНОВЛЕНА").length;
const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, pages.length);
```

- [ ] **Step 4: Refactor `buildIngestSummary`**

Find `buildIngestSummary` at the bottom of `src/phases/ingest.ts`. Replace entirely:

```typescript
function buildIngestSummary(
  domainId: string,
  sourcePath: string,
  createdCount: number,
  updatedCount: number,
  total: number,
): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  const totalWritten = createdCount + updatedCount;
  if (totalWritten === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const skipped = total - totalWritten;
  let countStr: string;
  if (createdCount > 0 && updatedCount > 0) {
    countStr = `создано ${createdCount}, обновлено ${updatedCount}`;
  } else if (createdCount > 0) {
    countStr = `создано ${createdCount} стр.`;
  } else {
    countStr = `обновлено ${updatedCount} стр.`;
  }
  const errStr = skipped > 0 ? `, ошибок ${skipped}` : "";
  return `Источник «${src}» → домен «${domainId}»: ${countStr}${errStr}`;
}
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all tests PASS, including the three new ones and the existing "result with count=0" test.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS. No regressions in other test files.

- [ ] **Step 7: Commit**

```bash
git add tests/phases/ingest.test.ts src/phases/ingest.ts
git commit -m "feat(ingest): break down summary by created/updated count"
```
