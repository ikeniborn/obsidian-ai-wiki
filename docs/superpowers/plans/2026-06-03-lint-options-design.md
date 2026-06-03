---
chain:
  intent: docs/superpowers/intents/2026-06-03-wiki-articles-validation-intent.md
  spec: docs/superpowers/specs/2026-06-03-lint-options-design.md
review:
  plan_hash: c9033199fdc76555
  spec_hash: 2316841a1eb0d9e7
  last_run: "2026-06-03"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Task 4"
      section_hash: 0d8524de3bb471e8
      text: "Duplicate 'Step 4' label in Task 4 — one for 'Run ingest tests', one for 'Commit'"
      verdict: fixed
      verdict_at: "2026-06-03"
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "Task 7"
      section_hash: 2c860a58d1eabc5e
      text: "Spec §5 requires modal tests for 'Entity type checkboxes populate from selected domain' and 'Entity type section hidden when all selected' — not covered in Task 7"
      verdict: fixed
      verdict_at: "2026-06-03"
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "Task 8"
      section_hash: 9323220cec01bf0d
      text: "Step 4 uses pseudocode '// ... (existing loop body unchanged...)' — agent must independently locate loop start/end boundaries in lint.ts"
      verdict: fixed
      verdict_at: "2026-06-03"
    - id: F-004
      phase: consistency
      severity: INFO
      section: "Task 5"
      section_hash: 564e6dc05667e514
      text: "Spec §2 says DEFAULT_SETTINGS is in src/settings.ts; actual location is src/types.ts:196. Plan correctly uses types.ts — spec text is wrong."
      verdict: accepted
      verdict_at: "2026-06-03"
---

# Lint Options: Programmatic Mode + Entity Type Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `stripInvalidWikiArticles` for strict `wiki_articles` validation, a `lintOptions.useLlm` setting, and a `LintOptionsModal` that exposes per-run LLM toggle and entity-type filter.

**Architecture:** New `stripInvalidWikiArticles` function replaces `filterStaleWikiLinks` for `wiki_articles` in both lint and ingest. A new `LintOptionsModal` replaces both existing lint entry points. `useLlm`/`entityTypeFilter` flow through `RunRequest` → `dispatch` → `agent-runner` → `runLint`.

**Tech Stack:** TypeScript, Obsidian Modal API, Vitest

---

## File Structure

| File | Change | What |
|------|--------|------|
| `src/utils/raw-frontmatter.ts` | Modify | Add `stripInvalidWikiArticles`, import `GENERIC_WIKI_STEM_REGEX` |
| `src/phases/lint.ts` | Modify | Add `useLlm`/`entityTypeFilter` params; wrap LLM loop; call `stripInvalidWikiArticles` |
| `src/phases/ingest.ts` | Modify | Replace `existingArticleStems` block + `filterStaleWikiLinks` for wiki_articles |
| `src/types.ts` | Modify | Add `lintOptions` to `LlmWikiPluginSettings` + `DEFAULT_SETTINGS`; add `lintOpts?` to `RunRequest` |
| `src/i18n.ts` | Modify | Add `h3_lint`, `lintUseLlm_name`, `lintUseLlm_desc` to all 3 locales |
| `src/settings.ts` | Modify | Add Lint settings section with "Use LLM for lint" toggle |
| `src/modals.ts` | Modify | Add `LintOptionsModal` class |
| `src/controller.ts` | Modify | Update `lint(domain, opts?)` signature; update `dispatch` to pass `lintOpts` |
| `src/agent-runner.ts` | Modify | Pass `useLlm`/`entityTypeFilter` from `req.lintOpts` to `runLint` |
| `src/main.ts` | Modify | Replace `DomainModal` with `LintOptionsModal` for lint command |
| `src/view.ts` | Modify | Replace `ConfirmModal` with `LintOptionsModal` for lint button |
| `tests/utils/raw-frontmatter.test.ts` | Modify | Add `stripInvalidWikiArticles` test suite |
| `tests/phases/lint.test.ts` | Modify | Add integration tests for `useLlm=false` and `wiki_articles` stripping |
| `tests/phases/ingest.test.ts` | Modify | Add integration test for `wiki_articles` stripping |
| `tests/modals.test.ts` | Modify | Add `LintOptionsModal` test suite |

---

## Task 1: `stripInvalidWikiArticles` — unit tests

**Files:**
- Modify: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1: Add failing tests for `stripInvalidWikiArticles`**

Append to `tests/utils/raw-frontmatter.test.ts`:

```typescript
import { ..., stripInvalidWikiArticles } from "../../src/utils/raw-frontmatter";

describe("stripInvalidWikiArticles", () => {
  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — plain text removed]]
  it("removes plain-text entry and emits warning", () => {
    const content = "---\nwiki_articles:\n  - Иммуномодуляторы\n---\nBody.";
    const { content: out, warnings } = stripInvalidWikiArticles(content, new Set([]));
    expect(out).not.toContain("Иммуномодуляторы");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Иммуномодуляторы");
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — non-wiki stem removed]]
  it("removes [[ИРС-19]] (non-wiki_* stem) and emits warning", () => {
    const content = "---\nwiki_articles:\n  - '[[ИРС-19]]'\n---\nBody.";
    const { content: out, warnings } = stripInvalidWikiArticles(content, new Set(["ИРС-19"]));
    expect(out).not.toContain("ИРС-19");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ИРС-19");
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — absent wiki stem removed]]
  it("removes valid wiki_* stem not in existingWikiStems", () => {
    const content = "---\nwiki_articles:\n  - '[[wiki_x_thing]]'\n---\nBody.";
    const { content: out, warnings } = stripInvalidWikiArticles(content, new Set([]));
    expect(out).not.toContain("wiki_x_thing");
    expect(warnings).toHaveLength(1);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — present wiki stem kept]]
  it("keeps valid wiki_* stem present in existingWikiStems", () => {
    const content = "---\nwiki_articles:\n  - '[[wiki_x_thing]]'\n---\nBody.";
    const { content: out, warnings } = stripInvalidWikiArticles(content, new Set(["wiki_x_thing"]));
    expect(out).toContain("wiki_x_thing");
    expect(warnings).toHaveLength(0);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — other fields untouched]]
  it("does not modify fields other than wiki_articles", () => {
    const content = "---\ntitle: My Doc\nwiki_articles:\n  - Стоп\n---\nBody.";
    const { content: out } = stripInvalidWikiArticles(content, new Set([]));
    expect(out).toContain("title: My Doc");
    expect(out).toContain("Body.");
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#stripInvalidWikiArticles — empty wiki_articles noop]]
  it("returns content unchanged when wiki_articles is empty", () => {
    const content = "---\nwiki_articles: []\n---\nBody.";
    const { content: out, warnings } = stripInvalidWikiArticles(content, new Set([]));
    expect(out).toBe(content);
    expect(warnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts 2>&1 | tail -20
```

Expected: FAIL — `stripInvalidWikiArticles is not exported`

---

## Task 2: `stripInvalidWikiArticles` — implementation

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`

- [ ] **Step 1: Add import for `GENERIC_WIKI_STEM_REGEX`**

At the top of `src/utils/raw-frontmatter.ts`, add:

```typescript
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";
```

- [ ] **Step 2: Add `stripInvalidWikiArticles` function after `filterStaleWikiLinks`**

```typescript
export function stripInvalidWikiArticles(
  content: string,
  existingWikiStems: Set<string>,
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, warnings };

  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, warnings };
  }

  const val = parsed["wiki_articles"];
  if (!Array.isArray(val) || (val as unknown[]).length === 0) return { content, warnings };

  const filtered = (val as string[]).filter((entry) => {
    if (!WIKILINK_RE.test(entry)) {
      warnings.push(`wiki_articles: plain text "${entry}" — removed`);
      return false;
    }
    const stem = entry.slice(2, -2);
    if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
      warnings.push(`wiki_articles: non-wiki stem ${entry} — removed`);
      return false;
    }
    if (!existingWikiStems.has(stem)) {
      warnings.push(`wiki_articles: stale link ${entry} — removed`);
      return false;
    }
    return true;
  });

  if (filtered.length === (val as string[]).length) return { content, warnings };
  parsed["wiki_articles"] = filtered;
  const body = content.slice(fmMatch[0].length);
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}
```

- [ ] **Step 3: Run unit tests and confirm they pass**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts 2>&1 | tail -20
```

Expected: All `stripInvalidWikiArticles` tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(raw-frontmatter): add stripInvalidWikiArticles"
```

---

## Task 3: Wire `stripInvalidWikiArticles` into `lint.ts`

**Files:**
- Modify: `src/phases/lint.ts`

The current source-file loop (around line 527) uses `filterStaleWikiLinks` for `wiki_articles`. Replace it with `stripInvalidWikiArticles`.

- [ ] **Step 1: Add import**

In `src/phases/lint.ts`, update the import from `raw-frontmatter`:

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, filterStaleWikiLinks, validateAndRepairWikiPageFrontmatter, stripInvalidWikiArticles } from "../utils/raw-frontmatter";
```

- [ ] **Step 2: Replace `filterStaleWikiLinks` for `wiki_articles` in the source-file loop**

Find (around line 527):
```typescript
      const { content: filteredContent } =
        filterStaleWikiLinks(rawContent, existingWikiStems, ["wiki_articles"]);
      if (filteredContent !== rawContent) await vaultTools.write(sourcePath, filteredContent);
```

Replace with:
```typescript
      const { content: filteredContent, warnings: stripWarnings } =
        stripInvalidWikiArticles(rawContent, existingWikiStems);
      if (stripWarnings.length > 0) {
        yield { kind: "info_text", icon: "⚠️", summary: `wiki_articles repaired: ${sourcePath}`, details: stripWarnings };
      }
      if (filteredContent !== rawContent) await vaultTools.write(sourcePath, filteredContent);
```

- [ ] **Step 3: Run existing lint tests**

```bash
npx vitest run tests/phases/lint.test.ts 2>&1 | tail -20
```

Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): use stripInvalidWikiArticles for wiki_articles source cleanup"
```

---

## Task 4: Wire `stripInvalidWikiArticles` into `ingest.ts`

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `tests/phases/ingest.test.ts`

Current code (around line 445):
```typescript
    const existingArticleStems = parseWikiArticlesFromFm(repairedSource)
      .map(link => link.slice(2, -2))
      .filter(stem => !GENERIC_WIKI_STEM_REGEX.test(stem));
    const existingStems = new Set([...wikiFileStems, ...existingArticleStems]);
    const { content: filteredSource, warnings: staleWarnings } =
      filterStaleWikiLinks(repairedSource, existingStems, ["wiki_articles", "related"]);
```

- [ ] **Step 1: Add `stripInvalidWikiArticles` to import**

In `src/phases/ingest.ts`, update the import from `raw-frontmatter`:

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, hasFrontmatterField, validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter, filterStaleWikiLinks, ensureWikiSources, stripInvalidWikiArticles } from "../utils/raw-frontmatter";
```

- [ ] **Step 2: Replace the `existingArticleStems` block**

Remove lines 445–450 (the `existingArticleStems` block + `filterStaleWikiLinks` for wiki_articles+related) and replace with:

```typescript
    const { content: wikiArticlesFiltered, warnings: wikiArticlesWarnings } =
      stripInvalidWikiArticles(repairedSource, wikiFileStems);
    const { content: filteredSource, warnings: relatedWarnings } =
      filterStaleWikiLinks(wikiArticlesFiltered, wikiFileStems, ["related"]);
    const staleWarnings = [...wikiArticlesWarnings, ...relatedWarnings];
```

Also remove the import of `GENERIC_WIKI_STEM_REGEX` from `wiki-stem` in `ingest.ts` **only if** it is no longer used after this change. Check first:

```bash
grep -n "GENERIC_WIKI_STEM_REGEX" src/phases/ingest.ts
```

If only lines 445-448 (the removed block) used it, remove from the import. If it's used elsewhere (e.g. line 205), leave it.

- [ ] **Step 3: Update existing test that expected `[[Other]]` to be preserved**

The test "source backlinks drop deleted page stems" in `tests/phases/ingest.test.ts` (around line 1193) previously expected `[[Other]]` (a non-`wiki_*` stem) to be kept. After the change, `stripInvalidWikiArticles` removes non-`wiki_*` wikilinks. Update the assertion:

Find:
```typescript
    expect(updated).not.toContain("[[wiki_work_old]]");
    expect(updated).toContain("[[Other]]");
    expect(updated).toContain("[[wiki_work_new]]");
```

Replace with:
```typescript
    expect(updated).not.toContain("[[wiki_work_old]]");
    expect(updated).not.toContain("[[Other]]");   // non-wiki_* stem stripped by stripInvalidWikiArticles
    expect(updated).toContain("[[wiki_work_new]]");
```

- [ ] **Step 4: Run ingest tests**

```bash
npx vitest run tests/phases/ingest.test.ts 2>&1 | tail -20
```

Expected: All tests PASS (including the updated assertion)

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): use stripInvalidWikiArticles for wiki_articles, remove non-wiki stem preservation"
```

---

## Task 5: `lintOptions` setting — type, default, i18n, UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/i18n.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Add `lintOptions` to `LlmWikiPluginSettings` in `src/types.ts`**

Find the `LlmWikiPluginSettings` interface (line ~143) and add after `devMode`:

```typescript
  lintOptions: {
    useLlm: boolean;
  };
```

Find `DEFAULT_SETTINGS` (line ~196) and add after `devMode`:

```typescript
  lintOptions: {
    useLlm: true,
  },
```

- [ ] **Step 2: Add i18n keys to all 3 locales in `src/i18n.ts`**

Before `h3_graph` in the **English** settings section (line ~75), add:
```typescript
    h3_lint: "Lint",
    lintUseLlm_name: "Use LLM for lint",
    lintUseLlm_desc: "Uncheck to run programmatic-only lint (no LLM calls, much faster). Serves as default for the per-run modal toggle.",
```

In the **English** modal section (around line 163), after `allWiki`, add:
```typescript
    lint_title: "Lint Wiki",
```

Before `h3_graph` in the **Russian** settings section (line ~301), add:
```typescript
    h3_lint: "Lint",
    lintUseLlm_name: "Использовать LLM для lint",
    lintUseLlm_desc: "Снять флажок для программного lint без LLM (намного быстрее). Служит значением по умолчанию для переключателя в модальном окне.",
```

In the **Russian** modal section (around line 389), after `allWiki`, add:
```typescript
    lint_title: "Lint Wiki",
```

Before `h3_graph` in the **Spanish** settings section (line ~525), add:
```typescript
    h3_lint: "Lint",
    lintUseLlm_name: "Usar LLM para lint",
    lintUseLlm_desc: "Desmarcar para ejecutar lint solo programático (sin llamadas LLM, mucho más rápido). Sirve como valor predeterminado para el toggle del modal.",
```

In the **Spanish** modal section (around line 613), after `allWiki`, add:
```typescript
    lint_title: "Lint Wiki",
```

- [ ] **Step 3: Verify i18n TypeScript type is inferred (run tsc)**

```bash
npx tsc --noEmit 2>&1 | grep -i "i18n\|lintUseLlm\|h3_lint" | head -10
```

Expected: No errors for the new keys (type is inferred from the object, not from an explicit interface).

- [ ] **Step 4: Add "Lint" settings section in `src/settings.ts`**

Before `// ── Graph settings ───` comment (around line 619), add:

```typescript
    // ── Lint settings ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName(T.settings.h3_lint).setHeading();

    new Setting(containerEl)
      .setName(T.settings.lintUseLlm_name)
      .setDesc(T.settings.lintUseLlm_desc)
      .addToggle((t) =>
        t.setValue(s.lintOptions.useLlm)
          .onChange(async (v) => {
            s.lintOptions.useLlm = v;
            await this.plugin.saveSettings();
          }),
      );

```

- [ ] **Step 5: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/i18n.ts src/settings.ts
git commit -m "feat(settings): add lintOptions.useLlm with settings UI and i18n"
```

---

## Task 6: `LintOptionsModal` — implementation

**Files:**
- Modify: `src/modals.ts`

- [ ] **Step 1: Add `LintOptionsModal` class at the end of `src/modals.ts`**

```typescript
export class LintOptionsModal extends Modal {
  private domain: string;
  private useLlm: boolean;
  private entityTypeFilter: string[];
  private entitySection: HTMLElement | null = null;

  constructor(
    app: App,
    private domains: DomainEntry[],
    private defaultUseLlm: boolean,
    private onSubmit: (
      domain: string,
      opts: { useLlm: boolean; entityTypeFilter: string[] },
    ) => void,
  ) {
    super(app);
    this.domain = "all";
    this.useLlm = defaultUseLlm;
    this.entityTypeFilter = [];
  }

  onOpen(): void {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.lint_title });

    new Setting(contentEl)
      .setName(T.domain_name)
      .addDropdown(d => {
        d.addOption("all", T.allWiki);
        for (const entry of this.domains) d.addOption(entry.id, entry.name || entry.id);
        d.setValue(this.domain);
        d.onChange(v => {
          this.domain = v;
          if (v === "all") this.entityTypeFilter = [];
          this.renderEntitySection();
        });
      });

    this.entitySection = contentEl.createDiv();
    this.renderEntitySection();

    new Setting(contentEl)
      .setName("Use LLM")
      .addToggle(t => t.setValue(this.useLlm).onChange(v => { this.useLlm = v; }));

    new Setting(contentEl)
      .addButton(b =>
        b.setButtonText(`▶ ${T.run}`)
          .setCta()
          .onClick(() => {
            this.close();
            this.submit();
          }),
      );
  }

  private renderEntitySection(): void {
    if (this.entitySection) this.entitySection.empty();
    if (this.domain === "all") return;
    const domainEntry = this.domains.find(d => d.id === this.domain);
    const entityTypes = domainEntry?.entity_types ?? [];
    if (!entityTypes.length) return;
    if (!this.entitySection) return;
    this.entitySection.createEl("p", { text: "Entity types:" });
    this.entityTypeFilter = entityTypes.map(e => e.type);
    for (const et of entityTypes) {
      new Setting(this.entitySection!)
        .setName(et.type)
        .addToggle(t => {
          t.setValue(true);
          t.onChange(checked => {
            if (checked) {
              if (!this.entityTypeFilter.includes(et.type)) this.entityTypeFilter.push(et.type);
            } else {
              this.entityTypeFilter = this.entityTypeFilter.filter(x => x !== et.type);
            }
          });
        });
    }
  }

  private submit(): void {
    this.onSubmit(this.domain, {
      useLlm: this.useLlm,
      entityTypeFilter: this.domain === "all" ? [] : [...this.entityTypeFilter],
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add LintOptionsModal with domain, entity filter, and LLM toggle"
```

---

## Task 7: `LintOptionsModal` — tests

**Files:**
- Modify: `tests/modals.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/modals.test.ts`:

```typescript
import { ..., LintOptionsModal } from "../src/modals";

describe("LintOptionsModal", () => {
  const domains: DomainEntry[] = [
    {
      id: "pharma",
      name: "Pharma",
      wiki_folder: "wiki",
      source_paths: [],
      entity_types: [
        { type: "Drug", description: "A drug", extraction_cues: [], min_mentions_for_page: 1, wiki_subfolder: "drugs" },
        { type: "Condition", description: "A condition", extraction_cues: [], min_mentions_for_page: 1, wiki_subfolder: "conditions" },
      ],
    },
  ];

  it("initialises domain to 'all'", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    expect((m as any).domain).toBe("all");
  });

  it("initialises useLlm from defaultUseLlm=false", () => {
    const m = new LintOptionsModal({} as any, domains, false, vi.fn());
    expect((m as any).useLlm).toBe(false);
  });

  it("initialises useLlm from defaultUseLlm=true", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    expect((m as any).useLlm).toBe(true);
  });

  it("submit calls onSubmit with domain='all' and entityTypeFilter=[]", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "all";
    (m as any).entityTypeFilter = [];
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("all", { useLlm: true, entityTypeFilter: [] });
  });

  it("submit forces entityTypeFilter=[] when domain is 'all'", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "all";
    (m as any).entityTypeFilter = ["Drug"];
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("all", { useLlm: true, entityTypeFilter: [] });
  });

  it("submit passes entityTypeFilter when domain is not 'all'", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "pharma";
    (m as any).entityTypeFilter = ["Drug"];
    (m as any).useLlm = false;
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("pharma", { useLlm: false, entityTypeFilter: ["Drug"] });
  });

  it("renderEntitySection populates entityTypeFilter with all domain entity types", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    (m as any).domain = "pharma";
    (m as any).entitySection = { empty: vi.fn(), createEl: vi.fn() };
    (m as any).renderEntitySection();
    expect((m as any).entityTypeFilter).toEqual(["Drug", "Condition"]);
  });

  it("renderEntitySection empties entitySection and returns early when domain is 'all'", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    const mockSection = { empty: vi.fn(), createEl: vi.fn() };
    (m as any).domain = "all";
    (m as any).entitySection = mockSection;
    (m as any).renderEntitySection();
    expect(mockSection.empty).toHaveBeenCalled();
    expect((m as any).entityTypeFilter).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/modals.test.ts 2>&1 | tail -20
```

Expected: All `LintOptionsModal` tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/modals.test.ts
git commit -m "test(modals): add LintOptionsModal tests"
```

---

## Task 8: Wire `useLlm`/`entityTypeFilter` through `RunRequest` → `runLint`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/controller.ts`
- Modify: `src/agent-runner.ts`
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Add `lintOpts?` to `RunRequest` in `src/types.ts`**

Find `interface RunRequest` (line 26) and add after `operationHeader?`:

```typescript
  lintOpts?: { useLlm: boolean; entityTypeFilter: string[] };
```

- [ ] **Step 2: Update `controller.lint` signature and `dispatch` in `src/controller.ts`**

Replace `async lint` (line ~189):
```typescript
  async lint(domain: string, opts: { useLlm?: boolean; entityTypeFilter?: string[] } = {}): Promise<void> {
    const args = domain === "all" ? [] : [domain];
    const lintOpts = { useLlm: opts.useLlm ?? true, entityTypeFilter: opts.entityTypeFilter ?? [] };
    await this.dispatch("lint", args, undefined, undefined, undefined, undefined, undefined, lintOpts);
  }
```

Update `dispatch` private signature (line ~546) — add `lintOpts?` as last parameter:
```typescript
  private async dispatch(op: WikiOperation, args: string[], domainId?: string, context?: string, instruction?: string, onFileError?: OnFileError, chatMessages?: ChatMessage[], lintOpts?: { useLlm: boolean; entityTypeFilter: string[] }): Promise<void> {
```

In the `agentRunner.run(...)` call inside `dispatch`, add `lintOpts`:
```typescript
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages: resolvedChatMessages, lintOpts });
```

- [ ] **Step 3: Update `runLint` signature in `src/phases/lint.ts`**

Replace the function signature (line ~154):
```typescript
export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  wikiLinkValidationRetries: number = 3,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
  useLlm: boolean = true,
  entityTypeFilter: string[] = [],
): AsyncGenerator<RunEvent>
```

- [ ] **Step 4: Wrap LLM loop and `actualizeDomainConfig` in `if (useLlm)` in `src/phases/lint.ts`**

Find the declaration of `total` and the per-article loop comment. Replace from `const total = articlePaths.length;` through the end of the `actualizeDomainConfig` block (including the skipped articles summary and deleted refs rewrite) with:

```typescript
    if (useLlm) {
      const loopPaths = entityTypeFilter.length > 0
        ? articlePaths.filter(p =>
            entityTypeFilter.some(et => {
              const subfolder = domain.entity_types
                ?.find(e => e.type === et)?.wiki_subfolder;
              return subfolder && p.includes(`/${subfolder}/`);
            })
          )
        : articlePaths;
      const total = loopPaths.length;

      // ── Per-article loop (lines 262–423 in original lint.ts, unchanged) ────
      for (let i = 0; i < total; i++) {
        // [KEEP lines 263–422 exactly as-is from existing lint.ts]
        // ONLY CHANGE: line 265 — replace `articlePaths[i]` with `loopPaths[i]`
        //   Before: const targetPath = articlePaths[i];
        //   After:  const targetPath = loopPaths[i];
      }
      // ── End per-article loop ─────────────────────────────────────────────────

      // [KEEP orphan check block lines 428–439 unchanged]
      for (const wikiPath of writtenPaths) { /* unchanged */ }

      // [KEEP skippedArticles summary lines 449–450 unchanged]
      if (skippedArticles.length > 0) {
        reportParts.push(`### Пропущены (ошибка LLM)\n${skippedArticles.map(a => `- ${a}.md`).join("\n")}`);
      }

      // [KEEP deletedRefs scan block lines 454–468 unchanged]
      if (deletedRefs.length > 0) { /* unchanged */ }

      if (signal.aborted) return;

      // actualizeDomainConfig
      yield { kind: "assistant_text", delta: `\nActualizing domain config for "${domain.id}"...\n` };
      yield { kind: "tool_use", name: "Updating config", input: {} };
      const patchRes = await actualizeDomainConfig(domain, pages, llm, model, opts, signal);
      yield { kind: "tool_result", ok: true, preview: patchRes.patch ? "config updated" : "no changes" };
      outputTokens += patchRes.outputTokens;
      const patch = patchRes.patch;
      if (patch) {
        const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
        reportParts.push(diffReport);
        yield { kind: "domain_updated", domainId: domain.id, patch };
      }

      if (signal.aborted) return;
    }
    // ── End useLlm block ─────────────────────────────────────────────────────
```

**Single code change inside the block:** line 265 of `src/phases/lint.ts`:
```typescript
// Before:
const targetPath = articlePaths[i];
// After:
const targetPath = loopPaths[i];
```
Everything else inside the loops stays byte-for-byte identical.

- [ ] **Step 5: Update `agent-runner.ts` to pass `lintOpts` to `runLint`**

Find line ~98 in `src/agent-runner.ts`:
```typescript
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.wikiLinkValidationRetries, opts, similarity);
```

Replace with:
```typescript
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.wikiLinkValidationRetries, opts, similarity, req.lintOpts?.useLlm ?? true, req.lintOpts?.entityTypeFilter ?? []);
```

- [ ] **Step 6: Run type check and all tests**

```bash
npx tsc --noEmit 2>&1 | head -20
npx vitest run tests/phases/lint.test.ts tests/phases/ingest.test.ts 2>&1 | tail -30
```

Expected: No type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/controller.ts src/agent-runner.ts src/phases/lint.ts
git commit -m "feat(lint): add useLlm/entityTypeFilter params, wire through RunRequest"
```

---

## Task 9: Update `main.ts` and `view.ts` callers

**Files:**
- Modify: `src/main.ts`
- Modify: `src/view.ts`

- [ ] **Step 1: Update `src/main.ts` lint command**

Find (around line 99):
```typescript
            new DomainModal(this.app, T.cmd.lint, true, null, domains,
              (d) => void this.controller.lint(d)).open();
```

Replace with:
```typescript
            new LintOptionsModal(this.app, domains, this.settings.lintOptions.useLlm,
              (d, opts) => void this.controller.lint(d, opts)).open();
```

Add `LintOptionsModal` to the import from `./modals` at the top of `src/main.ts`.

- [ ] **Step 2: Update `src/view.ts` lint button**

Find (lines 346–352):
```typescript
      this.lintBtn.addEventListener("click", () => {
        const d = this.domainSelect!.value;
        const domainLabel = d ? `«${d}»` : "all wiki";
        new ConfirmModal(this.plugin.app, "Lint — confirm", [
          `Domain: ${domainLabel}`,
          "Claude will check wiki pages for quality and update entity_types.",
        ], () => void this.plugin.controller.lint(d || "all")).open();
      });
```

Replace with:
```typescript
      this.lintBtn.addEventListener("click", () => {
        new LintOptionsModal(
          this.plugin.app,
          this.plugin.settings.domains,
          this.plugin.settings.lintOptions.useLlm,
          (domain, opts) => void this.plugin.controller.lint(domain, opts),
        ).open();
      });
```

Add `LintOptionsModal` to the import from `./modals` at the top of `src/view.ts`. Keep `ConfirmModal` in the import — it is still used at lines 341, 390, 443, 482.

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/view.ts
git commit -m "feat(ui): replace DomainModal/ConfirmModal with LintOptionsModal for lint entry points"
```

---

## Task 10: Integration tests

**Files:**
- Modify: `tests/phases/lint.test.ts`
- Modify: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Add lint integration tests**

Append to `tests/phases/lint.test.ts`:

```typescript
describe("runLint — stripInvalidWikiArticles integration", () => {
  // @lat: [[lat.md/tests#Tests#Lint#stripInvalidWikiArticles in lint — plain text stripped]]
  it("strips plain-text wiki_articles entries from source files after lint", async () => {
    const sourceContent = "---\nwiki_articles:\n  - Иммуномодуляторы\n---\nBody.";
    const wikiContent = "---\nwiki_sources: []\n---\nWiki body.";

    const adapter = mockAdapter({
      list: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("!Wiki")) return { files: ["!Wiki/wiki_pharma_drug.md"], folders: [] };
        return { files: ["source.md", "!Wiki/wiki_pharma_drug.md"], folders: ["!Wiki"] };
      }),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("wiki_pharma_drug")) return wikiContent;
        return sourceContent;
      }),
      write: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
    });
    const vaultTools = new VaultTools(adapter, "/vault");
    const domain: DomainEntry = {
      id: "pharma", name: "Pharma", wiki_folder: "!Wiki/pharma",
      source_paths: ["/vault"], entity_types: [],
    };
    const llm = makeLlm('{"fixes":[],"deletes":[],"report":"ok"}', '{}');

    const events: RunEvent[] = [];
    for await (const ev of runLint([], vaultTools, llm, "model", [domain], "/vault", new AbortController().signal, 0, {}, undefined, true, [])) {
      events.push(ev);
    }

    const writeCalls = (adapter.write as ReturnType<typeof vi.fn>).mock.calls;
    const sourceWrite = writeCalls.find(([p]: [string]) => p.includes("source"));
    expect(sourceWrite).toBeDefined();
    expect(sourceWrite![1]).not.toContain("Иммуномодуляторы");
  });

  // @lat: [[lat.md/tests#Tests#Lint#useLlm=false skips LLM loop]]
  it("useLlm=false: skips LLM calls entirely", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      read: vi.fn().mockResolvedValue("---\n---\n"),
    });
    const vaultTools = new VaultTools(adapter, "/vault");
    const domain: DomainEntry = {
      id: "d", name: "D", wiki_folder: "!Wiki/d",
      source_paths: ["/vault"], entity_types: [],
    };
    const llm = { chat: { completions: { create: vi.fn() } } } as unknown as LlmClient;

    for await (const _ of runLint([], vaultTools, llm, "model", [domain], "/vault", new AbortController().signal, 0, {}, undefined, false, [])) {
      // consume
    }

    expect(llm.chat.completions.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add ingest integration test**

Append a new describe block to `tests/phases/ingest.test.ts`:

```typescript
describe("runIngest — stripInvalidWikiArticles", () => {
  // @lat: [[lat.md/tests#Tests#Ingest#stripInvalidWikiArticles in ingest — non-wiki stem stripped]]
  it("strips [[ИРС-19]] (non-wiki_* stem) from wiki_articles during ingest", async () => {
    const existingFm =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[ИРС-19]]"\n  - "[[wiki_work_live]]"\n---\nsource text';
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "Sources/doc.md") return existingFm;
        if (path === "!Wiki/work/wiki_work_live.md") return "# Live";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/wiki_work_live.md"], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "NewPage" }] }),
      JSON.stringify({
        reasoning: "x",
        pages: [{ path: "!Wiki/work/entities/wiki_work_new_page.md", content: "# NewPage" }],
      }),
    ]);

    await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        llm,
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );

    const sourceWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p === "Sources/doc.md",
    );
    expect(sourceWrite).toBeDefined();
    const written = sourceWrite![1] as string;
    expect(written).not.toContain("[[ИРС-19]]");
    expect(written).toContain("[[wiki_work_live]]");
  });
});
```

- [ ] **Step 3: Run all new tests**

```bash
npx vitest run tests/phases/lint.test.ts tests/phases/ingest.test.ts 2>&1 | tail -30
```

Expected: All tests pass (new + existing)

- [ ] **Step 4: Commit**

```bash
git add tests/phases/lint.test.ts tests/phases/ingest.test.ts
git commit -m "test(lint,ingest): add integration tests for stripInvalidWikiArticles and useLlm=false"
```

---

## Task 11: lat.md update + lat check

**Files:**
- Modify: `lat.md/` files as needed
- Run: `lat check`

- [ ] **Step 1: Add new test spec sections to `lat.md/tests.md`**

Add a `stripInvalidWikiArticles` subsection under `Frontmatter Validation` (or create a new group) with entries matching the `@lat:` annotations added in Tasks 1 and 10:

- `stripInvalidWikiArticles — plain text removed`
- `stripInvalidWikiArticles — non-wiki stem removed`
- `stripInvalidWikiArticles — absent wiki stem removed`
- `stripInvalidWikiArticles — present wiki stem kept`
- `stripInvalidWikiArticles — other fields untouched`
- `stripInvalidWikiArticles — empty wiki_articles noop`

And under a `Lint` group:
- `stripInvalidWikiArticles in lint — plain text stripped`
- `useLlm=false skips LLM loop`

And under an `Ingest` group:
- `stripInvalidWikiArticles in ingest — non-wiki stem stripped`

Each section requires a leading paragraph (≥1 sentence, ≤250 chars).

- [ ] **Step 2: Update `lat.md/operations.md` Lint section**

Add a note that `runLint` accepts `useLlm` and `entityTypeFilter` params, with the execution flow from the spec.

- [ ] **Step 3: Run lat check**

```bash
lat check 2>&1
```

Expected: All checks pass (no broken links, all `@lat:` refs resolve)

- [ ] **Step 4: Final full test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add lat.md/
git commit -m "docs(lat.md): add stripInvalidWikiArticles test specs + lint useLlm/entityTypeFilter docs"
```
