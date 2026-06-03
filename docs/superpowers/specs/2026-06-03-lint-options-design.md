---
chain:
  intent: docs/superpowers/intents/2026-06-03-wiki-articles-validation-intent.md
review:
  spec_hash: 2316841a1eb0d9e7
  last_run: "2026-06-03"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "3. `LintOptionsModal`"
      section_hash: 649a85768efa7fa6
      text: "`controller.lint` signature change not documented"
      verdict: fixed
      verdict_at: "2026-06-03"
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "3. `LintOptionsModal`"
      section_hash: 649a85768efa7fa6
      text: "`view.ts:352` lint button not addressed in spec"
      verdict: fixed
      verdict_at: "2026-06-03"
---

# Lint Options: Programmatic Mode + Entity Type Filter

**Date:** 2026-06-03  
**Status:** approved  
**Intent:** `docs/superpowers/intents/2026-06-03-wiki-articles-validation-intent.md`

## Overview

Two related improvements to the lint operation:

1. **`wiki_articles` validation** — strip invalid entries (plain text, non-`wiki_*` stems, non-existent stems) from source files during lint and ingest.
2. **Lint options modal** — replace the bare `DomainModal` for lint with a new `LintOptionsModal` that exposes per-run controls: entity type filter and LLM toggle.

Together these make lint faster, cheaper, and more precise on large vaults.

---

## 1. `stripInvalidWikiArticles`

### Location

`src/utils/raw-frontmatter.ts` — new exported function.

### Signature

```typescript
export function stripInvalidWikiArticles(
  content: string,
  existingWikiStems: Set<string>,
): { content: string; warnings: string[] }
```

### Filtering rules

| Entry | Action |
|-------|--------|
| `Иммуномодуляторы` (not a wikilink) | Remove + warning |
| `[[ИРС-19]]` (stem doesn't match `wiki_*` pattern) | Remove + warning |
| `[[wiki_x_thing]]` not in `existingWikiStems` | Remove + warning |
| `[[wiki_x_thing]]` present in `existingWikiStems` | Keep |

Only `wiki_articles` is modified. All other frontmatter fields are untouched.

Implementation uses the existing `yamlParse`/`yamlStringify` utilities already in the file.

### Replacing `filterStaleWikiLinks` for `wiki_articles`

**lint.ts** source-file loop (currently lines 526–533):
```typescript
// Before:
const { content: filteredContent } =
  filterStaleWikiLinks(rawContent, existingWikiStems, ["wiki_articles"]);

// After:
const { content: filteredContent, warnings } =
  stripInvalidWikiArticles(rawContent, existingWikiStems);
```

**ingest.ts** backlink sync (currently lines 438–450):
- Remove the `existingArticleStems` block (lines 445–448) — this block intentionally preserved non-`wiki_*` wikilinks as "user-curated cross-refs". That behavior is being removed: `wiki_articles` must contain only valid `wiki_*` stems.
- Apply `stripInvalidWikiArticles(repairedSource, wikiFileStems)` for `wiki_articles`.
- Keep `filterStaleWikiLinks` for `related` field only.

---

## 2. Settings: `lintOptions`

### Type change (`src/types.ts`)

Add to `LlmWikiPluginSettings`:

```typescript
lintOptions: {
  useLlm: boolean;  // default: true
}
```

### Migration

Default value `true` preserves existing behavior. Add to `DEFAULT_SETTINGS` in `src/settings.ts`. Update `src/effective-settings.ts` and `src/local-config.ts` if they merge/override settings.

### Settings UI

Add a checkbox in the Lint section of `src/settings.ts`:

> **Use LLM for lint** — uncheck to run programmatic-only lint (no LLM calls, much faster)

Value saved to `settings.lintOptions.useLlm`. Serves as default for the per-run modal toggle.

---

## 3. `LintOptionsModal`

New modal in `src/modals.ts`, replaces the `DomainModal` call for the lint command in `src/main.ts`.

### UI layout

```
┌─────────────────────────────────────┐
│ Lint Wiki                           │
├─────────────────────────────────────┤
│ Domain:  [dropdown: all / id / ...] │
│                                     │
│ Entity types:          (hidden when │
│  ☑ Drug                 "all"       │
│  ☑ Condition            selected)   │
│  ☐ Ingredient                       │
│                                     │
│ Use LLM  [toggle]                   │
│                  [▶ Run]            │
└─────────────────────────────────────┘
```

### Behavior

- Domain dropdown: same options as current `DomainModal` (`all` + per-domain IDs).
- Entity type checkboxes: populated from `domain.entity_types` for the selected domain. All checked by default. Hidden when "all domains" is selected.
- Use LLM toggle: initial value from `settings.lintOptions.useLlm`.
- Run button: calls `controller.lint(domain, { useLlm, entityTypeFilter })`.
- When "all domains" is selected, `entityTypeFilter` is always `[]` (entity section hidden, no filter applied).

### Constructor

```typescript
export class LintOptionsModal extends Modal {
  constructor(
    app: App,
    private domains: DomainEntry[],
    private defaultUseLlm: boolean,
    private onSubmit: (
      domain: string,
      opts: { useLlm: boolean; entityTypeFilter: string[] }
    ) => void,
  )
}
```

### Callers

`LintOptionsModal` replaces **both** existing lint entry points:

1. **`src/main.ts`** — command palette lint command (currently uses `DomainModal`).
2. **`src/view.ts:352`** — lint button in the sidebar panel (currently uses `ConfirmModal`). Replace with `LintOptionsModal`; remove the `ConfirmModal` call.

Both callers pass `settings.lintOptions.useLlm` as `defaultUseLlm`.

### `controller.lint` signature

`src/controller.ts:189` — update signature:

```typescript
async lint(
  domain: string,
  opts: { useLlm?: boolean; entityTypeFilter?: string[] } = {}
): Promise<void>
```

Passes `opts.useLlm ?? true` and `opts.entityTypeFilter ?? []` down to `runLint`.
```

---

## 4. `runLint` signature changes

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

### Execution flow

```
runLint
├── [always] cleanupInvalidPages
├── [always] buildTitleMap + stemToPath + existingWikiStems
├── [useLlm=true] per-article LLM loop (filtered by entityTypeFilter if set)
├── [useLlm=true] actualizeDomainConfig
├── [always] validateAndRepairWikiPageFrontmatter (bucket repair)
├── [always] filterStaleWikiLinks (wiki_outgoing_links in wiki pages)
├── [always] stripInvalidWikiArticles (wiki_articles in source files)  ← new
└── [always] backlink sync (wiki_sources → wiki_articles)
```

### Entity type filtering

Applied only to `articlePaths` in the per-article LLM loop. Programmatic steps always run on all files.

```typescript
const filteredArticlePaths = entityTypeFilter.length > 0
  ? articlePaths.filter(p =>
      entityTypeFilter.some(et => {
        const subfolder = domain.entity_types
          ?.find(e => e.type === et)?.wiki_subfolder;
        return subfolder && p.includes(`/${subfolder}/`);
      })
    )
  : articlePaths;
```

If `useLlm=false`, `entityTypeFilter` is ignored (no LLM loop runs at all).

---

## 5. Tests

### Unit tests — `stripInvalidWikiArticles`

File: `tests/utils/raw-frontmatter.test.ts` (or new `tests/utils/strip-invalid-wiki-articles.test.ts`).

- Plain-text entry removed, warning emitted
- `[[ИРС-19]]` (non-`wiki_*` stem) removed, warning emitted
- `[[wiki_x_thing]]` absent from stems → removed
- `[[wiki_x_thing]]` present in stems → kept
- Other frontmatter fields untouched
- Empty `wiki_articles` → no-op

### Integration tests — lint

File: `tests/phases/lint.test.ts`.

- Source file with `wiki_articles: - Иммуномодуляторы` → entry stripped after lint
- Source file with valid `[[wiki_*]]` entries → entries preserved
- Existing stale-link tests continue to pass

### Integration tests — ingest

File: `tests/phases/ingest.test.ts`.

- Source file with `[[ИРС-19]]` in `wiki_articles` → stripped after ingest
- Source file with valid `[[wiki_*]]` entries → preserved

### `LintOptionsModal` tests

File: `tests/modals.test.ts` or new.

- Entity type checkboxes populate from selected domain
- Entity type section hidden when "all" selected
- Toggle initializes from `defaultUseLlm`
- `onSubmit` called with correct `useLlm` and `entityTypeFilter` values

---

## Constraints (from intent)

- Apply `stripInvalidWikiArticles` only to source files (outside `!Wiki/`) — never to wiki pages themselves.
- Do not modify any frontmatter fields other than `wiki_articles`.
- Valid wiki-stems already in `wiki_articles` are never removed.
- Backlink Sync continues to correctly append `[[WikiPageName]]` to `wiki_articles`.
