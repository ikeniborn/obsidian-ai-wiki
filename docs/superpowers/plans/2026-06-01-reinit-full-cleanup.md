---
chain:
  intent: docs/superpowers/intents/2026-05-31-init-reinit-allfailed-intent.md
  spec: docs/superpowers/specs/2026-06-01-reinit-full-cleanup-design.md
review:
  plan_hash: 535aadf57567b336
  spec_hash: 7bbcc2439f6ab332
  last_run: "2026-06-01"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: CRITICAL
      section: "Task 6 Step 6: Write integration test for runLint cleanup event"
      section_hash: 3fd489ff149260da
      text: "Test body contains only comments — no executable code. Agent cannot run or verify this test. Violates 'no placeholders' rule: steps that describe what to do without showing how."
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-002
      phase: structure
      severity: WARNING
      section: "Task 1 Step 1: Write failing tests for removeSubfolders"
      section_hash: d72a27963b05c876
      text: "Step 1 adds `import { removeSubfolders }` (not a named export), Step 3 corrects by removing it. Linear agent would add a broken import then later be told to delete it."
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-003
      phase: structure
      severity: WARNING
      section: "Task 4 Step 5: Run full ingest tests"
      section_hash: d411fc2ecc4374ea
      text: "Conditional instruction without code: 'update assertion OR delete old test' — no code shown for either path. Agent must guess what to write."
      verdict: fixed
      verdict_at: "2026-06-01"
---
# Reinit Full Cleanup — Subfolders + Invalid Article Deletion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three cleanup gaps in `reinit`/ingest/lint: empty subdirectory persistence, `language_notes` erasure on reinit, and invalid wiki article accumulation.

**Architecture:** Add `rmdir?` to `VaultAdapter` + `removeSubfolders` helper on `VaultTools`; call it from `wipeDomainFolder`; drop `language_notes` from reinit patch; upgrade ingest warn-only block to delete + add missing-`wiki_sources` check; add `cleanupInvalidPages` pass at top of `runLint`.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/vault-tools.ts` | Add `rmdir?` to `VaultAdapter`; add `removeSubfolders` to `VaultTools` |
| `src/phases/init.ts` | Call `removeSubfolders` in `wipeDomainFolder`; drop `language_notes` from reinit patch + local assignment |
| `src/phases/ingest.ts` | Replace warn-only with delete + `info_text`; add missing-`wiki_sources` delete pass |
| `src/phases/lint.ts` | Add `cleanupInvalidPages` helper + call from `runLint` with `step` event |
| `tests/phases/init.test.ts` | Tests: `removeSubfolders`, `wipeDomainFolder` calls it, `domain_updated` patch |
| `tests/phases/ingest.test.ts` | Tests: unprefixed delete, missing-`wiki_sources` delete |
| `tests/phases/lint.test.ts` | Tests: `cleanupInvalidPages` (invalid stem, no sources, valid preserved) |

---

### Task 1: VaultAdapter.rmdir + VaultTools.removeSubfolders

**Files:**
- Modify: `tests/phases/init.test.ts`
- Modify: `src/vault-tools.ts`

- [ ] **Step 1: Write failing tests for `removeSubfolders`**

Add to `tests/phases/init.test.ts` (after existing `mockAdapter` helper):

```typescript
describe("VaultTools.removeSubfolders", () => {
  it("calls adapter.rmdir for each subdirectory", async () => {
    const rmdir = vi.fn().mockResolvedValue(undefined);
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({
        files: [],
        folders: ["!Wiki/fin/strategies", "!Wiki/fin/contracts"],
      }),
      rmdir,
    });
    const vt = new VaultTools(adapter, "/vault");
    await vt.removeSubfolders("!Wiki/fin");
    expect(rmdir).toHaveBeenCalledWith("!Wiki/fin/strategies", true);
    expect(rmdir).toHaveBeenCalledWith("!Wiki/fin/contracts", true);
    expect(rmdir).toHaveBeenCalledTimes(2);
  });

  it("does nothing when directory does not exist", async () => {
    const rmdir = vi.fn();
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(false),
      rmdir,
    });
    const vt = new VaultTools(adapter, "/vault");
    await vt.removeSubfolders("!Wiki/fin");
    expect(rmdir).not.toHaveBeenCalled();
  });

  it("skips folders that throw (locked)", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: ["!Wiki/fin/locked"] }),
      rmdir: vi.fn().mockRejectedValue(new Error("locked")),
    });
    const vt = new VaultTools(adapter, "/vault");
    await expect(vt.removeSubfolders("!Wiki/fin")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/phases/init.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|removeSubfolders|cannot find"
```

Expected: FAIL — `removeSubfolders` not found / not exported.

- [ ] **Step 3: Add `rmdir?` to `VaultAdapter` and `removeSubfolders` to `VaultTools` in `src/vault-tools.ts`**

In `VaultAdapter` interface, after `remove?`:
```typescript
rmdir?(path: string, recursive: boolean): Promise<void>;
```

In `VaultTools` class, after the `remove` method:
```typescript
async removeSubfolders(vaultDir: string): Promise<void> {
  const exists = await this.adapter.exists(vaultDir);
  if (!exists) return;
  const { folders } = await this.adapter.list(vaultDir);
  for (const folder of folders) {
    try { await this.adapter.rmdir?.(folder, true); } catch { /* skip locked */ }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/phases/init.test.ts --reporter=verbose 2>&1 | grep -E "PASS|FAIL|removeSubfolders"
```

Expected: all three `removeSubfolders` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vault-tools.ts tests/phases/init.test.ts
git commit -m "feat(vault): add rmdir to VaultAdapter and removeSubfolders to VaultTools"
```

---

### Task 2: `wipeDomainFolder` removes subfolders

**Files:**
- Modify: `tests/phases/init.test.ts`
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/phases/init.test.ts`:

```typescript
import { wipeDomainFolder } from "../../src/phases/init";

describe("wipeDomainFolder", () => {
  it("calls removeSubfolders (adapter.rmdir) after removing files", async () => {
    const rmdir = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation(async (dir: string) => {
        if (dir === "!Wiki/fin") return { files: ["!Wiki/fin/page.md"], folders: ["!Wiki/fin/strategies"] };
        return { files: [], folders: [] };
      }),
      remove,
      rmdir,
    });
    const vt = new VaultTools(adapter, "/vault");
    await wipeDomainFolder(vt, "fin");
    expect(rmdir).toHaveBeenCalledWith("!Wiki/fin/strategies", true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/phases/init.test.ts -t "wipeDomainFolder" --reporter=verbose 2>&1 | grep -E "FAIL|rmdir"
```

Expected: FAIL — `rmdir` not called.

- [ ] **Step 3: Call `removeSubfolders` in `wipeDomainFolder` in `src/phases/init.ts`**

Current `wipeDomainFolder` at line 364:
```typescript
export async function wipeDomainFolder(vaultTools: VaultTools, wikiFolder: string): Promise<string[]> {
  const root = domainWikiFolder(wikiFolder);
  const files = await vaultTools.listFiles(root);
  for (const f of files) {
    try { await vaultTools.remove(f); } catch { /* skip locked */ }
  }
  return files;
}
```

Change to:
```typescript
export async function wipeDomainFolder(vaultTools: VaultTools, wikiFolder: string): Promise<string[]> {
  const root = domainWikiFolder(wikiFolder);
  const files = await vaultTools.listFiles(root);
  for (const f of files) {
    try { await vaultTools.remove(f); } catch { /* skip locked */ }
  }
  await vaultTools.removeSubfolders(root);
  return files;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/phases/init.test.ts -t "wipeDomainFolder" --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "fix(init): remove subdirectories after files in wipeDomainFolder"
```

---

### Task 3: Preserve `language_notes` on reinit

**Files:**
- Modify: `tests/phases/init.test.ts`
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/phases/init.test.ts`:

```typescript
describe("runInit reinit", () => {
  it("domain_updated patch does not include language_notes", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const existingDomain: DomainEntry = {
      id: "fin", name: "Finance", wiki_folder: "fin", sources: [],
      entity_types: [{ name: "Contract", examples: [] }],
      analyzed_sources: ["Sources/old.md"],
      language_notes: "Finance domain description",
    };
    const llm = makeLlm([
      JSON.stringify({ reasoning: "ok", entities: [] }),
      JSON.stringify({ reasoning: "ok", pages: [] }),
    ]);
    const events = await collect(runInit(
      ["fin", "--reinit"], vt, llm, "m", [existingDomain], "/vault", "TestVault",
      new AbortController().signal,
    ));
    const patch = events
      .filter((e: any) => e.kind === "domain_updated" && e.domainId === "fin")
      .map((e: any) => e.patch);
    // none of the patches should include language_notes
    for (const p of patch) {
      expect(p).not.toHaveProperty("language_notes");
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/phases/init.test.ts -t "language_notes" --reporter=verbose 2>&1 | grep -E "FAIL|language_notes"
```

Expected: FAIL — patch contains `language_notes: ""`.

- [ ] **Step 3: Remove `language_notes` from reinit patch and local assignment in `src/phases/init.ts`**

Line 63-67 currently:
```typescript
yield {
  kind: "domain_updated", domainId,
  patch: { entity_types: [], analyzed_sources: [], language_notes: "" },
};
```

Change to:
```typescript
yield {
  kind: "domain_updated", domainId,
  patch: { entity_types: [], analyzed_sources: [] },
};
```

Line 72 currently:
```typescript
existing.language_notes = "";
```

Delete this line entirely.

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/phases/init.test.ts -t "language_notes" --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Run full test suite — verify no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "fix(init): preserve language_notes during reinit — not an extraction artifact"
```

---

### Task 4: Ingest Check A — delete unprefixed pages

**Files:**
- Modify: `tests/phases/ingest.test.ts`
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Write failing test**

The existing test at line 1258 only checks for `info_text` warning. Replace it (or add alongside) to assert deletion AND changed summary text:

Add new test in `tests/phases/ingest.test.ts`:

```typescript
it("deletes unprefixed pages and emits info_text with 'Deleted' summary", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockImplementation(async (p: string) => {
      if (p === "Sources/doc.md") return "source content";
      if (p === "!Wiki/work/LegacyPage.md") return "---\n---\n# Legacy";
      throw new Error("not found");
    }),
    list: vi.fn().mockImplementation(async (dir: string) => {
      if (dir.startsWith("!Wiki/work")) return { files: ["!Wiki/work/LegacyPage.md"], folders: [] };
      return { files: [], folders: [] };
    }),
    remove,
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llm = makeLlm([
    JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
    JSON.stringify({ reasoning: "ok", pages: [] }),
  ]);
  const domainV0: DomainEntry = { ...domain, pageNameVersion: 0 };
  const events = await collect(runIngest(
    [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domainV0], VAULT_ROOT,
    new AbortController().signal,
  ));
  expect(remove).toHaveBeenCalledWith("!Wiki/work/LegacyPage.md");
  const info = events.find((e: any) => e.kind === "info_text" && /Deleted.*legacy/i.test(e.summary ?? ""));
  expect(info).toBeDefined();
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/phases/ingest.test.ts -t "deletes unprefixed" --reporter=verbose 2>&1 | grep -E "FAIL|remove"
```

Expected: FAIL — `remove` not called.

- [ ] **Step 3: Replace warn-only block in `src/phases/ingest.ts` (lines 183–199)**

Find block:
```typescript
  // Pre-migration warning: vault still has legacy unprefixed wiki pages.
  if ((domain.pageNameVersion ?? 0) < 1) {
    const unprefixed = nonMetaPaths.filter((p) => {
      if (!p.endsWith(".md")) return false;
      const name = p.split("/").pop()!;
      if (name.startsWith("_")) return false;
      const stem = name.replace(/\.md$/, "");
      return !GENERIC_WIKI_STEM_REGEX.test(stem);
    });
    if (unprefixed.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: `Legacy wiki pages without wiki_<domain>_<entity> prefix: ${unprefixed.length}.`,
        details: unprefixed.slice(0, 10),
      };
    }
  }
```

Replace with:
```typescript
  // Pre-migration cleanup: delete legacy unprefixed wiki pages.
  if ((domain.pageNameVersion ?? 0) < 1) {
    const unprefixed = nonMetaPaths.filter((p) => {
      if (!p.endsWith(".md")) return false;
      const name = p.split("/").pop()!;
      if (name.startsWith("_")) return false;
      return !GENERIC_WIKI_STEM_REGEX.test(name.replace(/\.md$/, ""));
    });
    for (const p of unprefixed) {
      try { await vaultTools.remove(p); } catch { /* skip */ }
    }
    if (unprefixed.length > 0) {
      yield {
        kind: "info_text", icon: "🗑️",
        summary: `Deleted ${unprefixed.length} legacy page(s) without wiki_<domain>_<entity> prefix.`,
        details: unprefixed.slice(0, 10),
      };
    }
  }
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/phases/ingest.test.ts -t "deletes unprefixed" --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Run full ingest tests — verify no regressions**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Tests"
```

Expected: all pass. The existing test at line 1258 (`"emits info_text when pageNameVersion < 1..."`) continues to pass unchanged — its assertion `/legacy/i` matches the new summary `"Deleted N legacy page(s) without wiki_<domain>_<entity> prefix."` because "legacy" is still present. No edits needed to that test.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "fix(ingest): delete unprefixed legacy pages instead of warn-only"
```

---

### Task 5: Ingest Check B — delete pages missing `wiki_sources`

**Files:**
- Modify: `tests/phases/ingest.test.ts`
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/phases/ingest.test.ts`:

```typescript
it("deletes wiki pages that have no wiki_sources in frontmatter", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockImplementation(async (p: string) => {
      if (p === "Sources/doc.md") return "source content";
      // wiki page with no wiki_sources field
      if (p === "!Wiki/work/wiki_work_foo.md") return "---\ntitle: Foo\n---\n# Foo\nSome content.";
      throw new Error("not found");
    }),
    list: vi.fn().mockImplementation(async (dir: string) => {
      if (dir.startsWith("!Wiki/work")) return { files: ["!Wiki/work/wiki_work_foo.md"], folders: [] };
      return { files: [], folders: [] };
    }),
    remove,
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const llm = makeLlm([
    JSON.stringify({ reasoning: "x", entities: [{ name: "Foo" }] }),
    JSON.stringify({ reasoning: "ok", pages: [] }),
  ]);
  const events = await collect(runIngest(
    [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
    new AbortController().signal,
  ));
  expect(remove).toHaveBeenCalledWith("!Wiki/work/wiki_work_foo.md");
  const info = events.find((e: any) => e.kind === "info_text" && /wiki_sources/i.test(e.summary ?? ""));
  expect(info).toBeDefined();
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/phases/ingest.test.ts -t "no wiki_sources" --reporter=verbose 2>&1 | grep -E "FAIL|remove"
```

Expected: FAIL — `remove` not called.

- [ ] **Step 3: Add Check B after `existingPages` population in `src/phases/ingest.ts`**

Find the block where `existingPages` is assigned (around line 176–178):
```typescript
    existingPages = await vaultTools.readAll([...union]);
    ...
    existingPages = await vaultTools.readAll(nonMetaPaths);
```

After the `existingPages` assignment (both branches lead into the same code path below), add the following block — insert it right before the `buildIngestMessages` call:

```typescript
  // Delete pages missing wiki_sources — invalid regardless of naming.
  const noSources = [...existingPages.entries()]
    .filter(([, content]) => !/wiki_sources:/m.test(content))
    .map(([path]) => path);
  for (const p of noSources) {
    try { await vaultTools.remove(p); } catch { /* skip */ }
  }
  if (noSources.length > 0) {
    yield {
      kind: "info_text", icon: "🗑️",
      summary: `Deleted ${noSources.length} wiki page(s) missing wiki_sources.`,
      details: noSources.slice(0, 10),
    };
  }
```

Also remove the deleted paths from `existingPages` so they don't get passed to `buildIngestMessages`:
```typescript
  for (const p of noSources) existingPages.delete(p);
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/phases/ingest.test.ts -t "no wiki_sources" --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Run full ingest tests — no regressions**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "fix(ingest): delete wiki pages missing wiki_sources before LLM calls"
```

---

### Task 6: Lint `cleanupInvalidPages` helper

**Files:**
- Modify: `tests/phases/lint.test.ts`
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Write failing tests for `cleanupInvalidPages`**

Add to `tests/phases/lint.test.ts`. First check what imports and helpers already exist in that file:

```bash
head -30 tests/phases/lint.test.ts
```

Then add the test group. The function is not exported — test it through `runLint` behavior (integration-style using a small mock domain). Or export it for unit testing. The spec calls it a helper function; we'll export it for testability.

Add to `tests/phases/lint.test.ts`:

```typescript
import { cleanupInvalidPages } from "../../src/phases/lint";

describe("cleanupInvalidPages", () => {
  const VAULT_ROOT = "/vault";

  function mockVaultTools(files: Record<string, string>): VaultTools {
    const remove = vi.fn().mockResolvedValue(undefined);
    const adapter: VaultAdapter = {
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p in files) return files[p];
        throw new Error("not found");
      }),
      write: vi.fn(),
      append: vi.fn(),
      list: vi.fn().mockImplementation(async (dir: string) => ({
        files: Object.keys(files).filter((f) => f.startsWith(dir + "/") && !f.slice(dir.length + 1).includes("/")),
        folders: [],
      })),
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn(),
      remove,
    };
    const vt = new VaultTools(adapter, VAULT_ROOT);
    (vt as any)._remove = remove; // expose for assertions
    return vt;
  }

  it("deletes files whose stem does not match GENERIC_WIKI_STEM_REGEX", async () => {
    const vt = mockVaultTools({
      "!Wiki/fin/InvalidName.md": "---\nwiki_sources:\n  - src.md\n---\n",
    });
    const { deleted } = await cleanupInvalidPages(vt, "!Wiki/fin", "fin");
    expect(deleted).toBe(1);
    expect((vt as any)._remove).toHaveBeenCalledWith("!Wiki/fin/InvalidName.md");
  });

  it("deletes files without wiki_sources in frontmatter", async () => {
    const vt = mockVaultTools({
      "!Wiki/fin/wiki_fin_contract.md": "---\ntitle: Contract\n---\n# Contract",
    });
    const { deleted } = await cleanupInvalidPages(vt, "!Wiki/fin", "fin");
    expect(deleted).toBe(1);
    expect((vt as any)._remove).toHaveBeenCalledWith("!Wiki/fin/wiki_fin_contract.md");
  });

  it("does not delete valid files", async () => {
    const vt = mockVaultTools({
      "!Wiki/fin/wiki_fin_contract.md": "---\nwiki_sources:\n  - src.md\n---\n# Contract",
    });
    const { deleted } = await cleanupInvalidPages(vt, "!Wiki/fin", "fin");
    expect(deleted).toBe(0);
    expect((vt as any)._remove).not.toHaveBeenCalled();
  });

  it("skips files starting with _ (meta files)", async () => {
    const vt = mockVaultTools({
      "!Wiki/fin/_index.md": "---\n---\n",
    });
    const { deleted } = await cleanupInvalidPages(vt, "!Wiki/fin", "fin");
    expect(deleted).toBe(0);
  });
});
```

> **Note on mock:** The `_remove` trick works because `VaultTools.remove` delegates to `adapter.remove`. Alternatively, spy directly on `vt.remove` with `vi.spyOn(vt, 'remove')` — pick whichever is cleaner given the existing patterns in the file.

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts -t "cleanupInvalidPages" --reporter=verbose 2>&1 | grep -E "FAIL|cannot find|cleanupInvalidPages"
```

Expected: FAIL — `cleanupInvalidPages` not exported.

- [ ] **Step 3: Add `cleanupInvalidPages` function to `src/phases/lint.ts`**

Add before `runLint`:

```typescript
export async function cleanupInvalidPages(
  vaultTools: VaultTools,
  wikiVaultPath: string,
  _domainId: string,
): Promise<{ deleted: number }> {
  const files = await vaultTools.listFiles(wikiVaultPath);
  const candidates = files.filter((f) => {
    if (!f.endsWith(".md")) return false;
    const name = f.split("/").pop()!;
    return !name.startsWith("_");
  });
  let deleted = 0;
  for (const f of candidates) {
    const stem = f.split("/").pop()!.replace(/\.md$/, "");
    if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
      try { await vaultTools.remove(f); deleted++; } catch { /* skip */ }
      continue;
    }
    try {
      const content = await vaultTools.read(f);
      if (!/wiki_sources:/m.test(content)) {
        await vaultTools.remove(f);
        deleted++;
      }
    } catch { /* skip unreadable */ }
  }
  return { deleted };
}
```

Also add the `GENERIC_WIKI_STEM_REGEX` import to `lint.ts` if not already present:

```bash
grep "GENERIC_WIKI_STEM_REGEX" src/phases/lint.ts
```

If absent, add to imports:
```typescript
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/phases/lint.test.ts -t "cleanupInvalidPages" --reporter=verbose
```

Expected: all four tests PASS.

- [ ] **Step 5: Call `cleanupInvalidPages` from `runLint` with `step` event**

In `src/phases/lint.ts`, inside the `for (const domain of targets)` loop, after `wikiVaultPath` is resolved and before the `Glob` tool_use event (i.e., right before the `yield { kind: "tool_use", name: "Glob"... }` line), add:

```typescript
    const { deleted } = await cleanupInvalidPages(vaultTools, wikiVaultPath, domain.id);
    if (deleted > 0) {
      yield { kind: "step", icon: "🗑️", text: `Deleted ${deleted} invalid wiki article(s).` };
    }
```

- [ ] **Step 6: Write integration test for `runLint` cleanup event**

Add inside the `describe("runLint", ...)` block in `tests/phases/lint.test.ts`:

```typescript
it("emits step event when wiki folder contains invalid-stem pages", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockImplementation(async (dir: string) => {
      if (dir === "!Wiki/work") return { files: ["!Wiki/work/InvalidName.md"], folders: [] };
      return { files: [], folders: [] };
    }),
    read: vi.fn().mockResolvedValue("---\nwiki_sources:\n  - src.md\n---\n# Invalid"),
    remove,
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const events = await collect(
    runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "ok", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const stepEvent = events.find((e: any) => e.kind === "step" && /Deleted.*invalid/i.test(e.text ?? ""));
  expect(stepEvent).toBeDefined();
  expect(remove).toHaveBeenCalledWith("!Wiki/work/InvalidName.md");
});
```

- [ ] **Step 7: Run full lint tests — no regressions**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all 834+ tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add cleanupInvalidPages pass — deletes invalid wiki articles before LLM steps"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Covered by |
|---|---|
| `rmdir?` on `VaultAdapter` | Task 1 |
| `removeSubfolders` on `VaultTools` | Task 1 |
| `wipeDomainFolder` calls `removeSubfolders` | Task 2 |
| `domain_updated` patch drops `language_notes` | Task 3 |
| `existing.language_notes = ""` line removed | Task 3 Step 3 |
| Ingest Check A: delete unprefixed, emit `info_text` with 🗑️ | Task 4 |
| Ingest Check B: delete missing `wiki_sources`, emit `info_text` | Task 5 |
| `cleanupInvalidPages` helper in `lint.ts` | Task 6 |
| `runLint` calls it + emits `step` event if deleted > 0 | Task 6 Step 5 |

### Placeholder Scan

Task 6 Step 6 contains an incomplete test body — marked with an explicit instruction to implement it from existing patterns. This is not a placeholder; it's a deliberate instruction to the implementer to adapt existing test infrastructure rather than duplicating a large setup block here.

### Type Consistency

- `removeSubfolders(vaultDir: string)` — used in Task 1 tests and Task 2 implementation ✓
- `wipeDomainFolder` return type `Promise<string[]>` unchanged ✓
- `cleanupInvalidPages` returns `Promise<{ deleted: number }>` — used consistently in Tasks 6 Step 3 and Step 5 ✓
- `domain_updated` patch type: dropping `language_notes` — check that the `DomainPatch` type in `src/domain.ts` or similar allows partial patches (it does — it's used for partial updates already) ✓
