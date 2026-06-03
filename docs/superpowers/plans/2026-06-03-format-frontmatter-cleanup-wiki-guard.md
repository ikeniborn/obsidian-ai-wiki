---
review:
  plan_hash: 24754db8d8fb224b
  spec_hash: 32dd57c0aee89372
  last_run: 2026-06-03
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: dependencies
      severity: WARNING
      section: "## Task 5: Wire up patchWikiFields cleanup + replace wiki guard in controller.ts"
      section_hash: e235d6b1891119d2
      text: "Task 5 has implicit deps on Tasks 1, 3, 4 (validateAndRepairSourceFrontmatter, InfoModal, formatInWikiClose) — not declared; safe only if tasks run strictly in order"
      verdict: fixed
      verdict_at: 2026-06-03
    - id: F-002
      phase: coverage
      severity: INFO
      section: "## File Map"
      section_hash: 558122199fb26f34
      text: "Plan includes tests + lat.md/tests.md; spec marks 'Tests update (separate task)' as out of scope — plan correctly extends scope for complete TDD implementation"
      verdict: accepted
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-03-format-frontmatter-cleanup-wiki-guard-design.md
---
# Format Frontmatter Cleanup + Wiki Article Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip forbidden wiki_* fields and path-style wikilinks from source frontmatter after format apply, and replace the ConfirmModal wiki article guard with a simple InfoModal.

**Architecture:** Four files change. `raw-frontmatter.ts` gains a new `list-wikilinks-stem-only` rule kind and strips forbidden wiki_* fields via `SOURCE_RULES`. `patchWikiFields` in `controller.ts` calls `validateAndRepairSourceFrontmatter` after `upsertRawFrontmatter`. `modals.ts` gets a new `InfoModal`. `i18n.ts` gets updated/new keys.

**Tech Stack:** TypeScript, Vitest, Obsidian API (Modal, Setting, App)

---

## File Map

| File | Change |
|------|--------|
| `src/utils/raw-frontmatter.ts` | Add `list-wikilinks-stem-only` to `FieldRule` union + switch; update `SOURCE_RULES` |
| `tests/utils/raw-frontmatter.test.ts` | Add tests for new kind + `remove` rules in source FM |
| `src/modals.ts` | Add `InfoModal` class |
| `src/i18n.ts` | Update `formatInWikiTitle`, `formatInWikiBody`; add `formatInWikiClose` (en/ru/es) |
| `src/controller.ts` | `patchWikiFields` calls `validateAndRepairSourceFrontmatter`; import updated; wiki guard uses `InfoModal`; remove `suggestIngestForWikiFile` |
| `tests/controller-format.test.ts` | Update wiki-guard test: guard now opens InfoModal (no dispatch) |
| `lat.md/tests.md` | Add spec sections for new test cases |

---

## Task 1: Add `list-wikilinks-stem-only` kind to raw-frontmatter.ts

**Files:**
- Modify: `src/utils/raw-frontmatter.ts`
- Test: `tests/utils/raw-frontmatter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils/raw-frontmatter.test.ts`, inside the existing `describe("validateAndRepairSourceFrontmatter", ...)` block (after the last test there, before the closing `}`):

```typescript
  // @lat: [[tests#Frontmatter Validation#Source path-style wikilink removal]]
  it("removes wiki_articles entry that is a path-style wikilink", () => {
    const content = `---
wiki_articles:
  - "[[wiki_valid]]"
  - "[[!Wiki/health/procedures/file.md]]"
  - "[[some/nested/stem]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("[[!Wiki/health/procedures/file.md]]");
    expect(out).not.toContain("[[some/nested/stem]]");
    expect(warnings.some((w) => w.includes("wiki_articles") && w.includes("!Wiki/health"))).toBe(true);
    expect(warnings.some((w) => w.includes("wiki_articles") && w.includes("some/nested"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source path-style dot-md wikilink removal]]
  it("removes wiki_articles entry ending with .md]]", () => {
    const content = `---
wiki_articles:
  - "[[wiki_health]]"
  - "[[procedures/file.md]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_health]]");
    expect(out).not.toContain("[[procedures/file.md]]");
    expect(warnings.some((w) => w.includes("wiki_articles"))).toBe(true);
  });
```

Also add inside the same `describe` block:

```typescript
  // @lat: [[tests#Frontmatter Validation#Source forbidden wiki field removal]]
  it("removes forbidden wiki_outgoing_links from source frontmatter", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_foo]]"
wiki_added: 2026-01-01
wiki_updated: 2026-06-01
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).not.toContain("wiki_outgoing_links:");
    expect(out).toContain("wiki_added: 2026-01-01");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source forbidden wiki_sources removal]]
  it("removes wiki_sources from source frontmatter", () => {
    const content = `---
wiki_sources:
  - "[[my_note]]"
wiki_updated: 2026-06-01
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).not.toContain("wiki_sources:");
    expect(warnings.some((w) => w.includes("wiki_sources"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source forbidden annotation removal]]
  it("removes annotation from source frontmatter", () => {
    const content = `---
wiki_added: 2026-01-01
wiki_updated: 2026-06-01
annotation: "some note"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).not.toContain("annotation:");
    expect(warnings.some((w) => w.includes("annotation"))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|✗|×|Error" | head -20
```

Expected: Tests fail because `list-wikilinks-stem-only` kind doesn't exist yet and `SOURCE_RULES` doesn't have `remove` rules.

- [ ] **Step 3: Add `list-wikilinks-stem-only` to `FieldRule` union in `src/utils/raw-frontmatter.ts`**

Find the `FieldRule` type (line 11) and add the new variant:

```typescript
export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-wikilinks-stem-only" }   // ADD THIS LINE
  | { field: string; kind: "list-wikilinks-wiki-only" }
  | { field: string; kind: "list-wikilinks-sources-only" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] }
  | { field: string; kind: "remove" };
```

- [ ] **Step 4: Add case for `list-wikilinks-stem-only` to the switch in `validateAndRepairFrontmatter`**

In the `switch (rule.kind)` block, the `case "list-wikilinks":` group currently is:

```typescript
      case "list-wikilinks":
      case "list-urls":
      case "list-tags": {
```

Change that to handle `list-wikilinks-stem-only` separately. Add a new case **before** the `list-wikilinks-wiki-only` case block (around line 117):

```typescript
      case "list-wikilinks-stem-only": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !WIKILINK_RE.test(v) || v.includes("/") || v.endsWith(".md]]")) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
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

- [ ] **Step 5: Update `SOURCE_RULES` to use new kind and add `remove` rules**

Replace the current `SOURCE_RULES` constant (around line 231) with:

```typescript
const SOURCE_RULES: FieldRule[] = [
  { field: "wiki_articles",       kind: "list-wikilinks-stem-only" },
  { field: "wiki_added",          kind: "date-scalar" },
  { field: "wiki_updated",        kind: "date-scalar" },
  { field: "tags",                kind: "list-tags" },
  { field: "aliases",             kind: "aliases" },
  { field: "created",             kind: "date-scalar" },
  { field: "updated",             kind: "date-scalar" },
  { field: "external_links",      kind: "list-urls" },
  { field: "related",             kind: "list-wikilinks" },
  { field: "wiki_outgoing_links", kind: "remove" },
  { field: "wiki_sources",        kind: "remove" },
  { field: "wiki_status",         kind: "remove" },
  { field: "wiki_type",           kind: "remove" },
  { field: "wiki_external_links", kind: "remove" },
  { field: "annotation",          kind: "remove" },
];
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/utils/raw-frontmatter.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: All raw-frontmatter tests pass.

- [ ] **Step 7: Verify existing test for `"Source invalid wikilink removal"` still passes**

The existing test `"removes wiki_articles entry that is not a wikilink"` must still pass — it checks that `"not-a-wikilink"` (a non-`[[...]]` string) is rejected. The new `list-wikilinks-stem-only` kind rejects that too.

- [ ] **Step 8: Run full test suite to check no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: All 891+ tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/utils/raw-frontmatter.ts tests/utils/raw-frontmatter.test.ts
git commit -m "feat(frontmatter): add list-wikilinks-stem-only rule kind; strip forbidden wiki_* fields from SOURCE_RULES"
```

---

## Task 2: Add spec sections to lat.md/tests.md

**Files:**
- Modify: `lat.md/tests.md`

The new tests in Task 1 reference `@lat:` sections that don't exist yet. Add them now.

- [ ] **Step 1: Read current tests.md to find the right insertion point**

```bash
grep -n "### Source related invalid entry removal\|### Source body preservation\|## Wiki Page" lat.md/tests.md | head -5
```

Find the line number of `### Source body preservation` — new sections go after it and before `## Wiki Page Frontmatter Validation`.

- [ ] **Step 2: Insert new spec sections into `lat.md/tests.md`**

After the `### Source body preservation` section (and its content), before `## Wiki Page Frontmatter Validation`, add:

```markdown
### Source path-style wikilink removal

Entries in `wiki_articles` that contain `/` or end with `.md]]` are path-style links, not stems. They are removed and a warning is emitted. Valid stem links like `[[wiki_valid]]` are kept.

### Source path-style dot-md wikilink removal

Entries in `wiki_articles` ending with `.md]]` (e.g. `[[procedures/file.md]]`) are rejected even if they pass the basic `[[...]]` test, because they reference a path, not a stem.

### Source forbidden wiki field removal

Fields like `wiki_outgoing_links`, `wiki_sources`, `wiki_status`, `wiki_type`, `wiki_external_links` belong to wiki pages only. When present in source frontmatter, they are removed silently with a warning.

### Source forbidden wiki_sources removal

`wiki_sources` in source frontmatter (files outside `!Wiki/`) is a wiki-page-only field and must be stripped.

### Source forbidden annotation removal

`annotation` is a wiki-page-only field and must be stripped from source file frontmatter.
```

- [ ] **Step 3: Run lat check to verify links are valid**

```bash
lat check 2>&1 | tail -20
```

Expected: No errors (the `@lat:` refs in the test file now point to valid sections).

- [ ] **Step 4: Commit**

```bash
git add lat.md/tests.md
git commit -m "docs(lat): add spec sections for stem-only wikilink rule and forbidden source field removal"
```

---

## Task 3: Add `InfoModal` to modals.ts

**Files:**
- Modify: `src/modals.ts`

No unit test needed — `InfoModal` is a pure UI component; behavior is verified by the integration test in Task 5.

- [ ] **Step 1: Add `InfoModal` class to `src/modals.ts`**

Insert after the closing `}` of `ConfirmModal` (after line 46), before the `export class QueryModal` line:

```typescript
export class InfoModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private lines: string[],
    private closeLabel: string,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.lines) contentEl.createEl("p", { text: line });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(this.closeLabel).setCta().onClick(() => this.close()));
  }

  onClose(): void { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Run full test suite to verify no regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/modals.ts
git commit -m "feat(modals): add InfoModal — title, body lines, single close button"
```

---

## Task 4: Update i18n strings

**Files:**
- Modify: `src/i18n.ts`

The spec requires new text for `formatInWikiTitle`, `formatInWikiBody`, and a new key `formatInWikiClose` in en/ru/es sections. The existing keys have the old "ingest" framing; they must be replaced with "forbidden" framing.

- [ ] **Step 1: Read current i18n.ts to locate exact lines**

```bash
grep -n "formatInWiki" src/i18n.ts
```

Note the line numbers for `formatInWikiTitle`, `formatInWikiBody`, `formatInWikiNoSources` in each of the three locale sections (en, ru, es).

- [ ] **Step 2: Update English section**

Find (in `en` object, `view` section):
```typescript
    formatInWikiTitle: "File is inside a wiki domain",
    formatInWikiBody: (id: string) => `This file belongs to wiki domain «${id}». Re-run ingest from sources instead?`,
    formatInWikiNoSources: "No wiki_sources in frontmatter — cannot re-ingest",
```

Replace with:
```typescript
    formatInWikiTitle: "Action forbidden",
    formatInWikiBody: (id: string) => `This file is a wiki article (domain «${id}»). Formatting wiki articles is not available.`,
    formatInWikiClose: "Close",
    formatInWikiNoSources: "No wiki_sources in frontmatter — cannot re-ingest",
```

- [ ] **Step 3: Update Russian section**

Find (in `ru` object, `view` section):
```typescript
    formatInWikiTitle: "Файл находится внутри wiki-домена",
    formatInWikiBody: (id: string) => `Файл принадлежит wiki-домену «${id}». Запустить ingest заново из источников вместо форматирования?`,
    formatInWikiNoSources: "В frontmatter отсутствует wiki_sources — повторный ingest невозможен",
```

Replace with:
```typescript
    formatInWikiTitle: "Действие запрещено",
    formatInWikiBody: (id: string) => `Файл является wiki-статьёй домена «${id}». Форматирование wiki-статей недоступно.`,
    formatInWikiClose: "Закрыть",
    formatInWikiNoSources: "В frontmatter отсутствует wiki_sources — повторный ingest невозможен",
```

- [ ] **Step 4: Update Spanish section**

Find (in `es` object, `view` section):
```typescript
    formatInWikiTitle: "El archivo está dentro de un dominio wiki",
    formatInWikiBody: (id: string) => `El archivo pertenece al dominio wiki «${id}». ¿Re-ejecutar ingest desde las fuentes?`,
    formatInWikiNoSources: "Sin wiki_sources en frontmatter — no se puede re-ingestar",
```

Replace with:
```typescript
    formatInWikiTitle: "Acción prohibida",
    formatInWikiBody: (id: string) => `Este archivo es un artículo wiki (dominio «${id}»). No se puede formatear artículos wiki.`,
    formatInWikiClose: "Cerrar",
    formatInWikiNoSources: "Sin wiki_sources en frontmatter — no se puede re-ingestar",
```

- [ ] **Step 5: Update the i18n type so TypeScript knows about `formatInWikiClose`**

Find where the `view` type is inferred — `i18n.ts` uses `typeof en` so the type is inferred automatically. No manual type update needed.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): update formatInWiki strings to 'forbidden' framing; add formatInWikiClose key"
```

---

## Task 5: Wire up patchWikiFields cleanup + replace wiki guard in controller.ts

**Depends on:** Task 1 (`validateAndRepairSourceFrontmatter` must exist), Task 3 (`InfoModal` must exist), Task 4 (`formatInWikiClose` key must exist). Do not start Task 5 until Tasks 1, 3, and 4 are complete.

**Files:**
- Modify: `src/controller.ts`
- Test: `tests/controller-format.test.ts`

### Part A: patchWikiFields cleanup

- [ ] **Step 1: Write failing test for patchWikiFields stripping forbidden fields**

Add to `tests/controller-format.test.ts`, inside the `describe("WikiController formatApply / formatCancel / formatRefine", ...)` block:

```typescript
  it("formatApply strips forbidden wiki_* fields (e.g. wiki_outgoing_links) added by LLM", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = [
      "---",
      "wiki_added: 2026-01-01",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[wiki_health]]"',
      "---",
      "Old",
    ].join("\n");
    // LLM output includes a forbidden wiki_outgoing_links field
    const formatted = [
      "---",
      "tags:",
      "  - note",
      "wiki_outgoing_links:",
      '  - "[[wiki_other]]"',
      "---",
      "New",
    ].join("\n");
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).not.toContain("wiki_outgoing_links:");
    expect(written).toContain("wiki_updated: 2026-05-01");
    expect(written).toContain("[[wiki_health]]");
    expect(written).toContain("New");
  });

  it("formatApply strips path-style entries from wiki_articles", async () => {
    const { ctrl, app } = build();
    (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
      originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
    };
    const original = [
      "---",
      "wiki_added: 2026-01-01",
      "wiki_updated: 2026-05-01",
      "wiki_articles:",
      '  - "[[wiki_health]]"',
      '  - "[[!Wiki/health/procedures/file.md]]"',
      "---",
      "Old",
    ].join("\n");
    const formatted = "---\ntags:\n  - note\n---\nNew";
    (app.vault.adapter.read as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(formatted);
    await ctrl.formatApply(false);
    const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain("[[wiki_health]]");
    expect(written).not.toContain("[[!Wiki/health/procedures/file.md]]");
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/controller-format.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|✗|×" | head -10
```

Expected: The two new tests fail.

- [ ] **Step 3: Update import in `src/controller.ts`**

Find line 24:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "./utils/raw-frontmatter";
```

Replace with:
```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, validateAndRepairSourceFrontmatter } from "./utils/raw-frontmatter";
```

- [ ] **Step 4: Update `patchWikiFields` in `src/controller.ts`**

Find the current `patchWikiFields` function (around line 35):

```typescript
function patchWikiFields(originalContent: string, formattedContent: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;
  const wikiUpdated = wikiUpdatedMatch[1].trim();
  const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(originalContent);
  const wikiAdded = wikiAddedMatch?.[1].trim();
  const wikiArticles = parseWikiArticlesFromFm(originalContent);
  const patched = upsertRawFrontmatter(formattedContent, {
    wiki_added: wikiAdded,
    wiki_updated: wikiUpdated,
    wiki_articles: wikiArticles,
  });
  return patched;
}
```

Replace the final two lines (the `return patched;` and the line before it) with:

```typescript
  const { content } = validateAndRepairSourceFrontmatter(patched);
  return content;
```

So the full updated function is:
```typescript
function patchWikiFields(originalContent: string, formattedContent: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;
  const wikiUpdated = wikiUpdatedMatch[1].trim();
  const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(originalContent);
  const wikiAdded = wikiAddedMatch?.[1].trim();
  const wikiArticles = parseWikiArticlesFromFm(originalContent);
  const patched = upsertRawFrontmatter(formattedContent, {
    wiki_added: wikiAdded,
    wiki_updated: wikiUpdated,
    wiki_articles: wikiArticles,
  });
  const { content } = validateAndRepairSourceFrontmatter(patched);
  return content;
}
```

- [ ] **Step 5: Run tests to verify Part A passes**

```bash
npx vitest run tests/controller-format.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: The two new formatApply tests pass.

### Part B: Replace wiki article guard

- [ ] **Step 6: Update the wiki-guard test**

Find in `tests/controller-format.test.ts` the test:
```typescript
  it("файл внутри wiki-домена — НЕ диспатчит, открывает ConfirmModal", async () => {
```

Replace the test description and body — the behavior stays the same (no dispatch), but now opens InfoModal instead:
```typescript
  it("файл внутри wiki-домена — НЕ диспатчит (InfoModal), не вызывает ingest", async () => {
    const domain: DomainEntry = { id: "ai", name: "AI", wiki_folder: "ии", source_paths: [], entity_types: [], language_notes: "" };
    const { ctrl, dispatchSpy } = build({ path: "!Wiki/ии/note.md", extension: "md", name: "note.md" }, [domain]);
    await ctrl.format();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
```

(The test body is identical — just name updated for clarity. The observable behavior — no dispatch — is unchanged.)

- [ ] **Step 7: Update import in `src/controller.ts` to add `InfoModal`**

Find line 22:
```typescript
import { FileErrorModal, ConfirmModal, ShellConsentModal } from "./modals";
```

Check if `ConfirmModal` is used anywhere else in the file:

```bash
grep -n "ConfirmModal" src/controller.ts
```

If only the `format()` wiki guard used it, replace:
```typescript
import { FileErrorModal, ConfirmModal, ShellConsentModal } from "./modals";
```
with:
```typescript
import { FileErrorModal, InfoModal, ShellConsentModal } from "./modals";
```

If `ConfirmModal` is also used elsewhere, keep it and add `InfoModal`:
```typescript
import { FileErrorModal, ConfirmModal, InfoModal, ShellConsentModal } from "./modals";
```

- [ ] **Step 8: Replace ConfirmModal with InfoModal in `format()` and remove `suggestIngestForWikiFile`**

Find in `format()` (around line 90):
```typescript
    if (inWiki) {
      const T = i18n().view;
      new ConfirmModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        () => void this.suggestIngestForWikiFile(file.path, inWiki),
      ).open();
      return;
    }
```

Replace with:
```typescript
    if (inWiki) {
      const T = i18n().view;
      new InfoModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        T.formatInWikiClose,
      ).open();
      return;
    }
```

Then find and delete the entire `suggestIngestForWikiFile` private method (around lines 105–118):
```typescript
  private async suggestIngestForWikiFile(filePath: string, domain: DomainEntry): Promise<void> {
    const content = await this.app.vault.adapter.read(filePath);
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) { new Notice(i18n().view.formatInWikiNoSources); return; }
    const frontmatter = m[1];
    const sourcesMatch = frontmatter.match(/wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (!sourcesMatch) { new Notice(i18n().view.formatInWikiNoSources); return; }
    const sources = sourcesMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
    if (!sources.length) { new Notice(i18n().view.formatInWikiNoSources); return; }
    await this.init(domain.id, false, sources);
  }
```

- [ ] **Step 9: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: All tests pass (891+).

- [ ] **Step 10: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add src/controller.ts tests/controller-format.test.ts
git commit -m "feat(controller): strip forbidden wiki_* fields after format apply; replace ConfirmModal wiki guard with InfoModal"
```

---

## Task 6: Final checks

- [ ] **Step 1: Run lat check**

```bash
lat check 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 2: Run full test suite one last time**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: All tests pass.

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1
```

Expected: Empty output (no errors).
