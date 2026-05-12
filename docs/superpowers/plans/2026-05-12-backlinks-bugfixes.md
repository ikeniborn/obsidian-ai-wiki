# Backlinks Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs found during code review of the raw backlinks feature: multi-domain full-replace data loss, stale `pages` snapshot, duplicate FM_RE regex, and noisy report line.

**Architecture:** Three targeted patches across two files (`lint.ts`, `ingest.ts`) and one utility (`raw-frontmatter.ts`). Each fix is independent. No new files needed.

**Tech Stack:** TypeScript, Vitest, existing VaultTools/VaultAdapter pattern.

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `src/utils/raw-frontmatter.ts` | Export `hasFrontmatterField()` helper |
| Modify | `tests/utils/raw-frontmatter.test.ts` | Tests for `hasFrontmatterField` |
| Modify | `src/phases/ingest.ts` | Use `hasFrontmatterField`, drop duplicate regex |
| Modify | `tests/phases/ingest.test.ts` | Verify no regression |
| Modify | `src/phases/lint.ts` | Union merge backlinks, refresh stale pages, suppress empty report line |
| Modify | `tests/phases/lint.test.ts` | 3 new tests |

---

## Task 1: Export `hasFrontmatterField` from `raw-frontmatter.ts` (TDD)

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1.1: Write failing test**

Append to `tests/utils/raw-frontmatter.test.ts` (after the last `describe` block):

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, hasFrontmatterField } from "../../src/utils/raw-frontmatter";
```

> **Note:** Replace the existing import line at the top of the file with this one — just add `hasFrontmatterField` to the named imports.

Then append this describe block at the end of the file:

```typescript
describe("hasFrontmatterField", () => {
  it("returns false when file has no frontmatter", () => {
    expect(hasFrontmatterField("# Content\n\nBody.", "wiki_added")).toBe(false);
  });

  it("returns false when field absent from frontmatter", () => {
    expect(hasFrontmatterField("---\ntitle: X\n---\n# Content", "wiki_added")).toBe(false);
  });

  it("returns true when field present in frontmatter", () => {
    expect(hasFrontmatterField("---\nwiki_added: 2026-01-01\n---\n# Content", "wiki_added")).toBe(true);
  });

  it("returns false when field name appears only in body, not frontmatter", () => {
    const content = "---\ntitle: X\n---\n# Content\n\nSome text with wiki_added: mention in body.";
    expect(hasFrontmatterField(content, "wiki_added")).toBe(false);
  });

  it("returns true for wiki_updated when present", () => {
    expect(hasFrontmatterField("---\nwiki_updated: 2026-05-12\n---\n", "wiki_updated")).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run tests — expect FAIL**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts
```

Expected: `hasFrontmatterField is not a function` (or export not found)

- [ ] **Step 1.3: Implement `hasFrontmatterField` in `src/utils/raw-frontmatter.ts`**

Append after `parseWikiSourcesFromFm` (end of file):

```typescript
export function hasFrontmatterField(content: string, field: string): boolean {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return false;
  return new RegExp(`^${field}:`, "m").test(fmMatch[1]);
}
```

- [ ] **Step 1.4: Run tests — expect PASS**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts
```

Expected: all tests pass (previous 11 + 5 new = 16 total).

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(raw-frontmatter): export hasFrontmatterField helper"
```

---

## Task 2: Remove duplicate FM_RE from `ingest.ts` (use `hasFrontmatterField`)

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `tests/phases/ingest.test.ts` (regression check only)

- [ ] **Step 2.1: Update import in `src/phases/ingest.ts`**

Find line 10:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "../utils/raw-frontmatter";
```

Replace with:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField } from "../utils/raw-frontmatter";
```

- [ ] **Step 2.2: Replace duplicate regex in `src/phases/ingest.ts`**

Find lines 123–125 (the `backlinkToday` / `fmMatch` / `isFirstTime` block):
```typescript
    const backlinkToday = new Date().toISOString().slice(0, 10);
    const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(sourceContent);
    const isFirstTime = fmMatch ? !/^wiki_added:/m.test(fmMatch[1]) : true;
```

Replace with:
```typescript
    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
```

- [ ] **Step 2.3: Run tests — expect PASS (regression check)**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: all 10 tests pass, no regressions.

- [ ] **Step 2.4: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "refactor(ingest): replace inline FM regex with hasFrontmatterField"
```

---

## Task 3: Fix multi-domain full-replace bug + stale `pages` + suppress empty report (TDD)

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `tests/phases/lint.test.ts`

This task fixes three related issues in `lint.ts`:
1. **Bug:** backlink sync uses full replace → multi-domain lint loses articles from earlier domains
2. **Bug:** `pages` Map is stale after fix-pass rewrites wiki pages
3. **Minor:** "Backlinks synced: 0" always appended even with no backlinks

### Step 3.1: Write 3 failing tests

- [ ] **Step 3.1: Write failing tests**

Append inside the existing `describe("runLint", ...)` block in `tests/phases/lint.test.ts`:

```typescript
  it("unions wiki_articles across two domain lint runs on same raw file", async () => {
    const wikiContentA =
      '---\nwiki_sources:\n  - "[[Sources/shared.md]]"\nwiki_status: stub\n---\n# EntityA';
    const wikiContentB =
      '---\nwiki_sources:\n  - "[[Sources/shared.md]]"\nwiki_status: stub\n---\n# EntityB';
    const domainA: DomainEntry = {
      id: "domainA", name: "Domain A", wiki_folder: "A", source_paths: [],
    };
    const domainB: DomainEntry = {
      id: "domainB", name: "Domain B", wiki_folder: "B", source_paths: [],
    };

    let rawContent = "# Shared source";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki/A")) return Promise.resolve({ files: ["!Wiki/A/EntityA.md"], folders: [] });
        if (path.includes("!Wiki/B")) return Promise.resolve({ files: ["!Wiki/B/EntityB.md"], folders: [] });
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/A/EntityA.md") return Promise.resolve(wikiContentA);
        if (path === "!Wiki/B/EntityB.md") return Promise.resolve(wikiContentB);
        if (path === "Sources/shared.md") return Promise.resolve(rawContent);
        return Promise.resolve("");
      }),
      write: vi.fn().mockImplementation((path: string, content: string) => {
        if (path === "Sources/shared.md") rawContent = content;
        return Promise.resolve();
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm("Lint OK"), "model", [domainA, domainB], VAULT_ROOT, new AbortController().signal),
    );

    expect(rawContent).toContain("[[!Wiki/A/EntityA.md]]");
    expect(rawContent).toContain("[[!Wiki/B/EntityB.md]]");
  });

  it("refreshes pages map after fix-pass so backlink sync uses updated wiki_sources", async () => {
    const originalContent = "---\nwiki_status: stub\n---\n# Page";
    const fixedContent =
      '---\nwiki_sources:\n  - "[[Sources/raw.md]]"\nwiki_status: stub\n---\n# Page';

    let fixPassCalled = false;
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") {
          // After fix-pass writes the updated content, return it
          return Promise.resolve(fixPassCalled ? fixedContent : originalContent);
        }
        if (path === "Sources/raw.md") return Promise.resolve("# Raw source");
        return Promise.resolve("");
      }),
      write: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") fixPassCalled = true;
        return Promise.resolve();
      }),
    });

    // LLM fix-pass returns a page with wiki_sources added
    const fixLlm = makeLlm(
      JSON.stringify([{ path: "!Wiki/work/Page.md", content: fixedContent }]),
    );
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, fixLlm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/raw.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("[[!Wiki/work/Page.md]]");
  });

  it("does not append backlink sync line when no wiki pages have wiki_sources", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\nwiki_status: stub\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result.text).not.toContain("Backlinks synced:");
  });
```

- [ ] **Step 3.2: Run tests — expect FAIL**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 3.3: Fix #1 — union merge in backlink sync (`src/phases/lint.ts`)**

Find line 11 (import):
```typescript
import { upsertRawFrontmatter, parseWikiSourcesFromFm } from "../utils/raw-frontmatter";
```

Replace with:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm } from "../utils/raw-frontmatter";
```

Find lines 166–172 (the try block inside the backlink sync loop):
```typescript
      try {
        const rawContent = await vaultTools.read(rawPath);
        const newContent = upsertRawFrontmatter(rawContent, {
          wiki_updated: syncToday,
          wiki_articles: [...articles],
        });
        await vaultTools.write(rawPath, newContent);
```

Replace with:
```typescript
      try {
        const rawContent = await vaultTools.read(rawPath);
        const existingArticles = parseWikiArticlesFromFm(rawContent);
        const mergedArticles = [...new Set([...existingArticles, ...articles])];
        const newContent = upsertRawFrontmatter(rawContent, {
          wiki_updated: syncToday,
          wiki_articles: mergedArticles,
        });
        await vaultTools.write(rawPath, newContent);
```

- [ ] **Step 3.4: Fix #2 — refresh stale `pages` after fix-pass (`src/phases/lint.ts`)**

Find lines 148–151 (end of fix-pass write loop and `writtenPaths` report):
```typescript
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
    }
```

Replace with:
```typescript
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
      for (const p of writtenPaths) {
        try {
          pages.set(p, await vaultTools.read(p));
        } catch { /* non-critical */ }
      }
    }
```

- [ ] **Step 3.5: Fix #3 — suppress empty backlink sync report line (`src/phases/lint.ts`)**

Find line 183:
```typescript
    reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
```

Replace with:
```typescript
    if (backlinks.size > 0) {
      reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
    }
```

- [ ] **Step 3.6: Run all tests — expect PASS**

```bash
npx vitest run
```

Expected: all tests pass (no regressions).

- [ ] **Step 3.7: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "fix(lint): union backlinks across domains, refresh pages after fix-pass, suppress empty sync line"
```

---

## Task 4: Build & version bump

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 4.1: Read current version**

```bash
node -p "require('./package.json').version"
```

- [ ] **Step 4.2: Bump patch in `package.json` and `src/manifest.json`**

Increment `X.Y.Z` → `X.Y.(Z+1)` in both files.

- [ ] **Step 4.3: Build**

```bash
npm run build
```

Expected: exits 0, `dist/main.js` updated.

- [ ] **Step 4.4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add package.json src/manifest.json dist/main.js dist/manifest.json dist/styles.css
git commit -m "chore: bump version, build — backlinks bugfixes"
```
