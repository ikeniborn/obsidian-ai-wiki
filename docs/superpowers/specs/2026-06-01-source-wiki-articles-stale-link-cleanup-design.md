# Design: Source wiki_articles stale link cleanup

**Date:** 2026-06-01
**Intent:** `docs/superpowers/intents/2026-06-01-source-wiki-articles-stale-link-cleanup-intent.md`

## Problem

After ingest/reinit, `wiki_articles` and `related` in source frontmatter accumulate dead links — wikilinks pointing to wiki pages that no longer exist. The existing `validateAndRepairSourceFrontmatter` checks only wikilink format (`[[...]]`), not page existence. Dead links pile up silently across ingest cycles.

The existing `deletedStems` filter in ingest handles only pages deleted in the **current** run. Links to pages deleted in prior runs, or pages that were replaced without an explicit delete, persist indefinitely.

## Approach

Add a pure function `filterStaleWikiLinks` to `raw-frontmatter.ts`. It accepts the source content, a set of existing wiki page stems, and a list of field names to check. It filters out any valid wikilink entry whose stem is absent from the set. Called by ingest and lint — each caller supplies the stem set from its own context, with no vault I/O inside the function.

## Core function

**Location:** `src/utils/raw-frontmatter.ts`

```ts
export function filterStaleWikiLinks(
  content: string,
  existingStems: Set<string>,
  fields: string[],
): { content: string; warnings: string[] }
```

Behavior:
- Parses frontmatter YAML (same `FM_RE` / `yamlParse` pattern as `validateAndRepairFrontmatter`).
- For each field in `fields`: if the value is an array, removes entries that are valid wikilinks (`WIKILINK_RE`) whose stem (`link.slice(2, -2)`) is absent from `existingStems`.
- Entries that are not valid wikilinks are left untouched (format validation is `validateAndRepairSourceFrontmatter`'s responsibility).
- Emits a warning per removed entry: `"wiki_articles: stale link [[Foo]] — removed"`.
- Returns `{ content, warnings }`. No vault I/O.

Fields targeted: `["wiki_articles", "related"]`.

## Ingest integration

**File:** `src/phases/ingest.ts`

After the write/delete loops complete (after line ~389 where `deletedStems` is built), compute `existingStems` without an extra vault read:

```ts
const existingStems = new Set(
  [...new Set([...existingPaths, ...written])]
    .filter(p => !deletedPaths.includes(p) && !p.endsWith("_index.md"))
    .map(p => p.split("/").pop()!.replace(/\.md$/, ""))
);
```

In the source frontmatter write block, after `validateAndRepairSourceFrontmatter`:

```ts
const { content: repairedSource, warnings: sourceWarnings } =
  validateAndRepairSourceFrontmatter(updatedSource);
const { content: filteredSource, warnings: staleWarnings } =
  filterStaleWikiLinks(repairedSource, existingStems, ["wiki_articles", "related"]);
```

Write `filteredSource`. Merge `staleWarnings` into `sourceWarnings` for the existing `info_text` yield.

Order: format repair first, then existence filter. This ensures `filterStaleWikiLinks` only sees format-valid wikilinks.

## Lint integration

**File:** `src/phases/lint.ts`

Compute `existingWikiStems` once after the LLM loop, before the backlink sync block:

```ts
const deletedNames = new Set(deletedRefs.map(d => d.deletedName));
const existingWikiStems = new Set(
  [
    ...[...pages.keys()].map(p => p.split("/").pop()!.replace(/\.md$/, "")),
    ...writtenPaths.map(p => p.split("/").pop()!.replace(/\.md$/, "")),
  ].filter(stem => !deletedNames.has(stem))
);
```

### Wiki pages — `wiki_outgoing_links`

After computing `existingWikiStems`, iterate all wiki pages and clean stale `wiki_outgoing_links`:

```ts
for (const [wikiPath, wikiContent] of pages) {
  const { content: filteredWiki } =
    filterStaleWikiLinks(wikiContent, existingWikiStems, ["wiki_outgoing_links"]);
  if (filteredWiki !== wikiContent) {
    pages.set(wikiPath, filteredWiki);
    await vaultTools.write(wikiPath, filteredWiki);
  }
}
```

This runs before the backlink sync so the updated page map is consistent.

### Source files — all sources (vault-wide)

After the wiki page pass, clean ALL source files (not just those in backlinks). Reuses the same `allMdPaths` already computed:

```ts
const sourcePaths = allMdPaths.filter(p => !p.startsWith(wikiVaultPath + "/"));
for (const sourcePath of sourcePaths) {
  const rawContent = await vaultTools.read(sourcePath).catch(() => null);
  if (!rawContent) continue;
  const { content: filteredContent } =
    filterStaleWikiLinks(rawContent, existingWikiStems, ["wiki_articles", "related"]);
  if (filteredContent !== rawContent) await vaultTools.write(sourcePath, filteredContent);
}
```

This replaces the existing backlink sync loop's per-source stale filtering (backlink sync still runs to ADD new links; stale removal is now done here, vault-wide).

Warnings from `filterStaleWikiLinks` in lint are discarded — stale link removal is silent cleanup.

## Tests

New spec sections under `lat.md/tests.md` → `Frontmatter Validation` → `filterStaleWikiLinks`:

| Section | Verifies |
|---|---|
| `Stale wiki_articles removed` | `[[Foo]]` where `Foo ∉ existingStems` is removed, warning emitted |
| `Live wiki_articles kept` | `[[Bar]]` where `Bar ∈ existingStems` is kept unchanged |
| `related stale removed` | Same behavior for the `related` field |
| `wiki_outgoing_links stale removed` | Same behavior for the `wiki_outgoing_links` field in wiki pages |
| `Non-wikilink entries untouched` | Non-`[[...]]` entry in a field is not removed by this function |
| `Empty existingStems removes all` | Empty Set removes all valid wikilink entries |
| `No frontmatter passthrough` | Content without frontmatter returned unchanged, empty warnings |

Integration tests:
- Ingest: after a run where a wiki page was present in a prior cycle but absent now, the source's `wiki_articles` does not contain the stale link.
- Lint: after lint completes, a source file NOT referenced by any wiki page also has its stale `wiki_articles` links removed.
- Lint: after lint completes, a wiki page's `wiki_outgoing_links` does not contain links to deleted pages.

Existing tests that must stay green:
- `Frontmatter Validation` suite (all)
- `Backlinks drop deleted stems`
- No regression in ingest init/reinit flow

## Constraints respected

- `raw-frontmatter.ts` remains a pure utility — no vault I/O added.
- Stale-link removal stays in the caller layer (ingest, lint); the function accepts stems as a parameter.
- `FieldRule` / `validateAndRepairFrontmatter` infrastructure untouched.
- Public API change: `filterStaleWikiLinks` is a new export — no existing signatures modified.
- Lint vault-wide source pass reuses `allMdPaths` already computed — no extra `listFiles` call.
- Wiki page stale pass mutates the in-memory `pages` map so downstream code (backlink sync, similarity) sees consistent state.
