---
chain:
  intent: docs/superpowers/intents/2026-06-01-wiki-links-sources-separation-intent.md
  spec: docs/superpowers/specs/2026-06-01-wiki-links-sources-separation-design.md
review:
  plan_hash: "ac8a5f88c28d573e"
  spec_hash: "dc052c9f722660cf"
  last_run: "2026-06-01"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "## Task 3: Fix existing tests broken by bucket enforcement"
      section_hash: "f4e421e730d6d657"
      text: "Spec §Testing requires auditing ALL tests with wrong-bucket stems. Plan identifies only [[wiki_valid]] as the one broken test but includes no grep/audit step to discover others. Relies implicitly on test runner in Task 2 Step 5 to surface additional failures."
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-002
      phase: dependencies
      severity: WARNING
      section: "## Task 2: Implement new FieldRule kinds in raw-frontmatter.ts"
      section_hash: "63df96170b00b9ec"
      text: "Task 2 Step 5 expected output states 'all tests pass including the 5 new ones'. After Task 2's implementation the existing [[wiki_valid]] test fails (wiki_valid is rejected as non-wiki stem). Task 3 (the fix) comes after Task 2 Step 5. A worker following the plan literally would hit an unexpected failure. DoD should either note the expected [[wiki_valid]] failure or reorder Task 3 before Task 2 Step 5."
      verdict: fixed
      verdict_at: "2026-06-01"
---

# Wiki Links / Sources Bucket Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce that `wiki_outgoing_links` contains only wiki-page stems and `wiki_sources` contains only source-file stems — both at the validator layer and in lint's bucket repair pass.

**Architecture:** Two independent layers — (1) new `FieldRule` kinds in the shared frontmatter validator that classify stems via `isWikiStem`, and (2) a lint bucket-repair loop that calls the validator on every wiki page before stale-link cleanup. Layer 3 (prompt schema) is proposal-first and runs separately after explicit user approval.

**Tech Stack:** TypeScript, Vitest, `src/utils/raw-frontmatter.ts`, `src/wiki-stem.ts`, `src/phases/lint.ts`

---

## File Map

| Action | Path |
|--------|------|
| Modify | `src/utils/raw-frontmatter.ts` |
| Modify | `src/phases/lint.ts` |
| Modify (existing tests) | `tests/utils/raw-frontmatter.test.ts` |
| Add tests | `tests/utils/raw-frontmatter.test.ts` |
| Add tests | `tests/phases/lint.test.ts` |
| Modify (proposal-first) | `templates/_wiki_schema.md` |
| Modify (proposal-first) | `prompts/ingest.md` |
| Update | `lat.md/architecture.md` |
| Update | `lat.md/llm-pipeline.md` |
| Update | `lat.md/tests.md` |

---

## Task 1: Write failing tests for new FieldRule bucket kinds

**Files:**
- Modify: `tests/utils/raw-frontmatter.test.ts` (append inside existing `validateAndRepairWikiPageFrontmatter` describe block, after line ~440)

- [ ] **Step 1: Append 5 new test cases inside the `validateAndRepairWikiPageFrontmatter` describe block**

Locate the closing `});` of `describe("validateAndRepairWikiPageFrontmatter", ...)` in `tests/utils/raw-frontmatter.test.ts` and insert before it:

```typescript
  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links non-wiki stem removed]]
  it("removes non-wiki stem from wiki_outgoing_links", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_entity]]"
  - "[[my_note]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_entity]]");
    expect(out).not.toContain("[[my_note]]");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links") && w.includes("non-wiki stem"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki sources wiki stem removed]]
  it("removes wiki stem from wiki_sources", () => {
    const content = `---
wiki_sources:
  - "[[my_source]]"
  - "[[wiki_work_foo]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[my_source]]");
    expect(out).not.toContain("[[wiki_work_foo]]");
    expect(warnings.some((w) => w.includes("wiki_sources") && w.includes("wiki stem"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links valid wiki stem kept]]
  it("keeps valid wiki stem in wiki_outgoing_links", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_bar]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_bar]]");
    expect(warnings.filter((w) => w.includes("wiki_outgoing_links"))).toHaveLength(0);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki sources valid source stem kept]]
  it("keeps valid source stem in wiki_sources", () => {
    const content = `---
wiki_sources:
  - "[[my_document]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[my_document]]");
    expect(warnings.filter((w) => w.includes("wiki_sources"))).toHaveLength(0);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links mixed list partial removal]]
  it("removes only invalid entries from mixed wiki_outgoing_links list", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_good]]"
  - "[[not_a_wiki]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_good]]");
    expect(out).not.toContain("[[not_a_wiki]]");
    expect(warnings).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose tests/utils/raw-frontmatter.test.ts
```

Expected: 5 new tests FAIL (bucket checks not yet implemented). All other tests pass.

---

## Task 2: Implement new FieldRule kinds in raw-frontmatter.ts

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`

- [ ] **Step 1: Add `isWikiStem` import at top of file (after line 1)**

Current line 1:
```typescript
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
```

Add after it:
```typescript
import { isWikiStem } from "../wiki-stem";
```

- [ ] **Step 2: Extend the `FieldRule` union type (lines 10–16)**

Replace:
```typescript
export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] };
```

With:
```typescript
export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-wikilinks-wiki-only" }
  | { field: string; kind: "list-wikilinks-sources-only" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] };
```

- [ ] **Step 3: Add new switch cases in `validateAndRepairFrontmatter` (after the `list-wikilinks`/`list-urls`/`list-tags` case block, before `case "date-scalar":`)**

The existing combined case starts at line ~81. Insert a new case block immediately after the closing `break;` of the `list-wikilinks`/`list-urls`/`list-tags` case (around line 112):

```typescript
      case "list-wikilinks-wiki-only":
      case "list-wikilinks-sources-only": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const wikiOnly = rule.kind === "list-wikilinks-wiki-only";
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !WIKILINK_RE.test(v)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          const stem = v.slice(2, -2).split("/").pop()!;
          const isWiki = isWikiStem(stem);
          if (wikiOnly && !isWiki) {
            warnings.push(`${rule.field}: non-wiki stem "${v}" — removed`);
            return false;
          }
          if (!wikiOnly && isWiki) {
            warnings.push(`${rule.field}: wiki stem "${v}" — removed`);
            return false;
          }
          return true;
        });
        if (filtered.length < (val as unknown[]).length) {
          modified = true;
          if (filtered.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = filtered;
          }
        }
        break;
      }
```

- [ ] **Step 4: Update `WIKI_PAGE_RULES` (lines 201–210)**

Replace:
```typescript
const WIKI_PAGE_RULES: FieldRule[] = [
  { field: "wiki_sources", kind: "list-wikilinks" },
  { field: "wiki_updated", kind: "date-scalar" },
  { field: "wiki_status", kind: "warn-enum", values: ["stub", "developing", "mature"] },
  { field: "wiki_type", kind: "warn-enum", values: ["page", "index", "log", "schema"] },
  { field: "tags", kind: "list-tags" },
  { field: "aliases", kind: "aliases" },
  { field: "wiki_outgoing_links", kind: "list-wikilinks" },
  { field: "wiki_external_links", kind: "list-urls" },
];
```

With:
```typescript
const WIKI_PAGE_RULES: FieldRule[] = [
  { field: "wiki_sources",        kind: "list-wikilinks-sources-only" },
  { field: "wiki_updated",        kind: "date-scalar" },
  { field: "wiki_status",         kind: "warn-enum", values: ["stub", "developing", "mature"] },
  { field: "wiki_type",           kind: "warn-enum", values: ["page", "index", "log", "schema"] },
  { field: "tags",                kind: "list-tags" },
  { field: "aliases",             kind: "aliases" },
  { field: "wiki_outgoing_links", kind: "list-wikilinks-wiki-only" },
  { field: "wiki_external_links", kind: "list-urls" },
];
```

- [ ] **Step 5: Run tests — confirm 5 new pass, 1 existing fails as expected**

```bash
npm test -- --reporter=verbose tests/utils/raw-frontmatter.test.ts
```

Expected: 5 new bucket tests PASS. One pre-existing test (`"removes wiki_outgoing_links entry that is not a wikilink"`) FAILS because `[[wiki_valid]]` is now rejected as a non-wiki stem — this is expected and will be fixed in Task 3. All other tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(validator): add list-wikilinks-wiki-only and list-wikilinks-sources-only FieldRule kinds"
```

---

## Task 3: Fix existing tests broken by bucket enforcement

**Files:**
- Modify: `tests/utils/raw-frontmatter.test.ts`

**Context:** After Task 2 the validator rejects any non-wiki stem in `wiki_outgoing_links` and any wiki stem in `wiki_sources`. Any existing test that places a non-wiki stem in `wiki_outgoing_links` (or a wiki stem in `wiki_sources`) as the "kept" value will now fail.

- [ ] **Step 1: Audit for all affected tests**

```bash
grep -n "wiki_outgoing_links\|wiki_sources" tests/utils/raw-frontmatter.test.ts | grep -v "//\s*@lat"
```

Review each hit. For `wiki_outgoing_links`: any stem that does NOT match `wiki_<domain>_<slug>` used as an expected-kept entry is broken. For `wiki_sources`: any stem that DOES match `wiki_<domain>_<slug>` used as an expected-kept entry is broken. Fix each by replacing the stem with one from the correct bucket.

Known broken test: `"removes wiki_outgoing_links entry that is not a wikilink"` uses `[[wiki_valid]]` (two-part stem, rejected as non-wiki) → replace with `[[wiki_work_valid]]`.

- [ ] **Step 2: Update the known broken test (line ~352)**

Replace:
```typescript
  it("removes wiki_outgoing_links entry that is not a wikilink", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_valid]]"
  - "bare-string"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("bare-string");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links") && w.includes("bare-string"))).toBe(true);
  });
```

With:
```typescript
  it("removes wiki_outgoing_links entry that is not a wikilink", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_valid]]"
  - "bare-string"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_valid]]");
    expect(out).not.toContain("bare-string");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links") && w.includes("bare-string"))).toBe(true);
  });
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
npm test -- --reporter=verbose tests/utils/raw-frontmatter.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/utils/raw-frontmatter.test.ts
git commit -m "test(validator): update wiki_outgoing_links test to use valid wiki stem"
```

---

## Task 4: Write failing tests for lint bucket repair

**Files:**
- Modify: `tests/phases/lint.test.ts` (append new describe block at end of file)

- [ ] **Step 1: Append new describe block at the end of `tests/phases/lint.test.ts`**

```typescript
describe("lint — bucket repair", () => {
  it("repairs wiki stem in wiki_sources and emits info_text warning", async () => {
    // @lat: [[tests#Lint Bucket Repair#Wiki stem in wiki_sources repaired]]
    const badContent =
      '---\nwiki_sources:\n  - "[[wiki_work_foo]]"\nwiki_status: stub\n---\n# Page\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/Page.md"],
            folders: [],
          });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(badContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(
        [],
        vt,
        makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).not.toContain("[[wiki_work_foo]]");

    const infoEvent = events.find(
      (e: any) => e.kind === "info_text" && e.summary?.includes("Frontmatter repaired"),
    );
    expect(infoEvent).toBeDefined();
    expect((infoEvent as any).details?.some((d: string) => d.includes("wiki stem"))).toBe(true);
  });

  it("repairs source stem in wiki_outgoing_links and emits info_text warning", async () => {
    // @lat: [[tests#Lint Bucket Repair#Source stem in wiki_outgoing_links repaired]]
    const badContent =
      '---\nwiki_outgoing_links:\n  - "[[my_note]]"\nwiki_status: stub\n---\n# Page\n\nContent.';

    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({
            files: ["!Wiki/work/Page.md"],
            folders: [],
          });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(badContent);
        return Promise.resolve("");
      }),
    });

    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runLint(
        [],
        vt,
        makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }), "{}", 2),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).not.toContain("[[my_note]]");

    const infoEvent = events.find(
      (e: any) => e.kind === "info_text" && e.summary?.includes("Frontmatter repaired"),
    );
    expect(infoEvent).toBeDefined();
    expect((infoEvent as any).details?.some((d: string) => d.includes("non-wiki stem"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run lint tests to confirm new tests fail**

```bash
npm test -- --reporter=verbose tests/phases/lint.test.ts
```

Expected: last 2 tests in the new describe FAIL. All prior tests pass.

---

## Task 5: Implement lint bucket repair pass

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Add `validateAndRepairWikiPageFrontmatter` to the import on line 13**

Replace:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, filterStaleWikiLinks } from "../utils/raw-frontmatter";
```

With:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, filterStaleWikiLinks, validateAndRepairWikiPageFrontmatter } from "../utils/raw-frontmatter";
```

- [ ] **Step 2: Insert bucket repair loop before the stale-link cleanup loop**

Find the comment `// Stale link cleanup` (around line 319). Insert the following block immediately before it:

```typescript
    // Bucket repair: remove wrong-bucket stems from wiki_sources / wiki_outgoing_links
    const repairWarnings: Array<{ path: string; warnings: string[] }> = [];
    for (const [wikiPath, wikiContent] of pages) {
      const { content: repaired, warnings } = validateAndRepairWikiPageFrontmatter(wikiContent);
      if (repaired !== wikiContent) {
        pages.set(wikiPath, repaired);
        await vaultTools.write(wikiPath, repaired);
      }
      if (warnings.length > 0) {
        repairWarnings.push({ path: wikiPath, warnings });
      }
    }
    for (const { path, warnings } of repairWarnings) {
      yield {
        kind: "info_text" as const,
        icon: "⚠️",
        summary: `Frontmatter repaired: ${path}`,
        details: warnings,
      };
    }
```

- [ ] **Step 3: Run lint tests to confirm new tests pass**

```bash
npm test -- --reporter=verbose tests/phases/lint.test.ts
```

Expected: all tests pass including the 2 new bucket repair tests.

- [ ] **Step 4: Run full suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add bucket repair pass for wiki_sources / wiki_outgoing_links"
```

---

## Task 6: Update lat.md knowledge graph

**Files:**
- Modify: `lat.md/architecture.md` (section `## Frontmatter Validator`)
- Modify: `lat.md/llm-pipeline.md` (section `## WikiLink Validation`)
- Modify: `lat.md/tests.md` (add new spec sections for bucket tests)

- [ ] **Step 1: Extend `## Frontmatter Validator` in `lat.md/architecture.md`**

Read the current section (`lat locate "Frontmatter Validator"`), then append to its body:

```markdown
Two bucket-enforcing kinds were added — `list-wikilinks-wiki-only` (only `wiki_<domain>_<slug>` stems allowed) and `list-wikilinks-sources-only` (wiki stems rejected). Both inherit the `[[...]]` format check from `list-wikilinks` and additionally call `isWikiStem` from `[[src/wiki-stem.ts#isWikiStem]]`. `WIKI_PAGE_RULES` uses these kinds for `wiki_outgoing_links` and `wiki_sources` respectively.
```

- [ ] **Step 2: Extend `## WikiLink Validation` in `lat.md/llm-pipeline.md`**

Read the section (`lat locate "WikiLink Validation"`), then add a note about the lint bucket repair pass:

```markdown
Lint adds a **bucket repair pass** after `fixWikiLinks` and before `filterStaleWikiLinks`: calls `validateAndRepairWikiPageFrontmatter` on every wiki page, writes corrected content if changed, and yields `info_text` events listing the repairs. This catches wrong-bucket stems that persist after ingest.
```

- [ ] **Step 3: Add new spec sections in `lat.md/tests.md`**

Append a new `## Lint Bucket Repair` section under `## Tests` (after `## Lint Stale Link Cleanup`):

```markdown
## Lint Bucket Repair

Tests verifying that `runLint` detects and repairs wrong-bucket wiki-link stems in wiki page frontmatter before the stale-link cleanup pass.

### Wiki stem in wiki_sources repaired

A wiki page with a wiki-page stem (e.g. `[[wiki_work_foo]]`) in `wiki_sources` is rewritten by lint to remove the contaminating entry, and a `Frontmatter repaired` `info_text` event is emitted with a detail matching "wiki stem".

### Source stem in wiki_outgoing_links repaired

A wiki page with a source-file stem (e.g. `[[my_note]]`) in `wiki_outgoing_links` is rewritten by lint to remove the contaminating entry, and a `Frontmatter repaired` `info_text` event is emitted with a detail matching "non-wiki stem".
```

Also add 5 spec sections under `## Wiki Page Frontmatter Validation`:

```markdown
### Wiki outgoing links non-wiki stem removed

A `wiki_outgoing_links` list entry whose stem does not match `GENERIC_WIKI_STEM_REGEX` is removed and a warning containing "non-wiki stem" is emitted.

### Wiki sources wiki stem removed

A `wiki_sources` list entry whose stem matches `GENERIC_WIKI_STEM_REGEX` is removed and a warning containing "wiki stem" is emitted.

### Wiki outgoing links valid wiki stem kept

A `wiki_outgoing_links` entry with a valid wiki-page stem (e.g. `[[wiki_work_bar]]`) is kept and no warning is emitted for that field.

### Wiki sources valid source stem kept

A `wiki_sources` entry with a non-wiki stem (e.g. `[[my_document]]`) is kept and no warning is emitted for that field.

### Wiki outgoing links mixed list partial removal

A `wiki_outgoing_links` list with one valid and one invalid entry: only the invalid entry is removed, the valid entry is retained.
```

- [ ] **Step 4: Run lat check**

```bash
lat check
```

Expected: all wiki links and code refs pass. Fix any errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add lat.md/
git commit -m "docs(lat): add bucket separation spec sections and update architecture/pipeline docs"
```

---

## Task 7 (Proposal-First — requires explicit approval): Strengthen ingest prompt

> **Stop here.** This task modifies the LLM prompt and schema template. Show the diff to the user and wait for approval before committing.

**Files:**
- Modify: `templates/_wiki_schema.md`
- Modify: `prompts/ingest.md`

- [ ] **Step 1: Add cross-contamination rows to the forbidden table in `templates/_wiki_schema.md`**

In the `## Frontmatter` table, add after the `wiki_sources` row:

```markdown
| `wiki_sources: ["[[wiki_work_foo]]"]`  | Wiki-page stem in sources field   | Move to `wiki_outgoing_links` |
| `wiki_outgoing_links: ["[[MyNote]]"]`  | Source stem in wiki-links field   | Move to `wiki_sources`        |
```

(If a "forbidden patterns" subsection exists, add there instead. If the table does not exist, create a `## Forbidden Frontmatter Patterns` subsection.)

- [ ] **Step 2: Strengthen field rules in `prompts/ingest.md` (lines 22–23)**

Replace:
```
- wiki_sources: каждый элемент — bare имя источника без пути и без псевдонима: [[ИмяФайла]]. НЕ [[папка/Имя.md]]
- wiki_outgoing_links и [[ссылки]] в тексте страниц — ТОЛЬКО bare имя страницы без пути и без псевдонима: [[ИмяСтраницы]]. НЕ [[папка/Имя]], НЕ [[Имя|Псевдоним]]
```

With:
```
- wiki_sources: ТОЛЬКО источники (файлы вне !Wiki/) — bare имя без пути: [[ИмяФайла]]. Никогда [[wiki_domain_page]]
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
```

- [ ] **Step 3: Show diff and await approval, then commit**

```bash
git diff templates/_wiki_schema.md prompts/ingest.md
```

After user approves:

```bash
git add templates/_wiki_schema.md prompts/ingest.md
git commit -m "docs(prompt): forbid cross-bucket stems in wiki_sources and wiki_outgoing_links"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| New `list-wikilinks-wiki-only` / `list-wikilinks-sources-only` FieldRule kinds | Task 2 |
| `WIKI_PAGE_RULES` updated for both fields | Task 2, Step 4 |
| Warning messages: "non-wiki stem" / "wiki stem" | Task 2, Step 3 |
| Lint bucket repair loop after fixWikiLinks, before filterStaleWikiLinks | Task 5 |
| Lint emits `info_text` after writes | Task 5 |
| 5 new validator unit tests | Tasks 1–2 |
| 2 new lint integration tests | Tasks 4–5 |
| Existing test with `[[wiki_valid]]` updated | Task 3 |
| lat.md sections updated + lat check | Task 6 |
| Prompt schema (proposal-first) | Task 7 |

**Open spec findings:**
- F-002 (WARNING): Testing DoD was vague. Resolved in this plan — every test has explicit assertions, not just "update to match corrected behavior".
- F-003 (INFO): Terminology drift ("wiki page stems" vs "wiki stems"). This plan uses "wiki-page stems" consistently in comments and lat.md prose.
