# Remove Content Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all hard-coded `.slice(0, N)` truncation from LLM prompt construction across init, ingest, lint, and query phases; replace init's truncation warning with an informational size log.

**Architecture:** Surgical edits in 4 phase files and 1 test file. No new abstractions. `buildContextBlock` in query.ts loses its `maxChars` parameter entirely — its constant `MAX_CONTEXT_CHARS` and all related break/slice logic are deleted.

**Tech Stack:** TypeScript, vitest

---

### Task 1: Update tests to expect informational log instead of truncation warning

**Files:**
- Modify: `tests/phases/init.test.ts:483-508`

- [ ] **Step 1: Replace the two truncation-warning tests**

Replace lines 483–508 in `tests/phases/init.test.ts`:

```typescript
  it("emits informational size log for every file processed", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const info = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("ℹ src/a.md:") && e.delta?.includes("chars")
    ) as any;
    expect(info).toBeDefined();
  });

  it("does NOT emit truncation warning for large files", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const warning = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("truncated to 8 000 chars")
    );
    expect(warning).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/init.test.ts
```

Expected: 2 failures — informational log not found / truncation warning still present.

---

### Task 2: Fix `src/phases/init.ts`

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Fix initial system prompt (lines 76–77, 89)**

Replace line 76:
```typescript
    schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent}` : "",
```

Replace line 77:
```typescript
    index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent}` : "",
```

Replace line 89:
```typescript
        [...samples.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n"),
```

- [ ] **Step 2: Replace truncation block with info log (lines 232–235)**

Remove lines 232–235:
```typescript
    if (fileContent.length > 8_000) {
      yield { kind: "assistant_text", delta: `⚠ ${file}: truncated to 8 000 chars (original: ${fileContent.length} chars)\n` };
    }
    const truncated = fileContent.slice(0, 8_000);
```

Replace with:
```typescript
    yield { kind: "assistant_text", delta: `ℹ ${file}: ${fileContent.length} chars\n` };
```

- [ ] **Step 3: Fix schema/index slices in the main loop (lines 242–243)**

Replace line 242:
```typescript
        schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent}` : "",
```

Replace line 243:
```typescript
        index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent}` : "",
```

- [ ] **Step 4: Replace all `truncated` usages with `fileContent`**

Line 250 — replace:
```typescript
          content: `Domain ID: ${domainId}\nVault name: ${vaultName}\nSource paths: ${sourcePaths.join(", ")}\n\n${file}:\n${fileContent}`,
```

Line 329 — replace:
```typescript
          content: `Текущие entity_types:\n${JSON.stringify(currentEntityTypes, null, 2)}\n\nФайл: ${file}\n\n${fileContent}`,
```

- [ ] **Step 5: Run init tests**

```bash
npx vitest run tests/phases/init.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "fix(init): remove content truncation, add informational size log"
```

---

### Task 3: Fix `src/phases/ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Remove all content slices**

Replace line 259:
```typescript
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n")
```

Replace line 272:
```typescript
    schema_block: schemaContent ? `КОНВЕНЦИИ (_wiki_schema.md):\n${schemaContent}` : "",
```

Replace line 285:
```typescript
        sourceContent,
```

Replace line 288:
```typescript
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent}` : "",
```

- [ ] **Step 2: Run ingest tests**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "fix(ingest): remove content truncation"
```

---

### Task 4: Fix `src/phases/lint.ts`

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Remove all content slices**

Replace line 59:
```typescript
    const graphIssues = checkGraphStructure(graph, hubThreshold);
```

Replace line 78:
```typescript
          `Wiki-страницы:\n${[...pages.entries()].map(([p, c]) => `--- ${p} ---\n${c}`).join("\n\n")}`,
```

Replace line 298 (in `evaluateEntityTypes`):
```typescript
    .map(([p, c]) => `${p}:\n${c}`)
```

- [ ] **Step 2: Run lint tests**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/phases/lint.ts
git commit -m "fix(lint): remove content truncation"
```

---

### Task 5: Fix `src/phases/query.ts`

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Remove schema/index slices in system prompt (lines 79–80)**

Replace line 79:
```typescript
    schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
```

Replace line 80:
```typescript
    index_block: indexContent ? `\nВики-индекс (_index.md):\n${indexContent}` : "",
```

- [ ] **Step 2: Remove indexContent slice in seed selection (line 169)**

Replace line 169:
```typescript
    indexContent ? `\nIndex:\n${indexContent}` : "",
```

- [ ] **Step 3: Remove `MAX_CONTEXT_CHARS` constant (line 11)**

Delete:
```typescript
const MAX_CONTEXT_CHARS = 80_000;
```

- [ ] **Step 4: Update `buildContextBlock` call site (line 72)**

Replace:
```typescript
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds);
```

- [ ] **Step 5: Refactor `buildContextBlock` — remove `maxChars` parameter**

Replace the entire function (lines 193–219):
```typescript
function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
): string {
  const seedPages: [string, string][] = [];
  const bfsPages: [string, string][] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    if (!selectedIds.has(id)) continue;
    if (seeds.has(id)) seedPages.push([path, content]);
    else bfsPages.push([path, content]);
  }
  const ordered = [...seedPages, ...bfsPages];
  let block = "";
  for (const [p, c] of ordered) {
    block += `--- ${p} ---\n${c}\n\n`;
  }
  return block;
}
```

- [ ] **Step 6: Run query tests**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/phases/query.ts
git commit -m "fix(query): remove content truncation, drop MAX_CONTEXT_CHARS from buildContextBlock"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all pass, zero truncation-related failures.

- [ ] **Step 2: Verify no content-slicing slice calls remain**

```bash
grep -n "\.slice(0," src/phases/init.ts src/phases/ingest.ts src/phases/lint.ts src/phases/query.ts
```

Expected: no output (zero matches on content slices in these files). If any remain, fix them before proceeding.
