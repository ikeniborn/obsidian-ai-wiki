# Design: Fix init — missing wiki_sources and redundant annotation in frontmatter

**Date:** 2026-06-02
**Intent:** [2026-06-02-init-wiki-sources-annotation-intent.md](../intents/2026-06-02-init-wiki-sources-annotation-intent.md)
**Status:** approved

## Problem

Two independent bugs in the `init`/`ingest` pipeline cause wiki pages to be deleted by `lint`:

1. **annotation in frontmatter** — LLM occasionally writes `annotation:` inside the wiki page
   YAML frontmatter (as well as in the separate JSON output field). `validateAndRepairWikiPageFrontmatter`
   does not strip unknown fields, so `annotation` persists in page files.

2. **wiki_sources missing or empty** — LLM omits `wiki_sources` or writes wiki-stem entries into
   it. The `list-wikilinks-sources-only` repair rule removes wiki-stem entries; if all entries are
   removed the field is deleted entirely. Pages without `wiki_sources` are deleted by ingest Check B
   and `lint#Cleanup Pass`.

## Architecture

Four touch points, two bugs:

```
Bug 1 (annotation in frontmatter)
  ├── src/utils/raw-frontmatter.ts   — new FieldRule kind "remove", WIKI_PAGE_RULES += annotation
  ├── prompts/ingest.md              — add explicit prohibition
  └── prompts/lint.md                — add explicit prohibition

Bug 2 (wiki_sources absent/empty)
  ├── src/utils/raw-frontmatter.ts   — new export ensureWikiSources(content, sourceStem)
  └── src/phases/ingest.ts           — call ensureWikiSources after validateAndRepairWikiPageFrontmatter
```

Lint requires no changes: it calls `validateAndRepairWikiPageFrontmatter`, which will automatically
strip `annotation` from any page it processes.

## Component Details

### `src/utils/raw-frontmatter.ts` — kind `"remove"`

Add `"remove"` to the `FieldRule` discriminated union:

```ts
| { field: string; kind: "remove" }
```

Handle in `validateAndRepairFrontmatter`:

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

Add to `WIKI_PAGE_RULES`:

```ts
{ field: "annotation", kind: "remove" },
```

### `src/utils/raw-frontmatter.ts` — `ensureWikiSources`

```ts
export function ensureWikiSources(
  content: string,
  sourceStem: string,
): { content: string; injected: boolean } {
  const sources = parseWikiSourcesFromFm(content);
  if (sources.length > 0) return { content, injected: false };
  // Parse frontmatter, inject wiki_sources: ["[[sourceStem]]"], re-serialize.
  // Uses same YAML parse/stringify pattern as validateAndRepairFrontmatter.
}
```

Returns `injected: true` when `wiki_sources` was absent or empty after repair, indicating
the LLM did not emit a valid `wiki_sources` field.

### `src/phases/ingest.ts` — post-repair injection

After the `validateAndRepairWikiPageFrontmatter` call (currently ~line 327), add:

```ts
const { content: repairedPage, warnings } = validateAndRepairWikiPageFrontmatter(page.content);
const sourceStem = sourcePath.split("/").pop()!.replace(/\.md$/, "");
const { content: sourcedPage, injected } = ensureWikiSources(repairedPage, sourceStem);
if (injected) {
  yield {
    kind: "info_text", icon: "⚠️",
    summary: `wiki_sources injected: ${page.path}`,
    details: [`Added [[${sourceStem}]] — LLM did not emit wiki_sources`],
  };
}
await vaultTools.write(page.path, sourcedPage);
```

`sourceStem` is already available in scope via `buildIngestPrompt` template variable
(`sourcePath.split("/").pop()!.replace(/\.md$/, "")`).

### `prompts/ingest.md` and `prompts/lint.md`

Add one line to the rules section of each prompt:

```
- Поле `annotation` — ТОЛЬКО в JSON-ответе. НЕ добавляй `annotation:` во frontmatter страницы.
```

## Data Flow

```
LLM output page
  │ page.content (may have annotation: in frontmatter)
  │ page.annotation (separate JSON field → _index.md)
  ▼
validateAndRepairWikiPageFrontmatter(page.content)
  → strips annotation: from frontmatter if present (new "remove" rule)
  → repairs wiki_sources entries (existing list-wikilinks-sources-only rule)
  ▼
ensureWikiSources(repairedContent, sourceStem)
  → if wiki_sources absent/empty → injects [[sourceStem]]
  → returns injected flag for warning emit
  ▼
vaultTools.write(page.path, finalContent)
  → page on disk: no annotation in frontmatter, wiki_sources guaranteed non-empty
```

## Tests

### Unit: `validateAndRepairWikiPageFrontmatter` — annotation strip

- Input: wiki page with `annotation: "some text"` in frontmatter
- Expected: field absent in output, warning includes `"annotation"`, `content` changed

### Unit: `ensureWikiSources`

- **Case A**: `wiki_sources` absent → `injected: true`, frontmatter contains `[[sourceStem]]`
- **Case B**: `wiki_sources` present and non-empty → `injected: false`, content unchanged
- **Case C**: `wiki_sources` was emptied by prior repair (all entries were wiki stems) → `injected: true`

### Integration: ingest pipeline

- LLM response without `wiki_sources` → saved page has `[[source_stem]]` in `wiki_sources`
- LLM response with `annotation:` in frontmatter content → saved page has no `annotation` field

## Out of Scope

- Retroactive fix of existing vault pages — only new pages written after this fix are affected.
- Changes to `cleanupInvalidPages` logic.
- Changes to `list-wikilinks-sources-only` validation rule.
- Changes to Check B deletion behavior.
