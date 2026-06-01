---
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-01-frontmatter-validator-design.md
review:
  plan_hash: 1b2ffae2f90fdb28
  spec_hash: 4193386b7d7d1a9a
  last_run: 2026-06-01
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
      section: "## Task 2: Shared helper `validateAndRepairFrontmatter`"
      section_hash: e519fa474316c632
      text: "Plan uses surgical string replacement instead of yaml.stringify (spec arch step 6). Plan preamble explicitly states 'parse only — no stringify'. Behavior differs: string replacement preserves exact YAML formatting; yaml.stringify would reformat."
      verdict: fixed
      verdict_at: 2026-06-01
    - id: F-002
      phase: consistency
      severity: INFO
      section: "## Task 5: Wire validators into `ingest.ts`"
      section_hash: 821a8285ecfb4518
      text: "Wiki page warning summary uses page.path.split('/').pop() (filename only) while spec uses full page.path."
      verdict: fixed
      verdict_at: 2026-06-01
---
# Frontmatter Validator After Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YAML-based frontmatter validation and auto-repair to ingest for both source files and wiki pages, and fix the root-cause bug in `removeWikiFields`.

**Architecture:** Single shared helper `validateAndRepairFrontmatter(content, rules)` detects duplicate keys via regex, pre-merges duplicate list fields, parses via `yaml.parse`, applies per-field rules on the parsed object, then re-serializes via `yaml.stringify`. Two public exports (`validateAndRepairSourceFrontmatter`, `validateAndRepairWikiPageFrontmatter`) are called in `ingest.ts` before each `vaultTools.write`.

**Tech Stack:** `yaml ^2.x` (parse + stringify), vitest, TypeScript

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | add `yaml ^2.x` dependency |
| `src/utils/raw-frontmatter.ts` | Modify | fix `removeWikiFields`; add `FieldRule`, shared helper, two public validators |
| `tests/utils/raw-frontmatter.test.ts` | Modify | extend existing test file with validator tests |
| `src/phases/ingest.ts` | Modify | call both validators before their respective `vaultTools.write` calls |

---

## Task 1: Fix `removeWikiFields` + install `yaml`

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `tests/utils/raw-frontmatter.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Add to `tests/utils/raw-frontmatter.test.ts`:

```ts
describe("upsertRawFrontmatter — duplicate wiki_articles bug", () => {
  it("produces exactly one wiki_articles when source already had two occurrences", () => {
    const input = `---
tags:
  - crypto
wiki_articles:
wiki_added: 2026-05-21
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_fin]]"
---
body`;
    const result = upsertRawFrontmatter(input, {
      wiki_updated: "2026-06-01",
      wiki_articles: ["[[wiki_fin]]"],
    });
    expect(result.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: FAIL — `Expected: 1, Received: 2` (two `wiki_articles:` survive).

- [ ] **Step 3: Fix `removeWikiFields` in `src/utils/raw-frontmatter.ts`**

Current code (lines ~3–10):
```ts
function removeWikiFields(yaml: string): string {
  yaml = yaml.replace(/^wiki_added:[^\n]*\n?/m, "");
  yaml = yaml.replace(/^wiki_updated:[^\n]*\n?/m, "");
  yaml = yaml.replace(/^wiki_articles:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*/m, "");
  return yaml;
}
```

Replace with:
```ts
function removeWikiFields(yaml: string): string {
  yaml = yaml.replace(/^wiki_added:[^\n]*\n?/gm, "");
  yaml = yaml.replace(/^wiki_updated:[^\n]*\n?/gm, "");
  let prev: string;
  do {
    prev = yaml;
    yaml = yaml.replace(/^wiki_articles:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*/m, "");
  } while (yaml !== prev);
  return yaml;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: all 17 tests pass.

- [ ] **Step 5: Install `yaml` package**

```bash
npm install yaml
```

Verify `package.json` now has `"yaml": "^2.x.x"` in `dependencies`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts package.json package-lock.json
git commit -m "fix(raw-frontmatter): remove all wiki_articles occurrences in removeWikiFields; add yaml dep"
```

---

## Task 2: Shared helper `validateAndRepairFrontmatter`

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils/raw-frontmatter.test.ts`:

```ts
import { validateAndRepairSourceFrontmatter } from "../../src/utils/raw-frontmatter";

describe("validateAndRepairFrontmatter — core behaviors", () => {
  it("returns content unchanged when no frontmatter present", () => {
    const content = "# Just body\n\nNo frontmatter.";
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings).toEqual([]);
  });

  it("returns content unchanged when frontmatter is valid", () => {
    const content = `---
tags:
  - crypto/defi
wiki_added: 2026-05-01
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_defi_overview]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings).toEqual([]);
  });

  it("merges duplicate list key and emits warning", () => {
    const content = `---
tags:
  - crypto
wiki_articles:
wiki_added: 2026-05-21
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_fin]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
    expect(warnings.some((w) => w.includes('Duplicate key "wiki_articles"'))).toBe(true);
  });

  it("returns original content and warns on unparseable YAML", () => {
    const content = `---
key: [unclosed bracket
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings.some((w) => w.includes("Unparseable YAML"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: FAIL — `validateAndRepairSourceFrontmatter is not a function`.

- [ ] **Step 3: Add `FieldRule` type and shared helper internals to `src/utils/raw-frontmatter.ts`**

Add after the existing `FM_RE` constant:

```ts
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /^\[\[.+\]\]$/;
const URL_RE = /^https?:\/\//;
const TAG_RE = /^[a-z][a-z0-9]*(?:[/_][a-z0-9]+)*$/;

export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] };

export function validateAndRepairFrontmatter(
  content: string,
  rules: FieldRule[],
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, warnings };

  let rawYaml = fmMatch[1];
  const body = content.slice(fmMatch[0].length);

  // Step 2: Detect duplicate keys via regex line scan
  const counts = new Map<string, number>();
  for (const m of rawYaml.matchAll(/^([\w][\w_]*):/gm)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }

  // Step 4: Pre-merge duplicate list fields in raw YAML before parsing
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const allItems: string[] = [];
    const blockRe = new RegExp(`^${key}:[^\\n]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "gm");
    for (const m of rawYaml.matchAll(blockRe)) {
      for (const item of m[1].matchAll(/[ \t]+-[ \t]+"?([^"\n]+?)"?[ \t]*$/gm)) {
        allItems.push(item[1].trim());
      }
    }
    let prev: string;
    do {
      prev = rawYaml;
      rawYaml = rawYaml.replace(
        new RegExp(`^${key}:[^\\n]*\\n(?:[ \\t]+-[^\\n]*\\n?)*`, "m"),
        "",
      );
    } while (rawYaml !== prev);
    if (allItems.length > 0) {
      const merged = [...new Set(allItems)];
      rawYaml =
        rawYaml.trimEnd() + "\n" + key + ":\n" + merged.map((v) => `  - "${v}"`).join("\n") + "\n";
      warnings.push(`Duplicate key "${key}" — merged ${merged.length} items`);
    } else {
      warnings.push(`Duplicate scalar key "${key}" — last value kept`);
    }
  }

  // Step 3: Parse via yaml.parse — catch syntax errors → warn, return original
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(rawYaml) as Record<string, unknown>) ?? {};
  } catch (e) {
    warnings.push(`Unparseable YAML: ${(e as Error).message} — left unchanged`);
    return { content, warnings };
  }

  // Step 5: Apply per-field rules on parsed object
  for (const rule of rules) {
    const val = parsed[rule.field];
    if (val === undefined || val === null) continue;

    switch (rule.kind) {
      case "list-wikilinks":
      case "list-urls":
      case "list-tags": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          break;
        }
        const predicate =
          rule.kind === "list-wikilinks"
            ? (v: string) => WIKILINK_RE.test(v)
            : rule.kind === "list-urls"
              ? (v: string) => URL_RE.test(v)
              : (v: string) => TAG_RE.test(v);
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !predicate(v)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        parsed[rule.field] = filtered;
        break;
      }
      case "date-scalar": {
        if (typeof val !== "string" || !DATE_RE.test(val)) {
          warnings.push(`${rule.field}: invalid date "${val}" — removed`);
          delete parsed[rule.field];
        }
        break;
      }
      case "aliases": {
        if (typeof val === "string") {
          warnings.push(`aliases: scalar "${val}" wrapped in list`);
          parsed[rule.field] = [val];
        }
        break;
      }
      case "warn-enum": {
        if (typeof val !== "string" || !(rule.values as string[]).includes(val)) {
          warnings.push(
            `${rule.field}: unexpected value "${val}" (expected: ${rule.values.join("|")})`,
          );
        }
        break;
      }
    }
  }

  // Step 6+7: Re-serialize via yaml.stringify and reconstruct full file
  if (warnings.length === 0) return { content, warnings };
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: all tests pass (the 4 new + 17 existing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(raw-frontmatter): add FieldRule type and validateAndRepairFrontmatter helper"
```

---

## Task 3: `validateAndRepairSourceFrontmatter`

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils/raw-frontmatter.test.ts`:

```ts
describe("validateAndRepairSourceFrontmatter", () => {
  it("removes wiki_added with invalid date", () => {
    const content = `---
wiki_added: not-a-date
wiki_updated: 2026-06-01
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).not.toContain("wiki_added:");
    expect(warnings.some((w) => w.includes("wiki_added") && w.includes("invalid date"))).toBe(true);
  });

  it("removes wiki_articles entry that is not a wikilink", () => {
    const content = `---
wiki_articles:
  - "[[wiki_valid]]"
  - "not-a-wikilink"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("not-a-wikilink");
    expect(warnings.some((w) => w.includes("wiki_articles") && w.includes("not-a-wikilink"))).toBe(true);
  });

  it("removes tag with uppercase letters", () => {
    const content = `---
tags:
  - crypto/defi
  - BadTag
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("crypto/defi");
    expect(out).not.toContain("BadTag");
    expect(warnings.some((w) => w.includes("tags") && w.includes("BadTag"))).toBe(true);
  });

  it("wraps scalar aliases in a list", () => {
    const content = `---
aliases: BTC
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("aliases:\n  - BTC");
    expect(warnings.some((w) => w.includes("aliases"))).toBe(true);
  });

  it("removes external_links entry without http(s):// prefix", () => {
    const content = `---
external_links:
  - "https://example.com"
  - "ftp://bad.com"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("https://example.com");
    expect(out).not.toContain("ftp://bad.com");
  });

  it("removes related entry that is not a wikilink", () => {
    const content = `---
related:
  - "[[wiki_valid]]"
  - "plain-text"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("plain-text");
  });

  it("does not modify body content", () => {
    const content = `---
wiki_added: bad
---
# Body with wiki_added: mention`;
    const { content: out } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("# Body with wiki_added: mention");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: FAIL — `validateAndRepairSourceFrontmatter is not a function`.

- [ ] **Step 3: Add source rules and public export to `src/utils/raw-frontmatter.ts`**

Add at the bottom of the file (after the shared helper):

```ts
const SOURCE_RULES: FieldRule[] = [
  { field: "wiki_articles", kind: "list-wikilinks" },
  { field: "wiki_added", kind: "date-scalar" },
  { field: "wiki_updated", kind: "date-scalar" },
  { field: "tags", kind: "list-tags" },
  { field: "aliases", kind: "aliases" },
  { field: "created", kind: "date-scalar" },
  { field: "updated", kind: "date-scalar" },
  { field: "external_links", kind: "list-urls" },
  { field: "related", kind: "list-wikilinks" },
];

export function validateAndRepairSourceFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  return validateAndRepairFrontmatter(content, SOURCE_RULES);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(raw-frontmatter): add validateAndRepairSourceFrontmatter"
```

---

## Task 4: `validateAndRepairWikiPageFrontmatter`

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils/raw-frontmatter.test.ts`:

```ts
import { validateAndRepairWikiPageFrontmatter } from "../../src/utils/raw-frontmatter";

describe("validateAndRepairWikiPageFrontmatter", () => {
  it("removes wiki_sources entry that is not a wikilink", () => {
    const content = `---
wiki_sources:
  - "[[valid_source]]"
  - "plain/path.md"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[valid_source]]");
    expect(out).not.toContain("plain/path.md");
    expect(warnings.some((w) => w.includes("wiki_sources"))).toBe(true);
  });

  it("removes wiki_updated with invalid date", () => {
    const content = `---
wiki_updated: 01-06-2026
wiki_status: stub
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).not.toContain("wiki_updated:");
    expect(warnings.some((w) => w.includes("wiki_updated") && w.includes("invalid date"))).toBe(true);
  });

  it("emits warning for invalid wiki_status but does not remove field", () => {
    const content = `---
wiki_status: draft
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("wiki_status: draft");
    expect(warnings.some((w) => w.includes("wiki_status") && w.includes("draft"))).toBe(true);
  });

  it("removes tag with spaces", () => {
    const content = `---
tags:
  - valid/tag
  - "invalid tag"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("valid/tag");
    expect(out).not.toContain("invalid tag");
  });

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
  });

  it("removes wiki_external_links entry without https:// prefix", () => {
    const content = `---
wiki_external_links:
  - "https://good.com"
  - "not-a-url"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("https://good.com");
    expect(out).not.toContain("not-a-url");
  });

  it("wraps scalar aliases in a list", () => {
    const content = `---
aliases: Ethereum
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("aliases:\n  - Ethereum");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: FAIL — `validateAndRepairWikiPageFrontmatter is not a function`.

- [ ] **Step 3: Add wiki page rules and public export to `src/utils/raw-frontmatter.ts`**

Add at the bottom of the file:

```ts
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

export function validateAndRepairWikiPageFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  return validateAndRepairFrontmatter(content, WIKI_PAGE_RULES);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/utils/raw-frontmatter.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(raw-frontmatter): add validateAndRepairWikiPageFrontmatter"
```

---

## Task 5: Wire validators into `ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts:16` (import)
- Modify: `src/phases/ingest.ts:301–313` (wiki page write loop)
- Modify: `src/phases/ingest.ts:401–412` (source file write)

- [ ] **Step 1: Update import on line 16 of `src/phases/ingest.ts`**

```ts
import {
  upsertRawFrontmatter,
  parseWikiArticlesFromFm,
  hasFrontmatterField,
  validateAndRepairSourceFrontmatter,
  validateAndRepairWikiPageFrontmatter,
} from "../utils/raw-frontmatter";
```

- [ ] **Step 2: Add wiki page validator before `vaultTools.write(page.path, page.content)` (around line 311)**

Current code:
```ts
yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
try {
  await vaultTools.write(page.path, page.content);
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
yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
try {
  await vaultTools.write(page.path, repairedPage);
```

Also update the log entry block that follows — replace `page.content` with `repairedPage`:
```ts
const statusTo = parseWikiStatus(repairedPage);
if (existingContent === null) {
  logEntries.push({ path: relPath, action: "СОЗДАНА", statusTo });
} else {
  logEntries.push({ path: relPath, action: "ОБНОВЛЕНА", statusFrom: parseWikiStatus(existingContent), statusTo });
}
```

- [ ] **Step 3: Add source file validator (around line 401)**

Current code:
```ts
const updatedSource = upsertRawFrontmatter(sourceContent, {
  wiki_added: isFirstTime ? backlinkToday : undefined,
  wiki_updated: backlinkToday,
  wiki_articles: mergedArticles,
});
yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
try {
  await vaultTools.write(sourceVaultPath, updatedSource);
```

Replace with:
```ts
const updatedSource = upsertRawFrontmatter(sourceContent, {
  wiki_added: isFirstTime ? backlinkToday : undefined,
  wiki_updated: backlinkToday,
  wiki_articles: mergedArticles,
});
const { content: repairedSource, warnings: sourceWarnings } =
  validateAndRepairSourceFrontmatter(updatedSource);
if (sourceWarnings.length > 0) {
  yield {
    kind: "info_text",
    icon: "⚠️",
    summary: "Source frontmatter repaired",
    details: sourceWarnings,
  };
}
yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
try {
  await vaultTools.write(sourceVaultPath, repairedSource);
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. If `ingest.test.ts` fails, check that any assertions on written content match the (now-repaired) output.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "feat(ingest): validate and auto-repair frontmatter before writing source and wiki pages"
```

---

## Self-Review

**Spec coverage:**
- ✅ Fix `removeWikiFields` → Task 1
- ✅ `validateAndRepairSourceFrontmatter` → Tasks 2–3
- ✅ `validateAndRepairWikiPageFrontmatter` → Tasks 2, 4
- ✅ Wire into ingest (source + wiki pages) → Task 5
- ✅ Duplicate key merge → Task 2 helper
- ✅ `wiki_articles`/`wiki_sources`/`related`/`wiki_outgoing_links` = `[[...]]` → Task 3/4 rules
- ✅ `wiki_added`/`wiki_updated`/`created`/`updated` = YYYY-MM-DD → Task 3/4 rules
- ✅ `tags[]` validation → Task 3/4 rules
- ✅ `aliases` scalar→list → Task 3/4 rules
- ✅ `external_links`/`wiki_external_links` = URL → Task 3/4 rules
- ✅ `wiki_status`/`wiki_type` = warn only → Task 4 rules
- ✅ Unparseable YAML = warn + no change → Task 2 helper
- ✅ F-002 (rules type) resolved by `FieldRule` export in Task 2

**No placeholders found.**

**Type consistency:** `validateAndRepairFrontmatter(content, rules)` defined in Task 2; called in Tasks 3/4 with `SOURCE_RULES` / `WIKI_PAGE_RULES`; public exports called in Task 5. Consistent throughout.
