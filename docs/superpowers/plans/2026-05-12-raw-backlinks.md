# Raw File Backlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `wiki_added`, `wiki_updated`, and `wiki_articles` frontmatter into raw source files during ingest (merge) and lint (full sync).

**Architecture:** New utility `src/utils/raw-frontmatter.ts` with pure functions for frontmatter manipulation via regex. `ingest.ts` calls it after writing wiki pages; `lint.ts` calls it as a final backlink-sync step using already-loaded `pages` map.

**Tech Stack:** TypeScript, Vitest, existing VaultTools/VaultAdapter pattern.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/utils/raw-frontmatter.ts` | `upsertRawFrontmatter`, `parseWikiArticlesFromFm`, `parseWikiSourcesFromFm` |
| Create | `tests/utils/raw-frontmatter.test.ts` | Unit tests for the utility |
| Modify | `src/phases/ingest.ts` | Import utility; write backlinks inside `if (written.length > 0)` |
| Modify | `tests/phases/ingest.test.ts` | 4 new tests for backlink write behaviour |
| Modify | `src/phases/lint.ts` | Import utility; add `syncBacklinks` at end of domain loop |
| Modify | `tests/phases/lint.test.ts` | 2 new tests for backlink sync behaviour |

---

## Task 1: `src/utils/raw-frontmatter.ts` — utility (TDD)

**Files:**
- Create: `src/utils/raw-frontmatter.ts`
- Create: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `tests/utils/raw-frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "../../src/utils/raw-frontmatter";

const TODAY = "2026-05-12";
const ARTICLES = ['[[!Wiki/work/Entity.md]]'];

describe("upsertRawFrontmatter", () => {
  it("prepends frontmatter when file has none", () => {
    const result = upsertRawFrontmatter("# Hello\n\nContent.", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("wiki_added: 2026-05-12");
    expect(result).toContain("wiki_updated: 2026-05-12");
    expect(result).toContain('wiki_articles:\n  - "[[!Wiki/work/Entity.md]]"');
    expect(result).toContain("# Hello\n\nContent.");
  });

  it("appends wiki fields to existing frontmatter without wiki fields", () => {
    const input = "---\ntitle: My Doc\n---\n# Content";
    const result = upsertRawFrontmatter(input, {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toContain("title: My Doc");
    expect(result).toContain("wiki_added: 2026-05-12");
    expect(result).toContain("# Content");
  });

  it("replaces existing wiki_articles with new list", () => {
    const input =
      '---\nwiki_articles:\n  - "[[!Wiki/work/Old.md]]"\n---\n# Content';
    const result = upsertRawFrontmatter(input, {
      wiki_updated: TODAY,
      wiki_articles: ["[[!Wiki/work/Old.md]]", "[[!Wiki/work/New.md]]"],
    });
    expect(result).toContain('- "[[!Wiki/work/Old.md]]"');
    expect(result).toContain('- "[[!Wiki/work/New.md]]"');
    // Exactly one occurrence of Old.md
    expect(result.split("Old.md").length - 1).toBe(1);
  });

  it("preserves existing wiki_added when fields.wiki_added is undefined", () => {
    const input =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[!Wiki/work/A.md]]"\n---\n# Content';
    const result = upsertRawFrontmatter(input, {
      wiki_added: undefined,
      wiki_updated: TODAY,
      wiki_articles: ["[[!Wiki/work/A.md]]"],
    });
    expect(result).toContain("wiki_added: 2026-01-01");
    expect(result).not.toContain("wiki_added: 2026-05-12");
  });

  it("writes wiki_added when provided and absent from existing FM", () => {
    const input = "---\ntitle: X\n---\n";
    const result = upsertRawFrontmatter(input, {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toContain("wiki_added: 2026-05-12");
  });

  it("handles empty file", () => {
    const result = upsertRawFrontmatter("", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("wiki_added: 2026-05-12");
  });

  it("omits wiki_articles key when list is empty", () => {
    const result = upsertRawFrontmatter("# Content", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: [],
    });
    expect(result).not.toContain("wiki_articles:");
  });
});

describe("parseWikiArticlesFromFm", () => {
  it("returns empty array when no wiki_articles field", () => {
    expect(parseWikiArticlesFromFm("---\ntitle: X\n---\n")).toEqual([]);
  });

  it("extracts wikilinks from wiki_articles block", () => {
    const content =
      '---\nwiki_articles:\n  - "[[!Wiki/work/A.md]]"\n  - "[[!Wiki/work/B.md]]"\n---\n';
    expect(parseWikiArticlesFromFm(content)).toEqual([
      "[[!Wiki/work/A.md]]",
      "[[!Wiki/work/B.md]]",
    ]);
  });
});
```

- [ ] **Step 1.2: Run tests — expect FAIL**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts
```

Expected: `Cannot find module '../../src/utils/raw-frontmatter'`

- [ ] **Step 1.3: Implement `src/utils/raw-frontmatter.ts`**

```typescript
const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function removeWikiFields(yaml: string): string {
  yaml = yaml.replace(/^wiki_added:[^\n]*\n?/m, "");
  yaml = yaml.replace(/^wiki_updated:[^\n]*\n?/m, "");
  yaml = yaml.replace(/^wiki_articles:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*/m, "");
  return yaml;
}

function buildWikiFields(fields: {
  wiki_added?: string;
  wiki_updated: string;
  wiki_articles: string[];
}): string {
  const lines: string[] = [];
  if (fields.wiki_added !== undefined) {
    lines.push(`wiki_added: ${fields.wiki_added}`);
  }
  lines.push(`wiki_updated: ${fields.wiki_updated}`);
  if (fields.wiki_articles.length > 0) {
    lines.push("wiki_articles:");
    for (const a of fields.wiki_articles) {
      lines.push(`  - "${a}"`);
    }
  }
  return lines.join("\n");
}

export function upsertRawFrontmatter(
  content: string,
  fields: {
    wiki_added?: string;
    wiki_updated: string;
    wiki_articles: string[];
  },
): string {
  const newFields = buildWikiFields(fields);
  const match = FM_RE.exec(content);

  if (match) {
    const cleaned = removeWikiFields(match[1]).trimEnd();
    const newYaml = cleaned ? `${cleaned}\n${newFields}` : newFields;
    const rest = content.slice(match[0].length);
    return `---\n${newYaml}\n---\n${rest}`;
  }

  return `---\n${newFields}\n---\n${content}`;
}

export function parseWikiArticlesFromFm(content: string): string[] {
  const match = /wiki_articles:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(content);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}

export function parseWikiSourcesFromFm(content: string): string[] {
  const match = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(content);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}
```

- [ ] **Step 1.4: Run tests — expect PASS**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat: add raw-frontmatter utility — upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm"
```

---

## Task 2: `ingest.ts` — backlink write after wiki pages saved

**Files:**
- Modify: `src/phases/ingest.ts` (add import + ~15 lines inside `if (written.length > 0)`)
- Modify: `tests/phases/ingest.test.ts` (4 new tests)

- [ ] **Step 2.1: Write failing tests**

Append to `tests/phases/ingest.test.ts` (inside the existing `describe("runIngest", ...)` block):

```typescript
  it("writes backlinks frontmatter to raw file after successful ingest", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity\n\nFact." },
    ]);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added:");
    expect(writtenContent).toContain("wiki_updated:");
    expect(writtenContent).toContain("wiki_articles:");
    expect(writtenContent).toContain("[[!Wiki/work/Entity.md]]");
  });

  it("preserves wiki_added and unions wiki_articles on repeated ingest", async () => {
    const existingFm =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[!Wiki/work/Old.md]]"\n---\nsource text';
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue(existingFm),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/New.md", content: "# New" },
    ]);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_added: 2026-01-01"); // preserved
    expect(writtenContent).toContain("[[!Wiki/work/Old.md]]");  // union
    expect(writtenContent).toContain("[[!Wiki/work/New.md]]");  // union
  });

  it("does not write backlinks when no wiki pages were written", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm("[]"),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/doc.md",
    );
    expect(rawCall).toBeUndefined();
  });

  it("does not fail ingest when raw file backlink write throws", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      write: vi.fn().mockImplementation((path: string) => {
        if (path === "Sources/doc.md") {
          return Promise.reject(new Error("permission denied"));
        }
        return Promise.resolve();
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify([
      { path: "!Wiki/work/Entity.md", content: "# Entity" },
    ]);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    const failEvent = events.find(
      (e: any) =>
        e.kind === "tool_result" &&
        e.ok === false &&
        (e.preview as string)?.includes("backlink write failed"),
    );
    expect(failEvent).toBeDefined();
  });
```

- [ ] **Step 2.2: Run tests — expect FAIL**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: 4 new tests fail (no backlink write code yet).

- [ ] **Step 2.3: Add import to `src/phases/ingest.ts`**

At the top of `src/phases/ingest.ts`, after existing imports, add:

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "../utils/raw-frontmatter";
```

- [ ] **Step 2.4: Add backlink write inside `if (written.length > 0)` in `src/phases/ingest.ts`**

Find the block at lines 118–124:

```typescript
  if (written.length > 0) {
    await appendLog(vaultTools, wikiRoot, sourceVaultPath, domain.id, written);
    await updateIndex(vaultTools, wikiRoot, written);

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }
```

Replace with:

```typescript
  if (written.length > 0) {
    await appendLog(vaultTools, wikiRoot, sourceVaultPath, domain.id, written);
    await updateIndex(vaultTools, wikiRoot, written);

    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !sourceContent.includes("wiki_added:");
    const existingArticles = parseWikiArticlesFromFm(sourceContent);
    const writtenLinks = written.map((p) => `[[${p}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    yield { kind: "tool_use", name: "Write", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, updatedSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }
```

- [ ] **Step 2.5: Run all tests — expect PASS**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts tests/phases/ingest.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): write wiki_added/wiki_updated/wiki_articles backlinks to raw file"
```

---

## Task 3: `lint.ts` — full backlink sync

**Files:**
- Modify: `src/phases/lint.ts` (add import + `syncBacklinks` at end of domain loop)
- Modify: `tests/phases/lint.test.ts` (2 new tests)

- [ ] **Step 3.1: Write failing tests**

Append to `tests/phases/lint.test.ts` (inside the existing `describe("runLint", ...)` block):

```typescript
  it("syncs wiki_articles backlinks to raw files during lint", async () => {
    const wikiContent =
      '---\nwiki_sources:\n  - "[[Sources/raw.md]]"\nwiki_status: stub\n---\n# Entity\n\nContent.';
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Entity.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Entity.md") return Promise.resolve(wikiContent);
        if (path === "Sources/raw.md") return Promise.resolve("# Raw\n\nContent.");
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const rawCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "Sources/raw.md",
    );
    expect(rawCall).toBeDefined();
    const writtenContent = rawCall![1] as string;
    expect(writtenContent).toContain("wiki_articles:");
    expect(writtenContent).toContain("[[!Wiki/work/Entity.md]]");
  });

  it("does not fail lint when raw file read throws during sync", async () => {
    const wikiContent =
      '---\nwiki_sources:\n  - "[[Sources/missing.md]]"\nwiki_status: stub\n---\n# Entity';
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Entity.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Entity.md") return Promise.resolve(wikiContent);
        if (path === "Sources/missing.md") return Promise.reject(new Error("not found"));
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint([], vt, makeLlm("Lint OK"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });
```

- [ ] **Step 3.2: Run tests — expect FAIL**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 3.3: Add import to `src/phases/lint.ts`**

After the last existing import line, add:

```typescript
import { upsertRawFrontmatter, parseWikiSourcesFromFm } from "../utils/raw-frontmatter";
```

- [ ] **Step 3.4: Add backlink sync at end of domain loop in `src/phases/lint.ts`**

Find this block near line 148–151:

```typescript
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
    }
  }
```

Replace with:

```typescript
    if (writtenPaths.length > 0) {
      reportParts.push(`### Исправлено страниц: ${writtenPaths.length}\n${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
    }

    // Backlink full sync — uses already-loaded pages map, no extra reads for wiki files
    const backlinks = new Map<string, Set<string>>();
    for (const [wikiPath, wikiContent] of pages) {
      for (const src of parseWikiSourcesFromFm(wikiContent)) {
        const rawPath = src.slice(2, -2); // strip [[ and ]]
        if (!backlinks.has(rawPath)) backlinks.set(rawPath, new Set());
        backlinks.get(rawPath)!.add(`[[${wikiPath}]]`);
      }
    }

    const syncToday = new Date().toISOString().slice(0, 10);
    let syncUpdated = 0;
    for (const [rawPath, articles] of backlinks) {
      yield { kind: "tool_use", name: "Write", input: { path: rawPath } };
      try {
        const rawContent = await vaultTools.read(rawPath);
        const newContent = upsertRawFrontmatter(rawContent, {
          wiki_updated: syncToday,
          wiki_articles: [...articles],
        });
        await vaultTools.write(rawPath, newContent);
        syncUpdated++;
        yield { kind: "tool_result", ok: true, preview: rawPath };
      } catch (e) {
        yield {
          kind: "tool_result",
          ok: false,
          preview: `backlink sync failed: ${rawPath}: ${(e as Error).message}`,
        };
      }
    }
    reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
  }
```

- [ ] **Step 3.5: Run all tests — expect PASS**

```bash
npx vitest run
```

Expected: all tests pass (no regressions).

- [ ] **Step 3.6: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): full backlink sync — write wiki_articles to raw source files"
```

---

## Task 4: Build & version bump

**Files:**
- Modify: `package.json` (patch version bump)
- Modify: `src/manifest.json` (patch version bump)

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
git commit -m "chore: bump version, build — raw backlinks feature"
```
