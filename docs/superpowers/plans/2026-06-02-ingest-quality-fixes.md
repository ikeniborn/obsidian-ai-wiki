---
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-02-ingest-quality-fixes-design.md
review:
  plan_hash: 6e7be4641525793d
  spec_hash: f9cbe480b00bc34c
  last_run: "2026-06-02"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: "Task 2"
      section_hash: a5738ff912038311
      text: "Step 1 (lat.md/tests.md edit) has no immediate DoD — verified only by lat check in Step 7, 6 steps later"
      verdict: open
---
# Ingest Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three targeted fixes for systematic ingest quality issues: source names appearing in `wiki_outgoing_links` (Fix 1), duplicate `wiki_articles` key in source frontmatter (Fix 2), and dead wiki links in generated pages (Fix 4).

**Architecture:** Fix 1 + Fix 4 are pure prompt edits (low risk, single commit). Fix 2 replaces the regex-based `upsertRawFrontmatter` with a parse→mutate→re-serialize approach that eliminates duplicate key bugs.

**Tech Stack:** TypeScript, `yaml` npm package, Vitest, `prompts/ingest.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `prompts/ingest.md` | Modify | Add Fix 1 negative example after line 23; add Fix 4 dead-link rule before line 32 |
| `src/utils/raw-frontmatter.ts` | Modify | Replace `upsertRawFrontmatter`, delete `buildWikiFields` and `removeWikiFields` |
| `tests/utils/raw-frontmatter.test.ts` | Modify | Add regression test for yaml.stringify-indented list items |
| `lat.md/tests.md` | Modify | Add spec section for the new `upsertRawFrontmatter` regression test |

---

## Task 1: Fix 1 + Fix 4 — Prompt edits in `prompts/ingest.md`

**Files:**
- Modify: `prompts/ingest.md`

### Context

Current `prompts/ingest.md` line 23:
```
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
```

Current line 32 (start of ПРАВИЛО ПУТЕЙ section):
```
ПРАВИЛО ПУТЕЙ: путь каждой статьи = !Wiki/<domain>/<entity>/<Article>.md — ровно 4 сегмента.
```

- [ ] **Step 1: Add Fix 1 negative example immediately after line 23**

After the `wiki_outgoing_links` rule line, insert these three lines:

```
  ❌ ЗАПРЕЩЕНО: [[ИмяТекущегоИсточника]] или [[ЛюбойДругойФайл-источник]] в wiki_outgoing_links.
     Источник уже записан в wiki_sources — дублировать в outgoing_links не нужно.
     Пример: обрабатываем «Фарминг ликвидности.md» → НЕЛЬЗЯ [[Фарминг ликвидности]] в outgoing_links.
```

The target location in the file:
```
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
```
becomes:
```
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
  ❌ ЗАПРЕЩЕНО: [[ИмяТекущегоИсточника]] или [[ЛюбойДругойФайл-источник]] в wiki_outgoing_links.
     Источник уже записан в wiki_sources — дублировать в outgoing_links не нужно.
     Пример: обрабатываем «Фарминг ликвидности.md» → НЕЛЬЗЯ [[Фарминг ликвидности]] в outgoing_links.
```

- [ ] **Step 2: Add Fix 4 dead-link rule before `ПРАВИЛО ПУТЕЙ`**

Before the `ПРАВИЛО ПУТЕЙ:` line (currently line 32 in the file, now shifted by 3 after Fix 1), insert a blank line and this rule:

```
- МЁРТВЫЕ ССЫЛКИ: каждый [[wiki_domain_slug]] в wiki_outgoing_links и в теле статьи обязан
  либо существовать среди «Существующих wiki-страниц» (переданы в контексте), либо
  присутствовать в списке pages этого ответа. Нет страницы — не пиши ссылку.
```

The block before `ПРАВИЛО ПУТЕЙ:` should look like:

```
- Для каждой страницы добавь поле "annotation" в JSON: одно предложение — описание сущности для поиска по смыслу
- МЁРТВЫЕ ССЫЛКИ: каждый [[wiki_domain_slug]] в wiki_outgoing_links и в теле статьи обязан
  либо существовать среди «Существующих wiki-страниц» (переданы в контексте), либо
  присутствовать в списке pages этого ответа. Нет страницы — не пиши ссылку.
{{schema_block}}
{{forbidden_stems_block}}

ПРАВИЛО ПУТЕЙ: путь каждой статьи = !Wiki/<domain>/<entity>/<Article>.md — ровно 4 сегмента.
```

- [ ] **Step 3: Verify the file is valid (no broken template vars)**

```bash
grep -n "wiki_outgoing_links\|ЗАПРЕЩЕНО\|МЁРТВЫЕ\|ПРАВИЛО ПУТЕЙ" prompts/ingest.md
```

Expected: output shows all four patterns, in this order:
1. `wiki_outgoing_links` rule line
2. `ЗАПРЕЩЕНО` negative example
3. `МЁРТВЫЕ ССЫЛКИ` rule
4. `ПРАВИЛО ПУТЕЙ` block

- [ ] **Step 4: Commit**

```bash
git add prompts/ingest.md
git commit -m "feat(prompts): forbid source names in outgoing_links and dead wiki links (Fix 1, Fix 4)"
```

---

## Task 2: Fix 2 — Replace `upsertRawFrontmatter` with yaml-parse approach

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (lines 257–312)
- Modify: `tests/utils/raw-frontmatter.test.ts`
- Modify: `lat.md/tests.md`

### Context

Current implementation uses regex string manipulation (`removeWikiFields`, `buildWikiFields`) which fails when YAML list items produced by `yaml.stringify` have 0-space indent (no leading spaces before `-`). The regex `[ \t]+-` requires at least one space/tab, so items like `\n- "[[value]]"` are not removed, leaving the old `wiki_articles:` key in place — and the new one gets appended, creating a duplicate.

The fix: parse existing YAML → delete `wiki_added`, `wiki_updated`, `wiki_articles` → inject new values → re-serialize.

### Step 2a: Write the failing regression test first

- [ ] **Step 1: Add regression test spec to `lat.md/tests.md`**

In `lat.md/tests.md`, after the `### Duplicate key merge` section (currently around line 69), add a new leaf section under `## Frontmatter Validation`:

```markdown
### upsertRawFrontmatter — no duplicate on yaml.stringify indent

When source frontmatter was re-serialized by `yaml.stringify` (which may produce 0-space-indented list items), `upsertRawFrontmatter` must replace the existing `wiki_articles` block cleanly and produce exactly one `wiki_articles:` key.
```

- [ ] **Step 2: Write the failing test in `tests/utils/raw-frontmatter.test.ts`**

Add inside the `describe("upsertRawFrontmatter — duplicate wiki_articles bug", ...)` block:

```typescript
  // @lat: [[tests#Frontmatter Validation#upsertRawFrontmatter — no duplicate on yaml.stringify indent]]
  it("no duplicate wiki_articles when list items have no leading indent (yaml.stringify style)", () => {
    // yaml.stringify can produce items without leading spaces: "wiki_articles:\n- item"
    // The old regex [ \t]+- fails to match and leaves the original key intact → duplicate
    const input = `---\ntags:\n  - crypto\nwiki_articles:\n- "[[wiki_fin]]"\nwiki_updated: 2026-06-01\n---\nbody`;
    const result = upsertRawFrontmatter(input, {
      wiki_updated: "2026-06-02",
      wiki_articles: ["[[wiki_new]]"],
    });
    expect(result.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
    expect(result).toContain("[[wiki_new]]");
    expect(result).not.toContain("[[wiki_fin]]");
  });
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npm test -- --reporter=verbose tests/utils/raw-frontmatter.test.ts 2>&1 | grep -A5 "yaml.stringify style\|FAIL\|PASS"
```

Expected: FAIL — `result.match(/^wiki_articles:/gm)?.length` is 2, not 1.

### Step 2b: Replace the implementation

- [ ] **Step 4: Replace `removeWikiFields`, `buildWikiFields`, and `upsertRawFrontmatter` in `src/utils/raw-frontmatter.ts`**

Delete lines 257–312 (the three functions) and replace with:

```typescript
export function upsertRawFrontmatter(
  content: string,
  fields: { wiki_added?: string; wiki_updated: string; wiki_articles: string[] },
): string {
  const match = FM_RE.exec(content);
  const body = match ? content.slice(match[0].length) : content;

  let existing: Record<string, unknown> = {};
  if (match) {
    try {
      existing = (yamlParse(match[1]) as Record<string, unknown>) ?? {};
    } catch { /* malformed YAML — start fresh */ }
  }

  const wikiAdded =
    fields.wiki_added ??
    (typeof existing.wiki_added === "string" ? existing.wiki_added : undefined);

  const { wiki_added: _a, wiki_updated: _u, wiki_articles: _ar, ...rest } =
    existing as Record<string, unknown>;
  void _a; void _u; void _ar;

  const result: Record<string, unknown> = { ...rest };
  if (wikiAdded !== undefined) result.wiki_added = wikiAdded;
  result.wiki_updated = fields.wiki_updated;
  if (fields.wiki_articles.length > 0) result.wiki_articles = fields.wiki_articles;

  return `---\n${yamlStringify(result)}---\n${body}`;
}
```

Note: `yamlParse` and `yamlStringify` are already imported at line 1 of the file. The `FM_RE` constant is already defined at line 4.

- [ ] **Step 5: Run all tests to verify passing**

```bash
npm test -- --reporter=verbose tests/utils/raw-frontmatter.test.ts 2>&1 | tail -30
```

Expected: All tests PASS including the new regression test.

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All suites pass (no regressions).

- [ ] **Step 7: Run `lat check`**

```bash
lat check 2>&1 | tail -20
```

Expected: 0 errors. The new `@lat:` reference in the test file must point to the new section in `lat.md/tests.md`.

- [ ] **Step 8: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts lat.md/tests.md
git commit -m "fix(raw-frontmatter): replace regex upsertRawFrontmatter with yaml parse→mutate→serialize (Fix 2)"
```

---

## Verification Checklist

After both tasks are done, verify the spec's success criteria:

| Fix | Verification command |
|-----|---------------------|
| Fix 1 | `grep "ЗАПРЕЩЕНО" prompts/ingest.md` — must output the negative example |
| Fix 2 | `npm test` — the regression test must pass |
| Fix 4 | `grep "МЁРТВЫЕ ССЫЛКИ" prompts/ingest.md` — must output the dead-link rule |
