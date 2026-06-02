---
chain:
  intent: docs/superpowers/intents/2026-06-02-init-wiki-sources-annotation-intent.md
  spec: docs/superpowers/specs/2026-06-02-init-wiki-sources-annotation-design.md
review:
  plan_hash: "ed760da259e9033d"
  spec_hash: "b31854f048bf459d"
  last_run: "2026-06-02"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Fix init — missing wiki_sources and redundant annotation in frontmatter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two ingest pipeline bugs: strip `annotation` from wiki page frontmatter, and inject `wiki_sources` when the LLM omits it.

**Architecture:** Add a `"remove"` kind to the `FieldRule` discriminated union to strip forbidden fields during repair; add a new `ensureWikiSources` function that injects the source stem when `wiki_sources` is absent after repair; wire both into the per-page write loop in `ingest.ts`; add a one-line prohibition to two prompt files.

**Tech Stack:** TypeScript, yaml (already imported), Vitest

---

## File Map

| File | Change |
|---|---|
| `src/utils/raw-frontmatter.ts` | Add `"remove"` to `FieldRule`, handle in switch, add `annotation` to `WIKI_PAGE_RULES`, add `ensureWikiSources` export |
| `src/phases/ingest.ts` | Import `ensureWikiSources`; replace write block to call it after repair |
| `prompts/ingest.md` | Add one-line annotation prohibition |
| `prompts/lint.md` | Add one-line annotation prohibition |
| `tests/utils/raw-frontmatter.test.ts` | Add tests for `"remove"` kind and `ensureWikiSources` |
| `tests/phases/ingest.test.ts` | Add integration tests for annotation strip + wiki_sources injection |
| `lat.md/tests.md` | Add spec sections for new tests |

---

### Task 1: Add `"remove"` FieldRule kind + annotation rule — unit tests first

**Files:**
- Modify: `tests/utils/raw-frontmatter.test.ts` (after existing `validateAndRepairWikiPageFrontmatter` tests)
- Modify: `src/utils/raw-frontmatter.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("validateAndRepairWikiPageFrontmatter", ...)` in `tests/utils/raw-frontmatter.test.ts`:

```ts
// @lat: [[tests#Wiki Page Frontmatter Validation#Annotation field strip]]
it("strips annotation field from wiki page frontmatter", () => {
  const content = `---\nwiki_sources:\n  - "[[my_source]]"\nannotation: "some text"\n---\n# Page\n`;
  const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
  expect(out).not.toContain("annotation:");
  expect(warnings.some((w) => w.includes("annotation"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `annotation:` still present in output.

- [ ] **Step 3: Add `"remove"` to `FieldRule` union in `src/utils/raw-frontmatter.ts`**

In the `export type FieldRule` union (line ~11), append:

```ts
  | { field: string; kind: "remove" };
```

So the type becomes:
```ts
export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-wikilinks-wiki-only" }
  | { field: string; kind: "list-wikilinks-sources-only" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] }
  | { field: string; kind: "remove" };
```

- [ ] **Step 4: Handle `"remove"` in `validateAndRepairFrontmatter` switch**

Add as the last case inside the `switch (rule.kind)` block (after `"warn-enum"`, before closing `}`):

```ts
      case "remove": {
        if (rule.field in parsed) {
          warnings.push(`${rule.field}: field not allowed in wiki page frontmatter — removed`);
          delete parsed[rule.field];
          modified = true;
        }
        break;
      }
```

- [ ] **Step 5: Add `annotation` rule to `WIKI_PAGE_RULES`**

In the `WIKI_PAGE_RULES` array (line ~240), append before the closing `]`:

```ts
  { field: "annotation", kind: "remove" },
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(frontmatter): add remove FieldRule kind, strip annotation from wiki pages"
```

---

### Task 2: Add `ensureWikiSources` — unit tests first

**Files:**
- Modify: `tests/utils/raw-frontmatter.test.ts`
- Modify: `src/utils/raw-frontmatter.ts`

- [ ] **Step 1: Add `ensureWikiSources` to the import in the test file**

In `tests/utils/raw-frontmatter.test.ts`, update the second import line (line ~3) to include `ensureWikiSources`:

```ts
import { validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, ensureWikiSources } from "../../src/utils/raw-frontmatter";
```

- [ ] **Step 2: Write failing tests**

Add a new `describe` block at the end of `tests/utils/raw-frontmatter.test.ts`:

```ts
describe("ensureWikiSources", () => {
  // @lat: [[tests#Ensure Wiki Sources#Absent wiki_sources injected]]
  it("injects sourceStem when wiki_sources absent", () => {
    const content = `---\nwiki_updated: 2026-06-01\nwiki_status: stub\ntags: []\n---\n# Entity\n`;
    const { content: out, injected } = ensureWikiSources(content, "my_source");
    expect(injected).toBe(true);
    expect(out).toContain("wiki_sources:");
    expect(out).toContain("[[my_source]]");
  });

  // @lat: [[tests#Ensure Wiki Sources#Non-empty wiki_sources unchanged]]
  it("returns unchanged content when wiki_sources already has entries", () => {
    const content = `---\nwiki_sources:\n  - "[[my_source]]"\nwiki_updated: 2026-06-01\n---\n# Entity\n`;
    const { content: out, injected } = ensureWikiSources(content, "my_source");
    expect(injected).toBe(false);
    expect(out).toBe(content);
  });

  // @lat: [[tests#Ensure Wiki Sources#Empty wiki_sources after repair injected]]
  it("injects sourceStem when wiki_sources field is absent after repair emptied it", () => {
    // Simulates content where repair has already deleted the wiki_sources field
    // (all prior entries were wiki stems — removed by list-wikilinks-sources-only rule).
    // From ensureWikiSources perspective: no wiki_sources present.
    const content = `---\nwiki_updated: 2026-06-01\nwiki_status: stub\n---\n# Entity\n`;
    const { content: out, injected } = ensureWikiSources(content, "raw_source");
    expect(injected).toBe(true);
    expect(out).toContain("[[raw_source]]");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `ensureWikiSources` not exported.

- [ ] **Step 4: Implement `ensureWikiSources` in `src/utils/raw-frontmatter.ts`**

Add after the `parseWikiSourcesFromFm` function (line ~304):

```ts
export function ensureWikiSources(
  content: string,
  sourceStem: string,
): { content: string; injected: boolean } {
  const sources = parseWikiSourcesFromFm(content);
  if (sources.length > 0) return { content, injected: false };

  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, injected: false };

  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, injected: false };
  }

  const body = content.slice(fmMatch[0].length);
  parsed.wiki_sources = [`[[${sourceStem}]]`];
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, injected: true };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(frontmatter): add ensureWikiSources — inject sourceStem when wiki_sources absent"
```

---

### Task 3: Wire `ensureWikiSources` in ingest pipeline — integration tests first

**Files:**
- Modify: `tests/phases/ingest.test.ts`
- Modify: `src/phases/ingest.ts`

- [ ] **Step 1: Write failing integration tests**

Add these two tests inside `describe("runIngest", ...)` in `tests/phases/ingest.test.ts`:

```ts
  it("injects wiki_sources when LLM omits it from frontmatter", async () => {
    const pageContent =
      `---\nwiki_updated: 2026-06-01\nwiki_status: stub\ntags: []\nwiki_outgoing_links: []\n---\n# Entity\n\nFact.`;
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: pageContent }],
      }),
    ]);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, llm, "llama3.2", [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const writtenContent = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/entities/wiki_work_entity.md",
    )?.[1] as string | undefined;
    expect(writtenContent).toBeDefined();
    expect(writtenContent).toContain("wiki_sources:");
    expect(writtenContent).toContain("[[doc]]");
  });

  it("strips annotation from wiki page frontmatter during ingest", async () => {
    const pageContent =
      `---\nwiki_sources:\n  - "[[doc]]"\nwiki_updated: 2026-06-01\nwiki_status: stub\nannotation: Entity description.\ntags: []\nwiki_outgoing_links: []\n---\n# Entity\n\nFact.`;
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "entities", entities: [{ name: "Entity" }] }),
      JSON.stringify({
        reasoning: "Extracted.",
        pages: [{ path: "!Wiki/work/entities/wiki_work_entity.md", content: pageContent }],
      }),
    ]);
    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, llm, "llama3.2", [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const writtenContent = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/entities/wiki_work_entity.md",
    )?.[1] as string | undefined;
    expect(writtenContent).toBeDefined();
    expect(writtenContent).not.toContain("annotation:");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — wiki_sources not injected, annotation still present.

- [ ] **Step 3: Add `ensureWikiSources` to import in `src/phases/ingest.ts`**

In `src/phases/ingest.ts` line 16, add `ensureWikiSources` to the import:

```ts
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField, validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, filterStaleWikiLinks, ensureWikiSources } from "../utils/raw-frontmatter";
```

- [ ] **Step 4: Replace the repair + write block in `src/phases/ingest.ts`**

Find this block (lines ~326–338):

```ts
    const { content: repairedPage, warnings: pageWarnings } =
      validateAndRepairWikiPageFrontmatter(page.content);
    if (pageWarnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: `Frontmatter repaired: ${page.path}`,
        details: pageWarnings,
      };
    }
    yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, repairedPage);
```

Replace with:

```ts
    const { content: repairedPage, warnings: pageWarnings } =
      validateAndRepairWikiPageFrontmatter(page.content);
    if (pageWarnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: `Frontmatter repaired: ${page.path}`,
        details: pageWarnings,
      };
    }
    const sourceStem = sourceVaultPath.split("/").pop()!.replace(/\.md$/, "");
    const { content: sourcedPage, injected } = ensureWikiSources(repairedPage, sourceStem);
    if (injected) {
      yield {
        kind: "info_text", icon: "⚠️",
        summary: `wiki_sources injected: ${page.path}`,
        details: [`Added [[${sourceStem}]] — LLM did not emit wiki_sources`],
      };
    }
    yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, sourcedPage);
```

- [ ] **Step 5: Run integration tests to verify they pass**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all PASS including the two new tests.

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): inject wiki_sources when absent, strip annotation from frontmatter"
```

---

### Task 4: Add annotation prohibition to prompts

**Files:**
- Modify: `prompts/ingest.md`
- Modify: `prompts/lint.md`

- [ ] **Step 1: Add prohibition to `prompts/ingest.md`**

After line 31 (`- Для каждой страницы добавь поле "annotation" в JSON: ...`), insert:

```
- Поле `annotation` — ТОЛЬКО в JSON-ответе. НЕ добавляй `annotation:` во frontmatter страницы.
```

- [ ] **Step 2: Add prohibition to `prompts/lint.md`**

After line 9 (`- "annotation": одно предложение — описание сущности для поиска по смыслу`), insert:

```
- Поле `annotation` — ТОЛЬКО в JSON-ответе. НЕ добавляй `annotation:` во frontmatter страницы.
```

- [ ] **Step 3: Commit**

```bash
git add prompts/ingest.md prompts/lint.md
git commit -m "docs(prompts): prohibit annotation in wiki page frontmatter"
```

---

### Task 5: Update lat.md spec + run lat check

**Files:**
- Modify: `lat.md/tests.md`

- [ ] **Step 1: Add `### Annotation field strip` to `## Wiki Page Frontmatter Validation`**

In `lat.md/tests.md`, after `### Wiki scalar aliases wrap` section, append:

```markdown
### Annotation field strip

A wiki page with `annotation:` in its frontmatter has the field removed by `validateAndRepairWikiPageFrontmatter`. The warnings array includes an entry containing "annotation".
```

- [ ] **Step 2: Add `## Ensure Wiki Sources` section**

After `## Wiki Page Frontmatter Validation`, add:

```markdown
## Ensure Wiki Sources

Tests for [[src/utils/raw-frontmatter.ts#ensureWikiSources]] covering the three injection scenarios.

### Absent wiki_sources injected

When `wiki_sources` is absent from frontmatter, `ensureWikiSources` returns `injected: true` and the output contains `[[sourceStem]]`.

### Non-empty wiki_sources unchanged

When `wiki_sources` is present and non-empty, `ensureWikiSources` returns `injected: false` and content is unchanged.

### Empty wiki_sources after repair injected

When the content reaching `ensureWikiSources` has no `wiki_sources` field (e.g., repair deleted all entries), `ensureWikiSources` injects `[[sourceStem]]` and returns `injected: true`.
```

- [ ] **Step 3: Add ingest pipeline integration spec**

After `## Ensure Wiki Sources`, add:

```markdown
## Ingest Pipeline Frontmatter Fixes

Integration tests for [[src/phases/ingest.ts]] verifying the repair-then-inject pipeline applied to each page during write.

### wiki_sources injected when absent

When the LLM emits a page without `wiki_sources`, the written page has `wiki_sources` containing `[[sourceStem]]` derived from the source file name.

### annotation stripped during ingest

When the LLM emits a page with `annotation:` in frontmatter, the written page does not contain `annotation:`.
```

- [ ] **Step 4: Run lat check**

```bash
lat check 2>&1 | tail -30
```

Expected: all checks pass. If `@lat:` refs in test code don't match section names, fix either the test comments or the section headings to align.

- [ ] **Step 5: Commit**

```bash
git add lat.md/tests.md
git commit -m "docs(lat): add spec sections for annotation strip and ensureWikiSources"
```
