# Domain-Level Log and Index Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `_log.md` and `_index.md` from `!Wiki/` (root) into each domain's folder `!Wiki/{wiki_folder}/`, and make lint rebuild the domain index after each run.

**Architecture:** Minimal patch — split the single `wikiRoot` variable in ingest/query into `domainRoot` (=`wikiVaultPath`) for log/index and `schemaRoot` (=parent) for schema. Fix init to write log to domain folder and delete legacy root files on next init run. Add index rebuild to lint end-of-domain pass.

**Tech Stack:** TypeScript, Vitest, path-browserify

---

## File Map

| File | Change |
|---|---|
| `src/vault-tools.ts` | Add optional `remove?` to VaultAdapter; add `remove()` method to VaultTools |
| `src/phases/ingest.ts` | Split `wikiRoot` → `domainRoot` + `schemaRoot`; update all usages |
| `src/phases/query.ts` | Same split on line 43 |
| `src/phases/init.ts` | `ensureRootFiles`: remove index/log creation, add legacy deletion; `appendLog`: use domain folder |
| `src/phases/lint.ts` | Add index rebuild after backlink sync for each domain |
| `tests/phases/init.test.ts` | Remove old index/log creation tests; add domain-path tests |
| `tests/phases/lint.test.ts` | Add test: lint writes `_index.md` to domain folder |

---

### Task 1: Add `remove` to VaultAdapter and VaultTools

**Files:**
- Modify: `src/vault-tools.ts`

- [ ] **Step 1: Write the failing test**

Add to any test file that exercises removal — we'll use `init.test.ts` since init will call remove. But for now, just add the method; test coverage comes in Task 6. Write this test in `tests/phases/init.test.ts` in the `runInit — ensureRootFiles` describe block:

```ts
it("удаляет !Wiki/_log.md если существует (миграция)", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(path === "!Wiki/_log.md"),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const vt = new VaultTools(adapter, "/vault");
  await collect(
    runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
  );
  const removeMock = adapter.remove as ReturnType<typeof vi.fn>;
  expect(removeMock).toHaveBeenCalledWith("!Wiki/_log.md");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -20
```

Expected: FAIL — `adapter.remove` not defined / VaultTools has no `remove`.

- [ ] **Step 3: Add `remove?` to VaultAdapter interface and VaultTools**

In `src/vault-tools.ts`, update VaultAdapter interface (after `mkdir` line):

```ts
export interface VaultAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  remove?(path: string): Promise<void>;
}
```

Add method to VaultTools class (after `mkdir` method):

```ts
async remove(vaultPath: string): Promise<void> {
  await this.adapter.remove?.(vaultPath);
}
```

- [ ] **Step 4: Add `remove` to mockAdapter helper in init.test.ts**

```ts
function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

- [ ] **Step 5: Run tests — expect failure still (ensureRootFiles not yet changed)**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -20
```

Expected: test fails because `remove` is not called by `ensureRootFiles` yet.

- [ ] **Step 6: Commit VaultTools change only (not init logic yet)**

```bash
git add src/vault-tools.ts
git commit -m "feat: add optional remove() to VaultAdapter and VaultTools"
```

---

### Task 2: Fix ingest.ts — split wikiRoot into domainRoot and schemaRoot

**Files:**
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Locate the single wikiRoot line and all usages**

Open `src/phases/ingest.ts`. Find line:
```ts
const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
```

It's used in:
- `tryRead(vaultTools, `${wikiRoot}/_wiki_schema.md`)`
- `tryRead(vaultTools, `${wikiRoot}/_index.md`)`
- `appendLog(vaultTools, wikiRoot, ...)`
- `updateIndex(vaultTools, wikiRoot, ...)`

- [ ] **Step 2: Replace wikiRoot with domainRoot + schemaRoot**

Replace:
```ts
const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

const [schemaContent, indexContent] = await Promise.all([
  tryRead(vaultTools, `${wikiRoot}/_wiki_schema.md`),
  tryRead(vaultTools, `${wikiRoot}/_index.md`),
]);
```

With:
```ts
const domainRoot = wikiVaultPath;
const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

const [schemaContent, indexContent] = await Promise.all([
  tryRead(vaultTools, `${schemaRoot}/_wiki_schema.md`),
  tryRead(vaultTools, `${domainRoot}/_index.md`),
]);
```

- [ ] **Step 3: Update appendLog and updateIndex calls**

Find:
```ts
await appendLog(vaultTools, wikiRoot, sourceVaultPath, domain.id, written);
await updateIndex(vaultTools, wikiRoot, written);
```

Replace with:
```ts
await appendLog(vaultTools, domainRoot, sourceVaultPath, domain.id, written);
await updateIndex(vaultTools, domainRoot, written);
```

- [ ] **Step 4: Run ingest tests**

```bash
npx vitest run tests/phases/ingest.test.ts 2>&1 | tail -20
```

Expected: all PASS (tests don't assert on log/index paths).

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "fix: ingest writes _log.md and _index.md into domain folder, not !Wiki root"
```

---

### Task 3: Fix query.ts — same split

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Locate wikiRoot in query.ts**

Line 42-43:
```ts
const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
```

And its usages on lines 51-52:
```ts
const [indexContent, schemaContent] = await Promise.all([
  tryRead(vaultTools, `${wikiRoot}/_index.md`),
  tryRead(vaultTools, `${wikiRoot}/_wiki_schema.md`),
]);
```

- [ ] **Step 2: Apply the split**

Replace lines 42-53:
```ts
const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
const allFiles = await vaultTools.listFiles(wikiVaultPath);
const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

const [indexContent, schemaContent] = await Promise.all([
  tryRead(vaultTools, `${wikiVaultPath}/_index.md`),
  tryRead(vaultTools, `${schemaRoot}/_wiki_schema.md`),
]);
```

- [ ] **Step 3: Run query tests**

```bash
npx vitest run tests/phases/query.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/query.ts
git commit -m "fix: query reads _index.md from domain folder, not !Wiki root"
```

---

### Task 4: Fix init.ts — ensureRootFiles migration + appendLog domain path

**Files:**
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Update ensureRootFiles to delete legacy root files and not create index/log**

Find `ensureRootFiles` function (near bottom of file):

```ts
async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_wiki_schema.md`;
  const index  = `${wikiRoot}/_index.md`;
  const log    = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (!(await vaultTools.exists(index)))  await vaultTools.write(index, "# Wiki Index\n");
    if (!(await vaultTools.exists(log)))    await vaultTools.write(log, "# Wiki Log\n");
  } catch { /* не блокируем init */ }
}
```

Replace with:

```ts
async function ensureRootFiles(vaultTools: VaultTools, wikiRoot: string): Promise<void> {
  const schema = `${wikiRoot}/_wiki_schema.md`;
  const legacyIndex = `${wikiRoot}/_index.md`;
  const legacyLog   = `${wikiRoot}/_log.md`;

  try {
    if (!(await vaultTools.exists(schema))) await vaultTools.write(schema, schemaTemplate);
    if (await vaultTools.exists(legacyIndex)) await vaultTools.remove(legacyIndex);
    if (await vaultTools.exists(legacyLog))   await vaultTools.remove(legacyLog);
  } catch { /* не блокируем init */ }
}
```

- [ ] **Step 2: Update appendLog calls in runInit to use entry.wiki_folder**

Find in `runInit` function:
```ts
await appendLog(vaultTools, wikiRootGuess, domainId);
```

Replace with:
```ts
await appendLog(vaultTools, domainWikiFolder(entry.wiki_folder), domainId);
```

Note: `domainWikiFolder` is already imported in init.ts. If not, add:
```ts
import { WIKI_ROOT, domainWikiFolder } from "../wiki-path";
```

- [ ] **Step 3: Update appendLog calls in runInitWithSources to use updatedDomain.wiki_folder**

Find in `runInitWithSources` function:
```ts
await appendLog(vaultTools, wikiRootGuess, domainId);
```

Replace with:
```ts
await appendLog(vaultTools, domainWikiFolder(updatedDomain.wiki_folder), domainId);
```

- [ ] **Step 4: Update LLM context index reading in both runInit and runInitWithSources**

In `runInit`, find:
```ts
const [schemaContent, indexContent] = await Promise.all([
  tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
  tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
]);
```

Replace with (check if domain exists in `domains` list to decide which index to read):
```ts
const existingDomain = domains.find((d) => d.id === domainId);
const [schemaContent, indexContent] = await Promise.all([
  tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
  existingDomain
    ? tryRead(vaultTools, `${domainWikiFolder(existingDomain.wiki_folder)}/_index.md`)
    : Promise.resolve(""),
]);
```

Do the same replacement in `runInitWithSources` (it has an identical `Promise.all` block with `_index.md`):
```ts
const existingDomain = domains.find((d) => d.id === domainId);
const [schemaContent, indexContent] = await Promise.all([
  tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
  existingDomain
    ? tryRead(vaultTools, `${domainWikiFolder(existingDomain.wiki_folder)}/_index.md`)
    : Promise.resolve(""),
]);
```

- [ ] **Step 5: Check that `domainWikiFolder` is imported in init.ts**

Find imports at top of `src/phases/init.ts`. If `domainWikiFolder` is not imported, add it:
```ts
import { WIKI_ROOT, domainWikiFolder } from "../wiki-path";
```

If only `WIKI_ROOT` is imported, expand:
```ts
import { WIKI_ROOT, domainWikiFolder } from "../wiki-path";
```

- [ ] **Step 6: Run init tests (expect some failures — tests need updating)**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -30
```

Expected: tests about `_index.md` and `_log.md` creation will fail — that's expected, Task 6 fixes them.

- [ ] **Step 7: Commit init.ts only**

```bash
git add src/phases/init.ts
git commit -m "fix: init writes _log.md to domain folder, removes legacy root index/log"
```

---

### Task 5: Add index rebuild to lint.ts

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/phases/lint.test.ts`:

```ts
it("rebuilds _index.md in domain folder after lint run", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({
      files: ["!Wiki/work/Entity.md", "!Wiki/work/Concept.md"],
      folders: [],
    }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  await collect(
    runLint(["work"], vt, makeLlm("No issues."), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
  const indexWrite = writeCalls.find(([path]) => path === "!Wiki/work/_index.md");
  expect(indexWrite).toBeDefined();
  expect(indexWrite![1]).toContain("[[Entity]]");
  expect(indexWrite![1]).toContain("[[Concept]]");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/lint.test.ts -t "rebuilds _index.md" 2>&1 | tail -20
```

Expected: FAIL — `_index.md` write not found.

- [ ] **Step 3: Add index rebuild to lint.ts**

In `src/phases/lint.ts`, add `basename` to the path-browserify import at line 1:

```ts
import { join, basename } from "path-browserify";
```

After the backlink sync block (after `if (backlinks.size > 0) { reportParts.push(...) }` block, still inside the `for (const domain of targets)` loop), add:

```ts
const indexPath = `${wikiVaultPath}/_index.md`;
const indexLinks = files
  .map((f) => `- [[${basename(f, ".md")}]]`)
  .join("\n");
try {
  await vaultTools.write(indexPath, `# Wiki Index\n\n${indexLinks}\n`);
} catch { /* не критично */ }
```

The exact insertion point — after line 197 (`reportParts.push(\`Backlinks synced: ${syncUpdated} raw files updated\``)):

```ts
    if (backlinks.size > 0) {
      reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
    }

    // Rebuild domain index from current pages
    const indexPath = `${wikiVaultPath}/_index.md`;
    const indexLinks = files
      .map((f) => `- [[${basename(f, ".md")}]]`)
      .join("\n");
    try {
      await vaultTools.write(indexPath, `# Wiki Index\n\n${indexLinks}\n`);
    } catch { /* не критично */ }
  }  // end for (const domain of targets)
```

- [ ] **Step 4: Run lint test**

```bash
npx vitest run tests/phases/lint.test.ts -t "rebuilds _index.md" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run all lint tests**

```bash
npx vitest run tests/phases/lint.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat: lint rebuilds domain _index.md after each run"
```

---

### Task 6: Update init.test.ts

**Files:**
- Modify: `tests/phases/init.test.ts`

The existing tests check that `ensureRootFiles` creates `_index.md` and `_log.md` at root — those tests must be removed/replaced.

- [ ] **Step 1: Remove outdated tests for root index/log creation**

Delete these two test cases from `describe("runInit — ensureRootFiles")`:

- `"создаёт _index.md когда файл отсутствует"` — root `_index.md` no longer created
- `"создаёт _log.md когда файл отсутствует"` — root `_log.md` no longer created

Verify deletion worked:

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -20
```

Expected: tests for `_index.md` / `_log.md` creation gone. Migration test `"удаляет !Wiki/_log.md если существует"` (added in Task 1) should now PASS — Task 4 already added `vaultTools.remove()` calls. Other tests should pass too unless they assert on old root paths.

- [ ] **Step 2: Update "не перезаписывает существующие корневые файлы"**

That test currently checks `indexWrite` is undefined. After our change, `_wiki_schema.md` is the only root file init creates. Update:

```ts
it("не перезаписывает существующую корневую схему", async () => {
  const adapter = mockAdapter({ exists: vi.fn().mockResolvedValue(true) });
  const vt = new VaultTools(adapter, "/vault");
  await collect(
    runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
  );
  const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
  const schemaWrite = writeCalls.find(([path]) => path === "!Wiki/_wiki_schema.md");
  expect(schemaWrite).toBeUndefined(); // exists=true → not written
});
```

- [ ] **Step 3: Verify test — legacy root _log.md deleted on init**

> **Нет новой работы.** Этот тест был добавлен в Task 1 Step 1 (TDD-шаг). Убедись, что он присутствует в файле:

```ts
it("удаляет !Wiki/_log.md если существует (миграция)", ...)
```

Если по какой-то причине отсутствует — добавь:

```ts
it("удаляет !Wiki/_log.md если существует (миграция)", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(path === "!Wiki/_log.md"),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const vt = new VaultTools(adapter, "/vault");
  await collect(
    runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
  );
  expect(adapter.remove).toHaveBeenCalledWith("!Wiki/_log.md");
});
```

- [ ] **Step 4: Add test — legacy root _index.md deleted on init**

```ts
it("удаляет !Wiki/_index.md если существует (миграция)", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockImplementation((path: string) =>
      Promise.resolve(path === "!Wiki/_index.md"),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const vt = new VaultTools(adapter, "/vault");
  await collect(
    runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
  );
  expect(adapter.remove).toHaveBeenCalledWith("!Wiki/_index.md");
});
```

- [ ] **Step 5: Add test — appendLog writes to domain folder, not root**

```ts
it("appendLog пишет в папку домена, а не в корень !Wiki", async () => {
  const adapter = mockAdapter({
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
  });
  const vt = new VaultTools(adapter, "/vault");
  await collect(
    runInit(["newdomain"], vt, makeLlm(validDomainJson), "model", [], "TestVault", new AbortController().signal),
  );
  const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
  // newdomain → wiki_folder normalized to "newdomain" → log at !Wiki/newdomain/_log.md
  const logWrite = writeCalls.find(([path]) => path === "!Wiki/newdomain/_log.md");
  expect(logWrite).toBeDefined();
  expect(logWrite![1]).toContain("init");
});
```

- [ ] **Step 6: Run all init tests**

```bash
npx vitest run tests/phases/init.test.ts 2>&1 | tail -30
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/phases/init.test.ts
git commit -m "test: update init tests for domain-level log/index split"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all PASS, no regressions.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: success, no TypeScript errors.

- [ ] **Step 3: Commit if any stray changes**

```bash
git status
```

If clean — no commit needed. If any files changed:

```bash
git add src/ tests/
git commit -m "chore: cleanup after domain log/index split"
```
