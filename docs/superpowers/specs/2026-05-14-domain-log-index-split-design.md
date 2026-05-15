# Domain-Level Log and Index Split

**Date:** 2026-05-14  
**Status:** Approved

## Problem

`_log.md` and `_index.md` are written to `!Wiki/` (root) instead of `!Wiki/{wiki_folder}/` (domain folder). Root cause: ingest.ts and query.ts compute `wikiRoot` by stripping the last path segment from `wikiVaultPath`, going up to the parent. init.ts hardcodes `wikiRootGuess = "!Wiki"`. As the wiki grows, one shared log/index becomes large and error-prone.

## Goal

- `_log.md` and `_index.md` live inside each domain folder: `!Wiki/{wiki_folder}/_log.md`, `!Wiki/{wiki_folder}/_index.md`
- `_wiki_schema.md` stays at `!Wiki/_wiki_schema.md` (shared)
- Existing root `!Wiki/_log.md` and `!Wiki/_index.md` are deleted on next `init` run

## Invariant

| File | Location |
|---|---|
| `_wiki_schema.md` | `!Wiki/` (root, shared) |
| `_index.md` | `!Wiki/{wiki_folder}/` (per domain) |
| `_log.md` | `!Wiki/{wiki_folder}/` (per domain) |

## Changes

### src/phases/ingest.ts

Split `wikiRoot` into two variables:

```ts
// before (line 58):
const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");

// after:
const domainRoot = wikiVaultPath;                                    // !Wiki/os
const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/"); // !Wiki
```

Update all usages:
- `_wiki_schema.md` → read from `${schemaRoot}/_wiki_schema.md` (unchanged path)
- `_index.md` → read/write from `${domainRoot}/_index.md`
- `_log.md` → write to `${domainRoot}/_log.md`
- Pass `domainRoot` to `appendLog` and `updateIndex`

### src/phases/query.ts

Same split on line 43. Read `_index.md` from `wikiVaultPath`, `_wiki_schema.md` from parent.

### src/phases/init.ts

**`ensureRootFiles`:**
- Keep: create `_wiki_schema.md` at root if missing
- Remove: creation of `_index.md` and `_log.md`
- Add: delete `!Wiki/_log.md` and `!Wiki/_index.md` if they exist (one-time migration)

**`appendLog` calls** — use domain's wiki folder, not `wikiRootGuess`:
- `runInit` (line 143): `entry.wiki_folder` is available → pass `domainWikiFolder(entry.wiki_folder)`
- `runInitWithSources` (line 326): `updatedDomain.wiki_folder` is available → pass `domainWikiFolder(updatedDomain.wiki_folder)`

**LLM context in both `runInit` and `runInitWithSources`:**
- Schema: read from `!Wiki/_wiki_schema.md` (unchanged)
- Index: if domain already exists in store → read from `!Wiki/{existing.wiki_folder}/_index.md`; if new domain → empty context (no index yet)

### src/phases/lint.ts

After fixing pages, rebuild `_index.md` for the domain:

```ts
// after writing fixed pages, rebuild domain index:
const allPages = await vaultTools.listFiles(wikiVaultPath);
const pageLinks = allPages
  .filter((f) => !META_FILES.some((m) => f.endsWith(m)))
  .map((f) => `- [[${basename(f, ".md")}]]`)
  .join("\n");
await vaultTools.write(`${wikiVaultPath}/_index.md`, `# Wiki Index\n\n${pageLinks}\n`);
```

Full rebuild (overwrite), not append. Ensures index stays consistent with actual pages after any lint run.

`META_FILES` filter continues to work by filename suffix regardless of path — no change needed there.

### Tests

Update mocked paths in phase tests where `_log.md` or `_index.md` paths are asserted.

## Migration

On next `init` run, `ensureRootFiles` deletes `!Wiki/_log.md` and `!Wiki/_index.md`. Domain-level index is populated by subsequent ingest runs. No automated migration of log history.
