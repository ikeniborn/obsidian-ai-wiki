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
2. Add `validateAndRepairSourceFrontmatter` that runs after `upsertRawFrontmatter` and before `vaultTools.write` in ingest. On finding problems it auto-repairs and emits warnings — the operation continues.

## Approach

Use the [`yaml`](https://www.npmjs.com/package/yaml) package (YAML 1.2, no new major deps) for reliable parsing. Duplicate-key detection requires a separate regex pass because YAML parsers silently last-write-win on duplicate keys.

## Validation Rules (source file)

| Rule | Auto-repair |
|---|---|
| Duplicate YAML key in frontmatter | Merge values, keep last scalar; for list keys (`wiki_articles`) union all lists |
| `wiki_articles` entry not matching `[[...]]` | Remove invalid entries |
| `wiki_added` not `YYYY-MM-DD` | Remove the field |
| `wiki_updated` not `YYYY-MM-DD` | Remove the field |
| Unparseable YAML | Emit warning, leave content untouched |

## Architecture

### New dependency

```
yaml  (^2.x)
```

### `src/utils/raw-frontmatter.ts`

**Fix:** change `removeWikiFields` to remove all occurrences of each wiki field (use global regex or loop until no match).

**New export:**

```ts
export function validateAndRepairSourceFrontmatter(
  content: string,
): { content: string; warnings: string[] }
```

Steps:
1. Extract YAML block via `FM_RE`.
2. Detect duplicate keys via regex line scan (`/^(\w[\w_]*):/gm` counter).
3. Parse via `yaml.parse()` — catch syntax errors → warn, return original.
4. Build a clean `parsed` object: merge duplicate list fields (union), keep last value for scalar duplicates.
5. Validate `wiki_articles[]` entries — filter to `[[...]]` pattern.
6. Validate `wiki_added` / `wiki_updated` — remove if not `YYYY-MM-DD`.
7. Re-serialize only the wiki fields via `buildWikiFields`; non-wiki YAML is rebuilt via `yaml.stringify` of the cleaned object minus wiki fields.
8. Return `{ content: rebuilt, warnings }`.

### `src/phases/ingest.ts`

After line 401 (`upsertRawFrontmatter`), before `vaultTools.write`:

```ts
const { content: repairedSource, warnings: fmWarnings } =
  validateAndRepairSourceFrontmatter(updatedSource);
if (fmWarnings.length > 0) {
  yield { kind: "info_text", icon: "⚠️", summary: "Frontmatter repaired", details: fmWarnings };
}
// write repairedSource instead of updatedSource
await vaultTools.write(sourceVaultPath, repairedSource);
```

## Files Changed

- `package.json` — add `yaml ^2.x`
- `src/utils/raw-frontmatter.ts` — fix `removeWikiFields` + add `validateAndRepairSourceFrontmatter`
- `src/phases/ingest.ts` — call validator between `upsertRawFrontmatter` and `vaultTools.write`

## Out of Scope

- Wiki page frontmatter validation (separate concern, no current breakage reported)
- Standalone `lint` command (can be added later)
- `reinit` bulk validation pass (triggered by ingest internally)
