# Frontmatter Validator After Ingest

## Problem

During `reinit`, the agent corrupted source frontmatter by producing duplicate YAML keys:

```yaml
wiki_articles:
wiki_added: 2026-05-21
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_fin_developer_metrics_and_grants]]"
```

Root cause: `removeWikiFields` uses `String.replace()` without the `/g` flag, so only the first `wiki_articles:` key is removed. A second occurrence survives, and the next ingest appends yet another. There is also no post-write validation to catch this class of bug.

## Goal

1. Fix `removeWikiFields` so all occurrences of wiki fields are removed.
2. Add `validateAndRepairSourceFrontmatter` — runs after `upsertRawFrontmatter`, before `vaultTools.write` for the source file.
3. Add `validateAndRepairWikiPageFrontmatter` — runs before `vaultTools.write` for each wiki page written by ingest.
4. Both functions: auto-repair where possible, emit warnings, never halt the operation.
5. Validate **frontmatter only** — body content is not touched.

## Approach

Use the [`yaml`](https://www.npmjs.com/package/yaml) package (YAML 1.2) for reliable parsing and re-serialization. Duplicate-key detection requires a separate regex pass because YAML parsers silently last-write-win on duplicate keys.

## Validation Rules — Source File

| Field | Rule | Auto-repair |
|---|---|---|
| Any key | Duplicate YAML key | Merge: union lists, keep last scalar |
| `wiki_articles[]` | Each entry must match `[[...]]` | Remove invalid entries |
| `wiki_added` | YYYY-MM-DD | Remove if invalid |
| `wiki_updated` | YYYY-MM-DD | Remove if invalid |
| `tags[]` | Each tag: lowercase, no spaces, no `#`, hierarchy via `/` | Remove invalid entries |
| `aliases` | Must be a list (not scalar) | Wrap scalar in list |
| `created` | YYYY-MM-DD | Remove if invalid |
| `updated` | YYYY-MM-DD | Remove if invalid |
| `external_links[]` | Each entry must start with `http://` or `https://` | Remove invalid entries |
| `related[]` | Each entry must match `[[...]]` | Remove invalid entries |
| *(any)* | Unparseable YAML | Warn, leave content untouched |

## Validation Rules — Wiki Page

| Field | Rule | Auto-repair |
|---|---|---|
| Any key | Duplicate YAML key | Merge: union lists, keep last scalar |
| `wiki_sources[]` | Each entry must match `[[...]]` | Remove invalid entries |
| `wiki_updated` | YYYY-MM-DD | Remove if invalid |
| `wiki_status` | One of `stub \| developing \| mature` | Warn only — do not remove (status logic is complex) |
| `wiki_type` | One of `page \| index \| log \| schema` if present | Warn only |
| `tags[]` | Lowercase, no spaces, no `#`, hierarchy via `/` | Remove invalid entries |
| `aliases` | Must be a list | Wrap scalar in list |
| `wiki_outgoing_links[]` | Each entry must match `[[...]]` | Remove invalid entries |
| `wiki_external_links[]` | Each entry must start with `http://` or `https://` | Remove invalid entries |
| *(any)* | Unparseable YAML | Warn, leave content untouched |

## Architecture

### New dependency

```
yaml  (^2.x)
```

### `src/utils/raw-frontmatter.ts`

**Fix:** change `removeWikiFields` to remove all occurrences of each wiki field (global regex or loop-until-no-match).

**New exports:**

```ts
export function validateAndRepairSourceFrontmatter(
  content: string,
): { content: string; warnings: string[] }

export function validateAndRepairWikiPageFrontmatter(
  content: string,
): { content: string; warnings: string[] }
```

**Shared internal helper:** `validateAndRepairFrontmatter(content, rules)` — both public functions delegate to this, passing their respective rule sets.

Steps inside the helper:
1. Extract YAML block via `FM_RE`. No block → return as-is.
2. Detect duplicate keys via regex line scan (`/^([\w][\w_]*):/gm` counter).
3. Parse via `yaml.parse()` — catch syntax errors → warn, return original.
4. Build clean parsed object: merge duplicate list fields (union + dedupe), keep last value for scalar duplicates.
5. Apply per-field rules: filter invalid list entries, validate scalar formats, wrap scalars.
6. Re-serialize frontmatter via `yaml.stringify` of the cleaned object (preserves non-wiki fields as-is).
7. Reconstruct full file: `---\n<yaml>\n---\n<body>`.
8. Return `{ content, warnings }`.

### `src/phases/ingest.ts`

**Wiki pages** (around line 311 — before `vaultTools.write(page.path, page.content)`):

```ts
const { content: repairedPage, warnings: pageWarnings } =
  validateAndRepairWikiPageFrontmatter(page.content);
if (pageWarnings.length > 0) {
  yield { kind: "info_text", icon: "⚠️", summary: `Frontmatter repaired: ${page.path}`, details: pageWarnings };
}
await vaultTools.write(page.path, repairedPage);
```

**Source file** (around line 401 — after `upsertRawFrontmatter`, before `vaultTools.write(sourceVaultPath, ...)`):

```ts
const { content: repairedSource, warnings: fmWarnings } =
  validateAndRepairSourceFrontmatter(updatedSource);
if (fmWarnings.length > 0) {
  yield { kind: "info_text", icon: "⚠️", summary: "Source frontmatter repaired", details: fmWarnings };
}
await vaultTools.write(sourceVaultPath, repairedSource);
```

## Files Changed

- `package.json` — add `yaml ^2.x`
- `src/utils/raw-frontmatter.ts` — fix `removeWikiFields` + add two validator exports + shared helper
- `src/phases/ingest.ts` — call wiki-page validator before wiki write; call source validator before source write

## Out of Scope

- Standalone `lint` command
- `reinit` bulk re-validation pass
- Body content validation
