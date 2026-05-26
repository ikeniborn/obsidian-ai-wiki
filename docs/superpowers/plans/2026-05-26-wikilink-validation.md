# WikiLink Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add programmatic WikiLink fixer that runs after `parseWithRetry` in ingest, format, and lint phases — fixes format violations without LLM retry, reports dead links as warnings.

**Architecture:** New `src/wiki-link-validator.ts` module with `validateWikiLinks`, `fixWikiLinks`, `checkWikiLinks`. Phases call `fixWikiLinks` after LLM output; lint additionally calls `checkWikiLinks` to feed violations into `allIssues` before the LLM call. Configurable via `wikiLinkValidationRetries` setting (default=3, 0=skip).

**Tech Stack:** TypeScript, Zod (for superRefine), Vitest

---

## File Map

| File | Action |
|------|--------|
| `src/wiki-link-validator.ts` | Create — validate + fix logic |
| `tests/wiki-link-validator.test.ts` | Create — unit tests |
| `src/phases/zod-schemas.ts` | Modify — add superRefine to WikiPageSchema |
| `tests/zod-schemas.test.ts` | Modify — add superRefine tests |
| `src/types.ts` | Modify — add `wikiLinkValidationRetries: number` |
| `src/settings.ts` | Modify — add UI after hubThreshold |
| `src/i18n.ts` | Modify — add EN/RU/ES strings |
| `src/agent-runner.ts` | Modify — pass new param to ingest/lint/format |
| `src/phases/ingest.ts` | Modify — call fixWikiLinks after path validation |
| `src/phases/lint.ts` | Modify — checkWikiLinks → allIssues; fixWikiLinks on fixes |
| `src/phases/format.ts` | Modify — call fixWikiLinks before write |
| `templates/_wiki_schema.md` | Modify — replace WikiLinks section |

---

## Task 1: Create wiki-link-validator.ts (TDD)

**Files:**
- Create: `tests/wiki-link-validator.test.ts`
- Create: `src/wiki-link-validator.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/wiki-link-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateWikiLinks, fixWikiLinks, checkWikiLinks } from "../src/wiki-link-validator";

const page = (content: string) => new Map([["Wiki/domain/entity/Page.md", content]]);

describe("validateWikiLinks", () => {
  it("detects alias violation", () => {
    const v = validateWikiLinks(page("See [[Page|alias text]] here."));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("alias");
    expect(v[0].detail).toBe("[[Page|alias text]]");
  });

  it("detects path violation", () => {
    const v = validateWikiLinks(page("See [[folder/page]] here."));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("path");
    expect(v[0].detail).toBe("[[folder/page]]");
  });

  it("detects inline-json frontmatter", () => {
    const content = `---\nwiki_outgoing_links: ["[[A]]"]\n---\n\nBody with [[A]].`;
    const v = validateWikiLinks(page(content));
    expect(v.some((x) => x.kind === "inline-json")).toBe(true);
  });

  it("detects outgoing-desync", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[B]]"\n---\n\nBody with [[A]].`;
    const v = validateWikiLinks(page(content));
    expect(v.some((x) => x.kind === "outgoing-desync")).toBe(true);
  });

  it("dead link is NOT a violation", () => {
    const stems = new Set(["ExistingPage"]);
    const v = validateWikiLinks(page("See [[NonExistent]]."), stems);
    expect(v).toHaveLength(0);
  });

  it("clean page has no violations", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody with [[A]].`;
    expect(validateWikiLinks(page(content))).toHaveLength(0);
  });
});

describe("fixWikiLinks", () => {
  it("strips alias", () => {
    const result = fixWikiLinks(page("See [[Page|alias]] here."), 3);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[Page]] here.");
    expect(result.warnings).toHaveLength(0);
  });

  it("strips path", () => {
    const result = fixWikiLinks(page("See [[folder/page]] here."), 3);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[page]] here.");
  });

  it("normalizes inline-json frontmatter to block list", () => {
    const content = `---\nwiki_outgoing_links: ["[[A]]", "[[B]]"]\n---\n\nBody [[A]] [[B]].`;
    const result = fixWikiLinks(page(content), 3);
    const fixed = result.fixed.get("Wiki/domain/entity/Page.md")!;
    expect(fixed).toContain("wiki_outgoing_links:");
    expect(fixed).toContain('  - "[[A]]"');
    expect(fixed).toContain('  - "[[B]]"');
    expect(fixed).not.toContain('["[[A]]"');
  });

  it("syncs wiki_outgoing_links from body", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[Old]]"\n---\n\nBody [[New]].`;
    const result = fixWikiLinks(page(content), 3);
    const fixed = result.fixed.get("Wiki/domain/entity/Page.md")!;
    expect(fixed).toContain('  - "[[New]]"');
    expect(fixed).not.toContain("[[Old]]");
  });

  it("is idempotent", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody [[A]].`;
    const r1 = fixWikiLinks(page(content), 3);
    const fixed1 = r1.fixed.get("Wiki/domain/entity/Page.md")!;
    const r2 = fixWikiLinks(new Map([["Wiki/domain/entity/Page.md", fixed1]]), 3);
    expect(r2.fixed.get("Wiki/domain/entity/Page.md")).toBe(fixed1);
  });

  it("preserves dead links (warns, does not remove)", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[Dead]]"\n---\n\nBody [[Dead]].`;
    const stems = new Set(["RealPage"]);
    const result = fixWikiLinks(page(content), 3, stems);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toContain("[[Dead]]");
    expect(result.warnings.some((w) => w.includes("Dead"))).toBe(true);
  });

  it("maxPasses=0 returns unchanged pages + violations as warnings", () => {
    const result = fixWikiLinks(page("See [[Page|alias]]."), 0);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[Page|alias]].");
    expect(result.warnings.some((w) => w.includes("alias"))).toBe(true);
  });
});

describe("checkWikiLinks", () => {
  it("returns empty string for clean pages", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody [[A]].`;
    expect(checkWikiLinks(page(content))).toBe("");
  });

  it("returns formatted violation lines", () => {
    const result = checkWikiLinks(page("See [[Page|alias]]."));
    expect(result).toMatch(/Wiki\/domain\/entity\/Page\.md.*alias/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/wiki-link-validator.test.ts 2>&1 | tail -15
```
Expected: FAIL with "Cannot find module '../src/wiki-link-validator'"

- [ ] **Step 3: Implement wiki-link-validator.ts**

```ts
// src/wiki-link-validator.ts

export type ViolationKind = "alias" | "path" | "inline-json" | "outgoing-desync";

export interface WikiLinkViolation {
  page: string;
  kind: ViolationKind;
  detail: string;
}

export interface FixResult {
  fixed: Map<string, string>;
  warnings: string[];
}

/** Splits "---\n...\n---" frontmatter from body. Returns null if no valid frontmatter. */
function splitFrontmatter(content: string): [fm: string, body: string] | null {
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx === -1) return null;
  const fmEnd = closeIdx + 4;
  const after = content[fmEnd];
  if (after !== undefined && after !== "\n" && after !== "\r") return null;
  return [content.slice(0, fmEnd), content.slice(fmEnd)];
}

/** Extract [[link]] targets from text (strips alias portion if present). */
function extractLinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) links.push(m[1].trim());
  return links;
}

/** Extract wiki_outgoing_links block-list values from frontmatter string. */
function extractFmLinks(fm: string): Set<string> {
  const set = new Set<string>();
  // Match block list items:  - "[[X]]"
  const re = /^\s+- "(\[\[[^\]]+\]\])"/mg;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fm)) !== null) set.add(m[1]);
  return set;
}

/** Replace wiki_outgoing_links in frontmatter with a YAML block list. */
function setFmLinks(fm: string, links: string[]): string {
  const block = links.length > 0
    ? "wiki_outgoing_links:\n" + links.map((l) => `  - "${l}"`).join("\n")
    : "wiki_outgoing_links: []";
  // Replace: "wiki_outgoing_links:" line + any following "  - ..." lines
  const replaced = fm.replace(/^wiki_outgoing_links:(?:\n  - "[^"]*")*/m, block);
  if (replaced !== fm) return replaced;
  // Not found — append before closing ---
  return fm.replace(/\n---$/, `\n${block}\n---`);
}

/** Apply one fix pass to a single page content. */
function fixOnePass(content: string): string {
  const parts = splitFrontmatter(content);
  if (!parts) {
    // No frontmatter — fix body links only
    return stripPath(stripAlias(content));
  }
  let [fm, body] = parts;

  // Fix body
  body = stripAlias(body);
  body = stripPath(body);

  // Fix inline-JSON frontmatter
  const inlineMatch = fm.match(/^wiki_outgoing_links:[ \t]*(\[.*?\])[ \t]*$/m);
  if (inlineMatch) {
    try {
      const arr: string[] = JSON.parse(inlineMatch[1]);
      fm = fm.replace(/^wiki_outgoing_links:[ \t]*\[.*?\][ \t]*$/m,
        arr.length > 0
          ? "wiki_outgoing_links:\n" + arr.map((l) => `  - "${l}"`).join("\n")
          : "wiki_outgoing_links: []",
      );
    } catch { /* leave as-is */ }
  }

  // Sync wiki_outgoing_links from body links
  const bodyLinks = extractLinks(body).map((l) => `[[${l}]]`);
  fm = setFmLinks(fm, bodyLinks);

  return fm + body;
}

function stripAlias(text: string): string {
  return text.replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, "[[$1]]");
}

function stripPath(text: string): string {
  return text.replace(/\[\[([^\]|]+)\]\]/g, (_, link: string) => {
    if (!link.includes("/")) return `[[${link}]]`;
    return `[[${link.split("/").pop()!}]]`;
  });
}

export function validateWikiLinks(
  pages: Map<string, string>,
  _knownPageStems?: Set<string>,
): WikiLinkViolation[] {
  const violations: WikiLinkViolation[] = [];

  for (const [pagePath, content] of pages) {
    // alias: [[X|Y]]
    const aliasRe = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = aliasRe.exec(content)) !== null) {
      violations.push({ page: pagePath, kind: "alias", detail: m[0] });
    }

    // path: [[folder/page]]
    const linkRe = /\[\[([^\]|]+)\]\]/g;
    while ((m = linkRe.exec(content)) !== null) {
      if (m[1].includes("/")) {
        violations.push({ page: pagePath, kind: "path", detail: m[0] });
      }
    }

    // inline-json: wiki_outgoing_links: [...]
    if (/^wiki_outgoing_links:[ \t]*\[/m.test(content)) {
      violations.push({ page: pagePath, kind: "inline-json", detail: "wiki_outgoing_links: [...]" });
    }

    // outgoing-desync
    const parts = splitFrontmatter(content);
    if (parts && /^wiki_outgoing_links:/m.test(parts[0])) {
      const [fm, body] = parts;
      const bodyLinksFmt = new Set(extractLinks(body).map((l) => `[[${l}]]`));
      const fmLinks = extractFmLinks(fm);
      const synced = bodyLinksFmt.size === fmLinks.size &&
        [...bodyLinksFmt].every((l) => fmLinks.has(l));
      if (!synced) {
        violations.push({
          page: pagePath, kind: "outgoing-desync",
          detail: `body: [${[...bodyLinksFmt].join(", ")}], fm: [${[...fmLinks].join(", ")}]`,
        });
      }
    }
  }

  return violations;
}

export function fixWikiLinks(
  pages: Map<string, string>,
  maxPasses: number,
  knownPageStems?: Set<string>,
): FixResult {
  const warnings: string[] = [];

  if (maxPasses === 0) {
    const violations = validateWikiLinks(pages);
    for (const v of violations) {
      warnings.push(`${v.page}: ${v.kind} — ${v.detail}`);
    }
    return { fixed: new Map(pages), warnings };
  }

  let current = new Map(pages);

  for (let pass = 0; pass < maxPasses; pass++) {
    const violations = validateWikiLinks(current);
    if (violations.length === 0) break;
    const next = new Map<string, string>();
    for (const [path, content] of current) {
      try {
        next.set(path, fixOnePass(content));
      } catch (e) {
        next.set(path, content);
        warnings.push(`${path}: fix error — ${(e as Error).message}`);
      }
    }
    current = next;
  }

  // Remaining violations after exhausting passes → warn
  const remaining = validateWikiLinks(current);
  for (const v of remaining) {
    warnings.push(`${v.page}: ${v.kind} — ${v.detail}`);
  }

  // Dead-link detection
  if (knownPageStems) {
    for (const [path, content] of current) {
      const parts = splitFrontmatter(content);
      const body = parts ? parts[1] : content;
      for (const link of extractLinks(body)) {
        const stem = link.split("/").pop()!;
        if (!knownPageStems.has(stem)) {
          warnings.push(`${path}: dead link [[${stem}]]`);
        }
      }
    }
  }

  return { fixed: current, warnings };
}

export function checkWikiLinks(pages: Map<string, string>): string {
  const violations = validateWikiLinks(pages);
  if (violations.length === 0) return "";
  return violations.map((v) => `- ${v.page}: ${v.kind} link ${v.detail}`).join("\n");
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-link-validator.test.ts 2>&1 | tail -10
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/wiki-link-validator.ts tests/wiki-link-validator.test.ts
git commit -m "feat(wiki-link-validator): add validateWikiLinks, fixWikiLinks, checkWikiLinks"
```

---

## Task 2: Add superRefine to WikiPageSchema

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Modify: `tests/zod-schemas.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/zod-schemas.test.ts`:

```ts
describe("WikiPageSchema superRefine", () => {
  it("rejects alias links", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[Other|alias]].",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("aliases not allowed");
  });

  it("rejects path links", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[folder/page]].",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("WikiLink with path");
  });

  it("accepts clean content", () => {
    const result = WikiPageSchema.safeParse({
      path: "Wiki/d/e/Page.md",
      content: "# Page\n\nSee [[OtherPage]].",
    });
    expect(result.success).toBe(true);
  });
});
```

Also add `import { WikiPageSchema } from "../src/phases/zod-schemas";` if not already imported.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/zod-schemas.test.ts 2>&1 | tail -10
```
Expected: FAIL — WikiPageSchema has no superRefine yet

- [ ] **Step 3: Add superRefine to WikiPageSchema**

In `src/phases/zod-schemas.ts`, change:

```ts
export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
});
```

to:

```ts
export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
}).superRefine((val, ctx) => {
  if (/\[\[[^\]]+\|[^\]]+\]\]/.test(val.content)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WikiLink aliases not allowed", path: ["content"] });
  }
  const linkRe = /\[\[([^\]|]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(val.content)) !== null) {
    if (m[1].includes("/")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "WikiLink with path", path: ["content"] });
      break;
    }
  }
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/zod-schemas.test.ts 2>&1 | tail -10
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/phases/zod-schemas.ts tests/zod-schemas.test.ts
git commit -m "feat(zod-schemas): add superRefine alias/path checks to WikiPageSchema"
```

---

## Task 3: Add wikiLinkValidationRetries to settings

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add field to types.ts**

In `src/types.ts`, after `hubThreshold: number;` (line ~143), add:

```ts
  wikiLinkValidationRetries: number;
```

After `hubThreshold: 20,` (line ~188), add default:

```ts
  wikiLinkValidationRetries: 3,
```

- [ ] **Step 2: Add i18n strings**

In `src/i18n.ts`, after `hubThreshold_desc` in each locale block, add:

**EN** (after line ~79):
```ts
    wikiLinkValidationRetries_name: "WikiLink fix passes",
    wikiLinkValidationRetries_desc: "Max programmatic fix passes for WikiLink format errors. 0 = validate only.",
```

**RU** (after line ~300):
```ts
    wikiLinkValidationRetries_name: "Проходов фиксера WikiLinks",
    wikiLinkValidationRetries_desc: "Макс. число программных проходов исправления формата WikiLinks. 0 — только валидация.",
```

**ES** (after line ~519):
```ts
    wikiLinkValidationRetries_name: "Pasadas del fijador de WikiLinks",
    wikiLinkValidationRetries_desc: "Máx. pasadas programáticas para corregir formato de WikiLinks. 0 = solo validar.",
```

- [ ] **Step 3: Add UI to settings.ts**

After the hubThreshold `new Setting(...)` block (ends at line ~682), add:

```ts
    new Setting(containerEl)
      .setName(T.settings.wikiLinkValidationRetries_name)
      .setDesc(T.settings.wikiLinkValidationRetries_desc)
      .addText((t) =>
        t.setPlaceholder("3")
          .setValue(String(s.wikiLinkValidationRetries))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0) {
              s.wikiLinkValidationRetries = n;
              await this.plugin.saveSettings();
            }
          }),
      );
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors related to wikiLinkValidationRetries

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/settings.ts src/i18n.ts
git commit -m "feat(settings): add wikiLinkValidationRetries setting (default=3)"
```

---

## Task 4: Wire up ingest.ts

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add param to runIngest**

In `src/phases/ingest.ts`, change signature from:

```ts
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
  graphDepth: number = 1,
): AsyncGenerator<RunEvent> {
```

to:

```ts
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
  graphDepth: number = 1,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Add import**

At the top of `src/phases/ingest.ts`, add:

```ts
import { fixWikiLinks } from "../wiki-link-validator";
```

- [ ] **Step 3: Call fixWikiLinks after path validation**

In `src/phases/ingest.ts`, after the path-validation block (after `pages = valid;` or `pages = [...valid, ...retriedValid];`) and before `const written: string[] = [];`, add:

```ts
  // Programmatic WikiLink fix
  if (wikiLinkValidationRetries > 0 || true) {
    const pagesMap = new Map(pages.map((p) => [p.path, p.content]));
    const knownStems = new Set([...pagesMap.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
    const fixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
    pages = pages.map((p) => ({ ...p, content: fixResult.fixed.get(p.path) ?? p.content }));
    if (fixResult.warnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: fixResult.warnings };
    }
  }
```

Wait — the condition `wikiLinkValidationRetries > 0 || true` is wrong. Replace the if condition:

```ts
  // Programmatic WikiLink fix (always run to collect warnings; maxPasses=0 skips fixing)
  const pagesMap = new Map(pages.map((p) => [p.path, p.content]));
  const knownStems = new Set([...pagesMap.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
  const wlFixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
  pages = pages.map((p) => ({ ...p, content: wlFixResult.fixed.get(p.path) ?? p.content }));
  if (wlFixResult.warnings.length > 0) {
    yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
  }
```

- [ ] **Step 4: Update agent-runner.ts**

In `src/agent-runner.ts`, change:

```ts
yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, undefined, this.settings.graphDepth);
```

to:

```ts
yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, similarity, undefined, this.settings.graphDepth, this.settings.wikiLinkValidationRetries);
```

- [ ] **Step 5: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts src/agent-runner.ts
git commit -m "feat(ingest): call fixWikiLinks after parseWithRetry"
```

---

## Task 5: Wire up lint.ts

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add param to runLint**

In `src/phases/lint.ts`, change signature from:

```ts
export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  hubThreshold: number = 20,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

to:

```ts
export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  hubThreshold: number = 20,
  wikiLinkValidationRetries: number = 3,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Add imports**

At top of `src/phases/lint.ts`, add:

```ts
import { checkWikiLinks, fixWikiLinks } from "../wiki-link-validator";
```

- [ ] **Step 3: Add checkWikiLinks to allIssues**

In `src/phases/lint.ts`, change:

```ts
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph, hubThreshold);
    const allIssues = [structuralIssues, graphIssues].filter(Boolean).join("\n");
```

to:

```ts
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph, hubThreshold);
    const wikiLinkIssues = checkWikiLinks(pages);
    const allIssues = [structuralIssues, graphIssues, wikiLinkIssues].filter(Boolean).join("\n");
```

- [ ] **Step 4: Call fixWikiLinks on LLM fixes before write loop**

In `src/phases/lint.ts`, before `const fixedPages = lintResult.value.fixes;`, add:

```ts
    const knownStems = new Set([...pages.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
    const fixesMap = new Map(lintResult.value.fixes.map((p) => [p.path, p.content]));
    const wlFixResult = fixWikiLinks(fixesMap, wikiLinkValidationRetries, knownStems);
    const fixedPages = lintResult.value.fixes.map((p) => ({ ...p, content: wlFixResult.fixed.get(p.path) ?? p.content }));
    if (wlFixResult.warnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
    }
```

Remove the existing `const fixedPages = lintResult.value.fixes;` line (it's replaced above).

- [ ] **Step 5: Update agent-runner.ts**

Change:

```ts
yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, opts, similarity);
```

to:

```ts
yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, this.settings.wikiLinkValidationRetries, opts, similarity);
```

- [ ] **Step 6: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/phases/lint.ts src/agent-runner.ts
git commit -m "feat(lint): add checkWikiLinks to allIssues; fix WikiLinks on LLM output"
```

---

## Task 6: Wire up format.ts

**Files:**
- Modify: `src/phases/format.ts`
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Add param to runFormat**

In `src/phases/format.ts`, change signature from:

```ts
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
  wikiVaultPath?: string,
): AsyncGenerator<RunEvent> {
```

to:

```ts
export async function* runFormat(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  hasVision: boolean,
  chatHistory: ChatMessage[],
  signal: AbortSignal,
  opts: LlmCallOptions = {},
  backend: "claude-agent" | "native-agent" = "native-agent",
  wikiVaultPath?: string,
  wikiLinkValidationRetries: number = 3,
): AsyncGenerator<RunEvent> {
```

- [ ] **Step 2: Add import**

At top of `src/phases/format.ts`, add:

```ts
import { fixWikiLinks } from "../wiki-link-validator";
```

- [ ] **Step 3: Call fixWikiLinks before write**

In `src/phases/format.ts`, find the `try { await vaultTools.write(tempPath, finalFormatted); }` block and insert before it:

```ts
  // Programmatic WikiLink fix
  {
    const fmtMap = new Map([[filePath, finalFormatted]]);
    const wlFix = fixWikiLinks(fmtMap, wikiLinkValidationRetries);
    finalFormatted = wlFix.fixed.get(filePath) ?? finalFormatted;
    if (wlFix.warnings.length > 0) {
      yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFix.warnings };
    }
  }
```

- [ ] **Step 4: Update agent-runner.ts**

Change:

```ts
yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath);
```

to:

```ts
yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts, this.settings.backend ?? "native-agent", wikiVaultPath, this.settings.wikiLinkValidationRetries);
```

- [ ] **Step 5: Run type check and all tests**

```bash
npx tsc --noEmit 2>&1 | head -20
npx vitest run 2>&1 | tail -15
```
Expected: no type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/phases/format.ts src/agent-runner.ts
git commit -m "feat(format): call fixWikiLinks on formatted output before write"
```

---

## Task 7: Update template

**Files:**
- Modify: `templates/_wiki_schema.md`

- [ ] **Step 1: Replace WikiLinks section**

In `templates/_wiki_schema.md`, replace:

```markdown
## WikiLinks
- Ссылаться только на существующие страницы через `[[имя-страницы]]`
- Запрещено: мёртвые ссылки, ссылки на файлы вне `!Wiki/`
```

with:

```markdown
## WikiLinks

- Only `[[page-name]]` — no aliases, no folder paths
- ❌ Forbidden: `[[Page|alias]]`, `[[folder/page]]`
- ✅ Correct: `[[page-name]]`, `[[Кириллица]]`, `[[Scalability]]`
- Link only to existing pages; dead links yield a warning

`wiki_outgoing_links` — YAML block list (not inline JSON):
- ✅ Correct:
  ```yaml
  wiki_outgoing_links:
    - "[[page-a]]"
    - "[[page-b]]"
  ```
- ❌ Forbidden: `wiki_outgoing_links: ["[[page-a]]", "[[page-b]]"]`

`wiki_outgoing_links` MUST contain every `[[link]]` found in the page body.
```

- [ ] **Step 2: Commit**

```bash
git add templates/_wiki_schema.md
git commit -m "docs(template): update WikiLinks section with format rules and examples"
```

---

## Task 8: Update lat.md

**Files:**
- Modify: `lat.md/architecture.md` or `lat.md/operations.md` (whichever covers lint/ingest phases)

- [ ] **Step 1: Run lat search to find sections to update**

```bash
lat search "wikilink validation lint ingest fix"
```

- [ ] **Step 2: Add WikiLink Validation section**

Add to the appropriate `lat.md/` file (under Operations or Architecture) a new section:

```markdown
## WikiLink Validation

Programmatic WikiLink fixer runs after `parseWithRetry` in ingest, format, and lint phases. Fixes format violations without LLM retry.

Violations detected: `alias` (`[[X|Y]]`), `path` (`[[folder/page]]`), `inline-json` (`wiki_outgoing_links: [...]`), `outgoing-desync` (body links ≠ frontmatter field). Dead links produce warnings only — never block writes.

Configured via `wikiLinkValidationRetries` (default=3, 0=validate-only). See [[src/wiki-link-validator.ts]].
```

- [ ] **Step 3: Run lat check**

```bash
lat check 2>&1
```
Expected: All checks passed

- [ ] **Step 4: Commit**

```bash
git add lat.md/
git commit -m "docs(lat.md): add WikiLink Validation section"
```

---

## Self-Review

**Spec coverage:**
- ✅ `src/wiki-link-validator.ts` — Task 1
- ✅ `src/phases/zod-schemas.ts` superRefine — Task 2
- ✅ `wikiLinkValidationRetries` setting (types, settings, i18n) — Task 3
- ✅ `agent-runner.ts` passes param to all phases — Tasks 4/5/6
- ✅ `ingest.ts` calls fixWikiLinks — Task 4
- ✅ `lint.ts` checkWikiLinks → allIssues + fixWikiLinks on fixes — Task 5
- ✅ `format.ts` calls fixWikiLinks — Task 6
- ✅ `templates/_wiki_schema.md` — Task 7
- ✅ `lat.md/` update — Task 8

**Placeholder scan:** No TBD/TODO/placeholder in any step. All code blocks complete.

**Type consistency:** `WikiLinkViolation`, `FixResult`, `ViolationKind` defined in Task 1 and referenced consistently. `wikiLinkValidationRetries` param name used identically across all phases and agent-runner.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-26-wikilink-validation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
