---
review:
  spec_hash: 0791c74a90ad6e45
  last_run: 2026-05-26
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Tests"
      text: "Duplicate headings validateWikiLinks/fixWikiLinks in Tests vs wiki-link-validator.ts"
      verdict: fixed
      verdict_at: 2026-05-26
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "wiki-link-validator.ts#validateWikiLinks"
      text: "Missing knownPageStems param for dead-link detection"
      verdict: fixed
      verdict_at: 2026-05-26
    - id: F-003
      phase: clarity
      severity: INFO
      section: "wiki-link-validator.ts#fixWikiLinks"
      text: "fixable violations term undefined"
      verdict: fixed
      verdict_at: 2026-05-26
---

# Design: WikiLink Validation

**Date:** 2026-05-26
**Status:** approved
**Intent:** [2026-05-26-wikilink-validation-intent.md](../intents/2026-05-26-wikilink-validation-intent.md)

## Overview

Programmatic WikiLink fixer runs after `parseWithRetry` in ingest, format, and lint phases. Fixes format violations without LLM retry. Reports unfixable issues (dead links) as warnings. Configurable via `wikiLinkValidationRetries` setting (max fix passes, default=3).

## Components

| File | Change |
|------|--------|
| `src/wiki-link-validator.ts` | New — validate + programmatic fix |
| `src/phases/zod-schemas.ts` | Add `.superRefine()` to `WikiPageSchema` |
| `src/types.ts` | Add `wikiLinkValidationRetries: number` to settings |
| `src/settings.ts` | UI for new setting |
| `src/i18n.ts` | EN/RU/ES strings |
| `src/agent-runner.ts` | Pass `wikiLinkValidationRetries` to phases |
| `src/phases/ingest.ts` | Call `fixWikiLinks()` after `parseWithRetry` |
| `src/phases/format.ts` | Same |
| `src/phases/lint.ts` | Add `checkWikiLinks()` to `allIssues`; call `fixWikiLinks()` on `fixes` |
| `templates/_wiki_schema.md` | Clarify WikiLink rules with examples |
| `tests/wiki-link-validator.test.ts` | New unit tests |

## wiki-link-validator.ts

### Types

```ts
type ViolationKind = "alias" | "path" | "inline-json" | "outgoing-desync";

interface WikiLinkViolation {
  page: string;
  kind: ViolationKind;
  detail: string;
}

interface FixResult {
  fixed: Map<string, string>;   // path → fixed content
  warnings: string[];           // unfixable issues (dead links)
}
```

### validateWikiLinks

Scans all pages for violations. Returns list of `WikiLinkViolation[]`.

Signature: `validateWikiLinks(pages: Map<string, string>, knownPageStems?: Set<string>): WikiLinkViolation[]`

`knownPageStems` — set of bare file stems (no path, no `.md`) used for dead-link detection. If omitted, dead-link check is skipped (no warning emitted).

Rules:

| Kind | Pattern | Detection |
|------|---------|-----------|
| `alias` | `[[X\|Y]]` | regex `\[\[[^\]]+\|[^\]]+\]\]` |
| `path` | `[[folder/page]]` | link contains `/` |
| `inline-json` | `wiki_outgoing_links: ["[[x]]"]` | frontmatter line starts with `wiki_outgoing_links:` followed by `[` |
| `outgoing-desync` | body links ≠ `wiki_outgoing_links` | extract body links, compare with frontmatter field |
| `dead-link` | `[[nonexistent]]` | page stem not in known pages set — **warning only** |

### fixWikiLinks

Runs up to `maxPasses` times. On each pass:
1. Strips aliases: `[[Page|alias]]` → `[[Page]]`
2. Strips paths: `[[folder/page]]` → `[[page]]` (basename)
3. Normalizes inline-JSON frontmatter → YAML block list
4. Syncs `wiki_outgoing_links` from body links (parses all `[[...]]` in body, writes block list)

Fixable violations: `alias`, `path`, `inline-json`, `outgoing-desync` — all correctable by string manipulation.
Non-fixable: `dead-link` — requires knowing valid page names; collected into `warnings[]`.

Stops when `validateWikiLinks()` returns zero fixable violations or `maxPasses` exhausted.
Dead links collected into `warnings[]` — pages written as-is.

### checkWikiLinks (for lint)

Same as `validateWikiLinks` but formats output as a string for `allIssues` (matches `checkStructure` format):
```
- path/to/page.md: alias link [[Page|alias]]
- path/to/page.md: path in link [[folder/page]]
```

## Data Flow

### ingest / format

```
parseWithRetry() → pages[]
  ↓
fixWikiLinks(pages, maxPasses=wikiLinkValidationRetries)
  ↓ warnings?
yield info_text { icon: "⚠️", summary: "WikiLink warnings", details: warnings }
  ↓
write pages (fixed content)
```

### lint

```
checkStructure(pages)     ← existing
checkWikiLinks(pages)     ← new
  → allIssues (passed to LLM as "Автоматические проблемы")
  ↓
LLM returns LintOutput.fixes[]
  ↓
fixWikiLinks(fixes, maxPasses=wikiLinkValidationRetries)
  ↓
write pages (fixed content)
```

## Settings

### LlmWikiPluginSettings (types.ts)

```ts
wikiLinkValidationRetries: number;  // default: 3, min: 0
```

`0` = skip fixing entirely (validate only, report warnings).

### UI (settings.ts)

Placed in General section, after `hubThreshold`. Number input, validates `n >= 0 && Number.isInteger(n)`.

### i18n (i18n.ts)

```ts
// EN
wikiLinkValidationRetries_name: "WikiLink fix passes"
wikiLinkValidationRetries_desc: "Max programmatic fix passes for WikiLink format errors. 0 = validate only."

// RU
wikiLinkValidationRetries_name: "Проходов фиксера WikiLinks"
wikiLinkValidationRetries_desc: "Макс. число программных проходов исправления формата WikiLinks. 0 — только валидация."

// ES
wikiLinkValidationRetries_name: "Pasadas del fijador de WikiLinks"
wikiLinkValidationRetries_desc: "Máx. pasadas programáticas para corregir formato de WikiLinks. 0 = solo validar."
```

## Zod Refinement

`WikiPageSchema` in `zod-schemas.ts` gets `.superRefine()` on `content` field with two checks:

1. **Alias check** — regex `\[\[[^\]]+\|[^\]]+\]\]` matches any `[[X|Y]]` pattern; adds a Zod issue "WikiLink aliases not allowed"
2. **Path check** — iterates all `[[...]]` matches; if link text contains `/`, adds a Zod issue "WikiLink with path"

Used in tests to verify validator and schema agree. Not used for runtime LLM retry — runtime fix is programmatic via `fixWikiLinks`.
## Template Changes (_wiki_schema.md)

Replace existing WikiLinks section with:

```markdown
## WikiLinks

- Only `[[page-name]]` — no aliases, no folder paths
- ❌ Forbidden: `[[Page|alias]]`, `[[folder/page]]`
- ✅ Correct: `[[page-name]]`, `[[Кириллица]]`, `[[Scalability]]`
- Link only to existing pages; dead links yield a warning

wiki_outgoing_links — YAML block list (not inline JSON):
- ✅ Correct:
  wiki_outgoing_links:
    - "[[page-a]]"
    - "[[page-b]]"
- ❌ Forbidden: `wiki_outgoing_links: ["[[page-a]]", "[[page-b]]"]`

wiki_outgoing_links MUST contain every [[link]] found in the page body.
```

## Tests (wiki-link-validator.test.ts)

### Tests: validateWikiLinks
- Detects alias: `[[Page|alias]]` → violation `kind="alias"`
- Detects path: `[[folder/page]]` → violation `kind="path"`
- Detects inline-json frontmatter → violation `kind="inline-json"`
- Detects desync: body has `[[A]]`, frontmatter missing → `kind="outgoing-desync"`
- Dead link → warning (not violation)
- Clean page → empty violations

### Tests: fixWikiLinks
- Strips alias: `[[Page|alias]]` → `[[Page]]`
- Strips path: `[[folder/page]]` → `[[page]]`
- Normalizes inline-json frontmatter → block list
- Syncs `wiki_outgoing_links` from body
- Idempotent: `fix(fix(x)) === fix(x)`
- Preserves dead links (only warns, does not remove)
- `maxPasses=0` → returns unchanged pages + all violations as warnings

## Error Handling

- `wikiLinkValidationRetries=0` → skip fixing, report all violations as warnings
- Fix exhaustion (violations remain after all passes) → yield `info_text` warning, write pages as-is
- Dead links never block writes — always warning only
- Fix errors (regex fail, parse fail) → caught, page written as-is with warning
