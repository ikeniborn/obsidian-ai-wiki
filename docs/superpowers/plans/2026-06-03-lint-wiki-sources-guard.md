---
chain:
  intent: docs/superpowers/intents/2026-06-03-lint-wiki-sources-guard-intent.md
  spec: docs/superpowers/specs/2026-06-03-lint-wiki-sources-guard-design.md
review:
  plan_hash: 6da533486ae2a953
  spec_hash: 09a2b29e4e9e6f4a
  last_run: 2026-06-03
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    task_1: 75ba87ec9d25f0e8
    task_2: 48678427fb51c414
    task_3: a28bf95bb3567c08
    task_4: b8607b96cbed90ba
  findings:
    - id: F-001
      phase: dependencies
      severity: CRITICAL
      section: "### Task 1: Add `originalContent` parameter to `validateWikiSources`"
      section_hash: 75ba87ec9d25f0e8
      text: >
        Step 4 asserts "all 8 validateWikiSources cases PASS" but the 4 existing tests call
        validateWikiSources(content, knownStems, titleMap) (3 args). After Step 3 changes the
        signature to (content, originalContent, knownStems, titleMap) (4 args), those calls bind
        knownStems→originalContent (truthy Set) and titleMap→knownStems (Map), leaving
        titleMap=undefined. The isValid closure calls titleMap.has(...) → TypeError at runtime.
        No plan step updates the existing 4 test calls to pass "" as the second argument.
      verdict: fixed
      verdict_at: 2026-06-03
    - id: F-002
      phase: verifiability
      severity: CRITICAL
      section: "### Task 3: Post-loop empty-sources deletion"
      section_hash: a28bf95bb3567c08
      text: >
        Integration test setup contradicts its scenario. The test's list mock returns
        ["src/deleted_source.md"] for non-wiki paths. runLint builds knownStems from allMdPaths,
        which includes "deleted_source". validateWikiSources then treats [[deleted_source]] as
        valid (knownStems.has("deleted_source") = true), restores it from originalContent, and
        the wiki page ends up with a non-empty wiki_sources — so the post-loop deletion never
        triggers. The test would fail even with a correct implementation. Fix: the list mock
        must NOT return deleted_source.md (simulating "file deleted from vault"), so the stem
        is absent from knownStems and the entry is stripped as stale.
      verdict: fixed
      verdict_at: 2026-06-03
---
# Lint wiki_sources Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `validateWikiSources` from silently losing valid `wiki_sources` entries when the LLM returns inline `wiki_sources: []`, and delete wiki pages whose all sources have gone stale after the per-article loop.

**Architecture:** Add `originalContent` parameter to `validateWikiSources` so it can restore valid entries the LLM dropped; update the single call site in `runLint`; add a post-loop scan of `writtenPaths` that deletes pages with zero remaining sources and pushes them into `deletedRefs` so the existing backlink-rewrite machinery removes their `wiki_articles` entries.

**Tech Stack:** TypeScript, Vitest, `src/phases/lint.ts`, `tests/phases/lint.test.ts`, `lat.md/tests.md`, `lat.md/operations.md`.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `src/phases/lint.ts:89-116` | `validateWikiSources` — add `originalContent` param, restore logic |
| Modify | `src/phases/lint.ts:324-325` | call site — pass `originalContent` |
| Modify | `src/phases/lint.ts:385-392` | insert post-loop empty-sources deletion block |
| Modify | `tests/phases/lint.test.ts:1031-1061` | add 4 unit tests to `describe("validateWikiSources")` |
| Modify | `tests/phases/lint.test.ts` (end) | add integration test `describe("lint — empty-sources deletion")` |
| Modify | `lat.md/tests.md` | add `validateWikiSources` unit-test section + empty-sources integration section |
| Modify | `lat.md/operations.md` | add note about post-loop empty-sources deletion step |

---

### Task 1: Add `originalContent` parameter to `validateWikiSources`

**Files:**
- Modify: `src/phases/lint.ts:89-116`

- [ ] **Step 1: Write the failing unit tests**

Open `tests/phases/lint.test.ts` and add four new `it()` cases inside the existing `describe("validateWikiSources", () => { ... })` block (after the last existing `it(...)` at line 1059, before the closing `});` at line 1061):

```typescript
  it("LLM returned wiki_sources: [] (inline), original had valid entry → entry restored in block-list format", () => {
    const originalContent = makeContent(["[[wiki_os_pac_file]]"]);
    const llmContent = "---\nwiki_sources: []\n---\n# Article";
    const result = validateWikiSources(llmContent, originalContent, knownStems, titleMap);
    expect(result).toContain("wiki_sources:");
    expect(result).toContain("[[wiki_os_pac_file]]");
    expect(result).not.toContain("wiki_sources: []");
  });

  it("LLM reduced list (dropped one of two valid entries) → missing entry restored", () => {
    const originalContent = makeContent(["[[wiki_os_pac_file]]", "[[wiki_networking_dns]]"]);
    const llmContent = makeContent(["[[wiki_os_pac_file]]"]);
    const result = validateWikiSources(llmContent, originalContent, knownStems, titleMap);
    expect(result).toContain("[[wiki_os_pac_file]]");
    expect(result).toContain("[[wiki_networking_dns]]");
  });

  it("LLM dropped stale entry (stem absent from knownStems) → not restored", () => {
    const originalContent = makeContent(["[[wiki_os_deleted_page]]"]);
    const llmContent = makeContent([]);
    const result = validateWikiSources(llmContent, originalContent, knownStems, titleMap);
    expect(result).not.toContain("[[wiki_os_deleted_page]]");
  });

  it("originalContent is empty string → no restore; stale removal only", () => {
    const llmContent = makeContent(["[[wiki_os_deleted_page]]", "[[wiki_os_pac_file]]"]);
    const result = validateWikiSources(llmContent, "", knownStems, titleMap);
    expect(result).not.toContain("[[wiki_os_deleted_page]]");
    expect(result).toContain("[[wiki_os_pac_file]]");
  });
```

Note: `makeContent([])` must produce a block-list format with no items. Verify the existing helper:
```typescript
const makeContent = (sources: string[]) =>
  `---\nwiki_sources:\n${sources.map(s => `  - ${s}`).join("\n")}\n---\n# Article`;
```
When `sources` is `[]`, this yields `---\nwiki_sources:\n\n---\n# Article` — frontmatter with `wiki_sources:` key but no items. `parseWikiSourcesFromFm` returns `[]` for this format (regex requires at least one list line). That is the correct fixture for scenario 3.

Also in Step 1, update the **4 existing** `validateWikiSources` test calls (lines 1040, 1046, 1052, 1058) to pass `""` as the second argument so they remain valid after the signature change in Step 3:

```typescript
// line 1040 — was: validateWikiSources(content, knownStems, titleMap)
const result = validateWikiSources(content, "", knownStems, titleMap);

// line 1046 — was: validateWikiSources(content, knownStems, titleMap)
const result = validateWikiSources(content, "", knownStems, titleMap);

// line 1052 — was: validateWikiSources(content, knownStems, titleMap)
const result = validateWikiSources(content, "", knownStems, titleMap);

// line 1058 — was: validateWikiSources(content, knownStems, titleMap)
const result = validateWikiSources(content, "", knownStems, titleMap);
```

Passing `""` satisfies the spec requirement ("Existing 4 tests pass without modification" refers to test logic, not call signature). With `originalContent = ""`, the restore branch is skipped (`if (originalContent)` is false), so existing test behaviour is unchanged.

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | grep -E "validateWikiSources|FAIL|PASS|Error" | head -30
```

Expected: all 8 `validateWikiSources` calls fail — the 4 existing (now 4-arg calls against the 3-param signature) and the 4 new ones all error with wrong arity or similar.

- [ ] **Step 3: Update `validateWikiSources` signature and implement restore logic**

Replace lines 89-116 in `src/phases/lint.ts`:

```typescript
export function validateWikiSources(
  content: string,
  originalContent: string,
  knownStems: Set<string>,
  titleMap: Map<string, string>,
): string {
  const isValid = (entry: string): boolean => {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (!m) return true; // non-wikilink format: keep as-is
    const text = m[1];
    return knownStems.has(text) || titleMap.has(text.toLowerCase());
  };

  // Restore valid entries the LLM may have silently dropped or collapsed to [].
  if (originalContent) {
    const originalEntries = parseWikiSourcesFromFm(originalContent);
    const llmEntries = new Set(parseWikiSourcesFromFm(content));
    const validOriginal = originalEntries.filter(isValid);
    const missing = validOriginal.filter((e) => !llmEntries.has(e));
    if (missing.length > 0) {
      // Normalise: replace inline `wiki_sources: []` or bare `wiki_sources:` with a block list.
      const inlineEmpty = /wiki_sources:\s*\[\]\s*\n/;
      const bareKey = /wiki_sources:\s*\n(?!\s*-)/;
      if (inlineEmpty.test(content)) {
        const block = "wiki_sources:\n" + missing.map((e) => `  - ${e}`).join("\n") + "\n";
        content = content.replace(inlineEmpty, block);
      } else if (bareKey.test(content)) {
        const block = "wiki_sources:\n" + missing.map((e) => `  - ${e}`).join("\n") + "\n";
        content = content.replace(bareKey, block);
      } else {
        // Block-list exists — append missing items after the last list entry.
        const listBlockRe = /(wiki_sources:\s*\n(?:[ \t]+-[ \t]+[^\n]+\n?)+)/;
        content = content.replace(listBlockRe, (match) =>
          match.trimEnd() + "\n" + missing.map((e) => `  - ${e}`).join("\n") + "\n",
        );
      }
    }
  }

  // Remove stale entries (entries present in content that are [[...]] but not in vault).
  const entries = parseWikiSourcesFromFm(content);
  if (entries.length === 0) return content;

  const toRemove = entries.filter((e) => !isValid(e));
  if (toRemove.length === 0) return content;

  let result = content;
  for (const entry of toRemove) {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`[ \\t]+-[ \\t]+${escaped}\\n?`, ""), "");
  }
  return result;
}
```

- [ ] **Step 4: Run new unit tests to verify they pass**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | grep -E "validateWikiSources|FAIL|PASS" | head -20
```

Expected: all 8 `validateWikiSources` cases PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run 2>&1 | tail -20
```

Expected: failures only for the call-site arity mismatch in `runLint` (TypeScript will catch it; Vitest may not fail at runtime if JS is used — verify).

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add originalContent param to validateWikiSources; restore dropped valid entries"
```

---

### Task 2: Update the call site in `runLint`

**Files:**
- Modify: `src/phases/lint.ts:324-325`

- [ ] **Step 1: Update call site**

Find line 324-325 in `src/phases/lint.ts`:

```typescript
            const rawFixed = wlFixResult.fixed.get(fix.path) ?? fix.content;
            const fixedContent = validateWikiSources(rawFixed, knownStems, titleMap);
```

Replace with:

```typescript
            const rawFixed = wlFixResult.fixed.get(fix.path) ?? fix.content;
            const originalContent = pages.get(fix.path) ?? "";
            const fixedContent = validateWikiSources(rawFixed, originalContent, knownStems, titleMap);
```

`pages` is the `Map<string, string>` populated at line 166 (`await vaultTools.readAll(files)`) and kept up-to-date per-article. `fix.path` will always be present in `pages` for any article being linted; the `?? ""` fallback satisfies the spec's graceful-degradation requirement.

- [ ] **Step 2: Run full test suite**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (no arity errors remain, no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/phases/lint.ts
git commit -m "fix(lint): pass originalContent to validateWikiSources at call site"
```

---

### Task 3: Post-loop empty-sources deletion

**Files:**
- Modify: `src/phases/lint.ts` (after line 385 `// ── End per-article loop ──`)

- [ ] **Step 1: Write the failing integration test**

Add a new `describe` block at the end of `tests/phases/lint.test.ts` (after the closing `});` of `describe("validateWikiSources")`):

```typescript
describe("lint — empty-sources deletion", () => {
  it("wiki page whose only source stem is deleted from vault → page deleted; source file wiki_articles entry removed", async () => {
    // Setup:
    // - wiki_work_orphan.md references [[deleted_source]] in wiki_sources.
    // - deleted_source.md is ABSENT from the vault (not in list) — this is the "deleted from vault" scenario.
    //   Because it is absent from allMdPaths, "deleted_source" is NOT in knownStems, so
    //   validateWikiSources strips [[deleted_source]] as stale, leaving wiki_sources empty.
    // - some_source.md still exists and has wiki_articles: [[wiki_work_orphan]] (a backlink).
    //   The post-loop deletion pushes wiki_work_orphan into deletedRefs; the backlink-rewrite
    //   pass then removes [[wiki_work_orphan]] from some_source.md.
    const wikiContent = [
      "---",
      "wiki_sources:",
      "  - [[deleted_source]]",
      "---",
      "# Orphan",
    ].join("\n");
    const someSourceContent = [
      "---",
      "wiki_articles:",
      "  - [[wiki_work_orphan]]",
      "---",
      "# Some Source",
    ].join("\n");

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki"))
          return Promise.resolve({ files: ["!Wiki/work/wiki_work_orphan.md"], folders: [] });
        // deleted_source.md is intentionally absent — it was deleted from the vault.
        // some_source.md still exists and holds the wiki_articles backlink.
        return Promise.resolve({ files: ["src/some_source.md"], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/wiki_work_orphan.md") return Promise.resolve(wikiContent);
        if (path === "src/some_source.md") return Promise.resolve(someSourceContent);
        return Promise.resolve("");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    // LLM fixes the wiki page — keeps wiki_sources: [] (inline collapse).
    const fixedWikiContent = [
      "---",
      "wiki_sources: []",
      "---",
      "# Orphan",
    ].join("\n");
    const lintJson = JSON.stringify({
      reasoning: "sources gone",
      report: "ok",
      fixes: [{ path: "!Wiki/work/wiki_work_orphan.md", content: fixedWikiContent }],
      deletes: [],
    });
    const llm = makeLlm(lintJson, "{}");
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    // Wiki page must be deleted
    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/work/wiki_work_orphan.md");

    // some_source.md wiki_articles entry must be removed by the deletedRefs backlink-rewrite pass
    const sourceWrites = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([path]: [string]) => path === "src/some_source.md",
    );
    expect(sourceWrites.length).toBeGreaterThan(0);
    const lastWrite = sourceWrites[sourceWrites.length - 1][1] as string;
    expect(lastWrite).not.toContain("[[wiki_work_orphan]]");
  });
});
```

- [ ] **Step 2: Run the new integration test to verify it fails**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/phases/lint.test.ts -t "empty-sources deletion" --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `adapter.remove` not called for the wiki page (the post-loop deletion block doesn't exist yet).

- [ ] **Step 3: Insert post-loop empty-sources deletion block in `runLint`**

Find the comment `// ── End per-article loop ──` at line 385 in `src/phases/lint.ts`. Insert the following block immediately after that comment, before the skipped-articles summary:

```typescript
    // Post-loop: delete wiki pages that ended up with no valid wiki_sources.
    // These are pages whose sources all became stale — validateWikiSources stripped
    // every entry. Push them into deletedRefs so the backlink rewrite below removes
    // their wiki_articles entries from source files.
    for (const wikiPath of writtenPaths) {
      const wikiContent = pages.get(wikiPath);
      if (!wikiContent) continue;
      if (parseWikiSourcesFromFm(wikiContent).length === 0) {
        const stem = pageId(wikiPath);
        try {
          if (typeof vaultTools.remove === "function") {
            await vaultTools.remove(wikiPath);
          }
        } catch { /* non-critical — page already gone */ }
        pages.delete(wikiPath);
        deletedRefs.push({ deletedName: stem, redirectName: null });
        yield {
          kind: "info_text" as const,
          icon: "⚠️",
          summary: `Deleted empty-sources wiki page: ${stem}`,
        };
      }
    }
```

This block must appear **after** line 385 and **before** the skipped-articles summary block. The `deletedRefs` array is then consumed by the existing backlink-rewrite pass (line 392-407 in the original file) which removes `[[stem]]` from all source files.

- [ ] **Step 4: Run the integration test to verify it passes**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/phases/lint.test.ts -t "empty-sources deletion" --reporter=verbose 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): delete wiki pages with empty wiki_sources after per-article loop"
```

---

### Task 4: Update `lat.md`

**Files:**
- Modify: `lat.md/tests.md`
- Modify: `lat.md/operations.md`

- [ ] **Step 1: Add `validateWikiSources` unit-test section to `lat.md/tests.md`**

Insert a new section after `## Lint Stale Link Cleanup` (currently at line 241) and before `## Lint Bucket Repair` (currently at line 253). Add:

```markdown
## validateWikiSources Unit Tests

Unit tests for the `validateWikiSources` function in `src/phases/lint.ts`, verifying that the `originalContent` restore logic correctly recovers valid entries dropped by the LLM.

### LLM collapsed to inline empty — valid entry restored

When the LLM returns `wiki_sources: []` (inline) but `originalContent` had a valid entry, `validateWikiSources` replaces the inline form with a block list containing the missing entry.

### LLM reduced list — missing valid entry restored

When the LLM drops one of two valid entries from `wiki_sources`, the missing entry is re-added so both valid entries appear in the result.

### LLM dropped stale entry — not restored

When the LLM drops a `wiki_sources` entry whose stem is absent from `knownStems` and `titleMap`, that entry is not restored.

### Empty originalContent — no restore

When `originalContent` is `""`, no entries are restored; existing stale-removal logic still removes invalid entries from the LLM-returned content.
```

- [ ] **Step 2: Add empty-sources integration test section to `lat.md/tests.md`**

Insert a new section inside or after `## Lint Stale Link Cleanup`, as a new sub-section:

```markdown
### Empty-sources wiki page deletion

A wiki page whose only `wiki_sources` entry is stale (stem not in vault) is deleted after the per-article loop. The source file that previously referenced the wiki page via `wiki_articles` has the stale `[[wikiStem]]` entry removed by the `deletedRefs` backlink-rewrite pass.
```

- [ ] **Step 3: Update `lat.md/operations.md` — add post-loop deletion note**

In `lat.md/operations.md`, find the `### Cleanup Pass` section (line 138). After the existing `## Lint` section text (the per-article loop description and the `### Cleanup Pass` and `### Backlink Sync` subsections), add a new subsection. Find the line that reads:

```
After all articles:
- Source-file backlink rewrite (vault-wide scan for deleted article refs, skipping wiki pages)
```

Update that bullet list to include the new step:

```
After all articles:
- Post-loop empty-sources deletion — wiki pages in `writtenPaths` with zero `wiki_sources` entries after `validateWikiSources` are deleted; their stems are pushed into `deletedRefs` so the backlink rewrite removes their `wiki_articles` entries from source files.
- Source-file backlink rewrite (vault-wide scan for deleted article refs, skipping wiki pages)
```

- [ ] **Step 4: Run `lat check`**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
lat check 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lat.md/tests.md lat.md/operations.md
git commit -m "docs(lat): document validateWikiSources restore logic and empty-sources deletion"
```
