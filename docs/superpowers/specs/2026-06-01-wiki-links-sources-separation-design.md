---
review:
  spec_hash: "dc052c9f722660cf"
  last_run: "2026-06-01"
  phases:
    structure:
      status: passed
    coverage:
      status: passed
    clarity:
      status: in_progress
    consistency:
      status: passed
  findings:
    - id: F-001
      phase: coverage
      severity: CRITICAL
      section: "## Error handling"
      section_hash: "5fb489bdb5d9cb48"
      text: "Contradiction: Layer 2 code example (yield before write) contradicted §Error handling and §Constraints ('after all writes'). Fixed by restructuring code example to collect warnings, write all, then yield."
      verdict: fixed
      verdict_at: "2026-06-01"
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "## Testing"
      section_hash: "c431f07dabeab00f"
      text: "'Audit all tests... — update to match corrected behavior' lacks explicit DoD: no file list, no criterion for what constitutes a correct update."
      verdict: open
      verdict_at: null
    - id: F-003
      phase: clarity
      severity: INFO
      section: "## Problem"
      section_hash: "48cae285b5463fb2"
      text: "Terminology drift: 'wiki page stems' used in §Problem and §Invariant; 'wiki stems' used in §Architecture, §Testing, §Constraints. Same concept, two names."
      verdict: open
      verdict_at: null
chain:
  intent: docs/superpowers/intents/2026-06-01-wiki-links-sources-separation-intent.md
---

# Design: wiki_outgoing_links / wiki_sources — link bucket separation

**Date:** 2026-06-01
**Status:** draft
**Intent:** [2026-06-01-wiki-links-sources-separation-intent.md](../intents/2026-06-01-wiki-links-sources-separation-intent.md)

## Problem

During ingest, the LLM generates wiki page frontmatter where `wiki_outgoing_links` and `wiki_sources` contain entries from the wrong bucket:
- Source file stems (e.g. `[[MyNote]]`) appear in `wiki_outgoing_links` (which must contain only `!Wiki/` page stems)
- Wiki page stems (e.g. `[[wiki_work_foo]]`) appear in `wiki_sources` (which must contain only source file stems)

The current `WIKI_PAGE_RULES` validator applies `list-wikilinks` to both fields — it only checks `[[...]]` format, not path-bucket membership. Lint does not call `validateAndRepairWikiPageFrontmatter` at all, so it never detects or corrects this contamination.

## Invariant

Wiki page stems always match `GENERIC_WIKI_STEM_REGEX` (`^wiki_[domain]_[slug]$`) — enforced at 4 layers (Zod schema, prompt, runtime guard, migration). This invariant is the basis for deterministic bucket classification:

- `isWikiStem(stem) === true` → belongs in `wiki_outgoing_links`
- `isWikiStem(stem) === false` → belongs in `wiki_sources`

## Architecture

Two independent fix layers:

### Layer 1 — Validator (`src/utils/raw-frontmatter.ts`)

**New `FieldRule` kinds:**

```typescript
| { field: string; kind: "list-wikilinks-wiki-only" }    // only wiki stems allowed
| { field: string; kind: "list-wikilinks-sources-only" } // only non-wiki stems allowed
```

Both inherit `list-wikilinks` format check (`[[...]]`) and add a stem membership check via `isWikiStem` from `src/wiki-stem.ts`.

**`WIKI_PAGE_RULES` updated:**

```typescript
{ field: "wiki_sources",        kind: "list-wikilinks-sources-only" },  // was list-wikilinks
{ field: "wiki_outgoing_links", kind: "list-wikilinks-wiki-only"    },  // was list-wikilinks
```

**Warning messages:**
- `wiki_outgoing_links: non-wiki stem "[[my_note]]" — removed`
- `wiki_sources: wiki stem "[[wiki_work_foo]]" — removed`

**Implementation in switch:**

```typescript
case "list-wikilinks-wiki-only":
case "list-wikilinks-sources-only": {
  // same array guard as list-wikilinks
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
  // same length check + delete/assign as list-wikilinks
}
```

### Layer 2 — Lint bucket repair (`src/phases/lint.ts`)

Lint currently does not call `validateAndRepairWikiPageFrontmatter`. Add a dedicated bucket repair pass after `fixWikiLinks` and before `filterStaleWikiLinks`:

```typescript
import { validateAndRepairWikiPageFrontmatter } from "../utils/raw-frontmatter";

// Bucket repair: remove wrong-bucket links from wiki_sources / wiki_outgoing_links
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
    kind: "info_text",
    icon: "⚠️",
    summary: `Frontmatter repaired: ${path}`,
    details: warnings,
  };
}
```

**Lint operation order after change:**
1. `checkWikiLinks` / `fixWikiLinks` — format violations (alias, path, inline-json, outgoing-desync)
2. **bucket repair** ← new
3. `filterStaleWikiLinks` — dead link removal
4. Backlink sync

### Layer 3 — Prompt schema (proposal-first, requires approval before implementation)

**`templates/_wiki_schema.md`** — add rows to the forbidden patterns table:

```markdown
| `wiki_sources: ["[[wiki_work_foo]]"]`  | Wiki-page stem in sources field   | Move to `wiki_outgoing_links` |
| `wiki_outgoing_links: ["[[MyNote]]"]`  | Source stem in wiki-links field   | Move to `wiki_sources`        |
```

**`prompts/ingest.md`** — update rules at lines 22–23:

```markdown
- wiki_sources: ТОЛЬКО источники (файлы вне !Wiki/) — bare имя без пути: [[ИмяФайла]]. Никогда [[wiki_domain_page]]
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[ИмяСтраницы]]. Никогда [[ИмяИсточника]]
```

## Data flow

```
LLM output (wrong bucket)
  → parseWithRetry
  → fixWikiLinks (format fix — no bucket check)
  → validateAndRepairWikiPageFrontmatter (NEW: bucket filter)
  → vaultTools.write

Lint run
  → fixWikiLinks (format fix)
  → validateAndRepairWikiPageFrontmatter (NEW: bucket repair loop)
  → filterStaleWikiLinks
  → backlink sync
```

## Error handling

- Wrong-bucket entries are silently removed with a warning (never block writes)
- Warnings emitted as `info_text` events — after all writes, consistent with existing behavior
- Empty field after removal: deleted from frontmatter (existing behavior via `delete parsed[rule.field]`)

## Testing

**New tests in `tests/utils/raw-frontmatter.test.ts`:**

| Test | Input | Expected |
|------|-------|----------|
| `wiki_outgoing_links: non-wiki stem removed` | `[[my_note]]` in `wiki_outgoing_links` | removed + warning containing "non-wiki stem" |
| `wiki_sources: wiki stem removed` | `[[wiki_work_foo]]` in `wiki_sources` | removed + warning containing "wiki stem" |
| `wiki_outgoing_links: valid wiki stem kept` | `[[wiki_work_bar]]` in `wiki_outgoing_links` | kept |
| `wiki_sources: valid source stem kept` | `[[my_source]]` in `wiki_sources` | kept |
| Mixed list: valid + invalid entries | both in same field | only invalid removed |

**Existing tests:**
- `"removes wiki_sources entry that is not a wikilink"` — valid (format check still applies)
- `"removes wiki_outgoing_links entry that is not a wikilink"` — valid (format check still applies)
- Audit all tests that put source stems in `wiki_outgoing_links` or wiki stems in `wiki_sources` — update to match corrected behavior

**New tests in `tests/phases/lint.test.ts`:**
- Lint fixes wiki stem in `wiki_sources` → writes corrected page + emits warning
- Lint fixes source stem in `wiki_outgoing_links` → writes corrected page + emits warning

## Files changed

| File | Change |
|------|--------|
| `src/utils/raw-frontmatter.ts` | Add 2 new `FieldRule` kinds; update `WIKI_PAGE_RULES`; add `isWikiStem` import |
| `src/phases/lint.ts` | Add bucket repair loop; add `validateAndRepairWikiPageFrontmatter` import |
| `templates/_wiki_schema.md` | Add cross-contamination rows to forbidden table (proposal-first) |
| `prompts/ingest.md` | Strengthen field rules with explicit bucket prohibition (proposal-first) |
| `tests/utils/raw-frontmatter.test.ts` | Add 5 new bucket separation tests |
| `tests/phases/lint.test.ts` | Add 2 new lint bucket repair tests |
| `lat.md/` | Update `llm-pipeline#WikiLink Validation`, `architecture#Frontmatter Validator` sections |

## Constraints

- Do not change field names or schema shape
- Do not break `outgoing-desync` detection (still driven by body links vs `wiki_outgoing_links` — unchanged)
- Do not affect backlink sync (`wiki_articles` in sources — driven by `wiki_sources` which now only contains valid sources)
- All warnings emitted after writes complete (existing convention)
