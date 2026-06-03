---
review:
  spec_hash: 32dd57c0aee89372
  last_run: 2026-06-03
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "### 1. Source frontmatter rules (`src/utils/raw-frontmatter.ts`)"
      section_hash: dfc2b3bb0bd225e7
      text: "`WIKILINK_RE` referenced but not defined in spec — implementer must locate it in codebase"
      verdict: fixed
      verdict_at: 2026-06-03
    - id: F-002
      phase: clarity
      severity: INFO
      section: "### 5. Wiki article guard replacement (`src/controller.ts`)"
      section_hash: a55324a2b6cafc40
      text: "\"where needed\" — ambiguous about whether ConfirmModal import should be removed or kept alongside InfoModal"
      verdict: fixed
      verdict_at: 2026-06-03
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "## Overview"
      section_hash: cff149d397730ce4
      text: "Inconsistent terminology: \"wiki article guard\" (title/Overview) vs \"wiki guard\" (§Existing wiki guard, §5 heading)"
      verdict: fixed
      verdict_at: 2026-06-03
chain:
  intent: null
---
# Design: Format Frontmatter Cleanup + Wiki Article Guard

## Overview

Two related fixes to the format operation:

1. **Source frontmatter cleanup** — after format apply, strip forbidden wiki page fields and invalid path-style wikilinks from `wiki_articles`.
2. **Wiki article guard** — replace the existing ConfirmModal (which offered to run ingest) with an `InfoModal` that clearly says formatting wiki articles is forbidden.

## Background

### Bug: wiki_outgoing_links appears in source frontmatter

The format LLM is instructed (in `_format_schema.md`): "Поля wiki_* — не включать в вывод." But the LLM sometimes ignores this rule and includes wiki page-specific fields such as `wiki_outgoing_links` in the formatted output.

`patchWikiFields` in `controller.ts` calls `upsertRawFrontmatter(formattedContent, ...)` which preserves all fields from the LLM output except `wiki_added/wiki_updated/wiki_articles`, then re-inserts those three from the original. No cleanup of forbidden wiki_* fields occurs.

Additionally, the original source file may already contain stale or path-style links in `wiki_articles` (e.g. `[[!Wiki/health/procedures/file.md]]` — path instead of stem). These are copied over verbatim during format apply.

### Invariant: wiki fields in source files

Source files (articles outside `!Wiki/`) must only contain these wiki-related frontmatter fields:
- `wiki_added` — date of first ingest
- `wiki_updated` — date of last ingest
- `wiki_articles` — list of `[[stem]]` wikilinks to generated wiki pages

All other `wiki_*` fields belong to wiki pages only and must be absent from source files.

### Existing wiki article guard

`controller.ts` `format()` already checks if the active file is inside a wiki domain folder and shows a `ConfirmModal` offering to run ingest from sources. The user wants this replaced with a simple "forbidden" `InfoModal` — no ingest option.

## Design

### 1. Source frontmatter rules (`src/utils/raw-frontmatter.ts`)

**New FieldRule kind: `list-wikilinks-stem-only`**

Extends `list-wikilinks` but additionally rejects entries that contain `/` or end with `.md]]`. These are path-style links, not stem links. Valid wikilinks in `wiki_articles` are bare stems: `[[wiki_health_oblivanie_kholodnoj_vodoj]]` or `[[SomeUserNote]]`.

Predicate: `WIKILINK_RE.test(v) && !v.includes("/") && !v.endsWith(".md]]")` — where `WIKILINK_RE` is the existing regex constant in `src/utils/raw-frontmatter.ts` that matches `[[...]]` strings.

**Changes to `SOURCE_RULES`:**

```typescript
const SOURCE_RULES: FieldRule[] = [
  { field: "wiki_articles",       kind: "list-wikilinks-stem-only" }, // was list-wikilinks
  { field: "wiki_added",          kind: "date-scalar" },
  { field: "wiki_updated",        kind: "date-scalar" },
  { field: "tags",                kind: "list-tags" },
  { field: "aliases",             kind: "aliases" },
  { field: "created",             kind: "date-scalar" },
  { field: "updated",             kind: "date-scalar" },
  { field: "external_links",      kind: "list-urls" },
  { field: "related",             kind: "list-wikilinks" },
  // forbidden wiki page fields — strip silently
  { field: "wiki_outgoing_links", kind: "remove" },
  { field: "wiki_sources",        kind: "remove" },
  { field: "wiki_status",         kind: "remove" },
  { field: "wiki_type",           kind: "remove" },
  { field: "wiki_external_links", kind: "remove" },
  { field: "annotation",          kind: "remove" },
];
```

**`validateAndRepairSourceFrontmatter`** already calls `validateAndRepairFrontmatter(content, SOURCE_RULES)` — no change to its signature or callers.

### 2. Format apply cleanup (`src/controller.ts`)

**`patchWikiFields`** — add call to `validateAndRepairSourceFrontmatter` after `upsertRawFrontmatter`:

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm, validateAndRepairSourceFrontmatter } from "./utils/raw-frontmatter";

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

Warnings from `validateAndRepairSourceFrontmatter` are discarded here — they are informational only and not user-visible at apply time.

### 3. InfoModal (`src/modals.ts`)

Add `InfoModal` — title + body lines + single "Close" button. No confirm callback.

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

### 4. i18n strings (`src/i18n.ts`)

Add/update in `view` section (en, ru, es):

| Key | en | ru | es |
|-----|----|----|-----|
| `formatInWikiTitle` | "Action forbidden" | "Действие запрещено" | "Acción prohibida" |
| `formatInWikiBody` | `(id) => \`This file is a wiki article (domain «${id}»). Formatting wiki articles is not available.\`` | `(id) => \`Файл является wiki-статьёй домена «${id}». Форматирование wiki-статей недоступно.\`` | `(id) => \`Este archivo es un artículo wiki (dominio «${id}»). No se puede formatear artículos wiki.\`` |
| `formatInWikiClose` | "Close" | "Закрыть" | "Cerrar" |

### 5. Wiki article guard replacement (`src/controller.ts`)

In `format()`, replace:

```typescript
new ConfirmModal(
  this.app,
  T.formatInWikiTitle,
  [T.formatInWikiBody(inWiki.id)],
  () => void this.suggestIngestForWikiFile(file.path, inWiki),
).open();
```

With:

```typescript
new InfoModal(
  this.app,
  T.formatInWikiTitle,
  [T.formatInWikiBody(inWiki.id)],
  T.formatInWikiClose,
).open();
```

Remove `suggestIngestForWikiFile` method (becomes unused).

In `src/controller.ts`: add `InfoModal` to the import from `./modals`. `ConfirmModal` remains imported if used elsewhere; if `format()` was its only call site, remove it.

## Files changed

| File | Change |
|------|--------|
| `src/utils/raw-frontmatter.ts` | Add `list-wikilinks-stem-only` kind; update `SOURCE_RULES` with new kind and `remove` rules |
| `src/controller.ts` | `patchWikiFields` calls `validateAndRepairSourceFrontmatter`; import updated; wiki guard uses `InfoModal`; remove `suggestIngestForWikiFile` |
| `src/modals.ts` | Add `InfoModal` class |
| `src/i18n.ts` | Add/update `formatInWikiTitle`, `formatInWikiBody`, `formatInWikiClose` in en/ru/es |

## Out of scope

- `filterStaleWikiLinks` for format (requires vault access; handled at ingest/lint time)
- Changes to format LLM prompt (the programmatic cleanup is the reliable layer)
- Tests update (separate task)
