---
review:
  spec_hash: 8881456ec82f2fa9
  last_run: 2026-06-02
  phases:
    structure:
      status: passed
    coverage:
      status: passed
    clarity:
      status: passed
    consistency:
      status: passed
  section_hashes:
    "Overview": f50026c7f3178e7e
    "Architecture": 970fec7f46977b48
    "Task 1: BFS Similarity Expansion": 0326b2a8afe768cc
    "Task 2: wiki_sources Fix": 66b5d8eeabfb04f1
    "Components & Interfaces": 6515abf0e6f60669
    "src/wiki-graph.ts": b0192d161f2199f6
    "src/phases/lint.ts": 748cd39588e8ba26
    "src/types.ts": 5dc3f10eae3dbf52
    "src/settings.ts": 90b71da41fff51d6
    "Data Flow": 3b2c13832af755e7
    "Query pipeline": c640457e92c960f4
    "Lint pipeline": b0568586338ea5aa
    "Error Handling": 92504a19c77a6d47
    "What Does Not Change": 4323674d2460f369
    "Testing": 51fc5660c8072e44
    "src/wiki-graph.test.ts — bfsExpandRanked": fbe2a69c9d8af756
    "src/utils/raw-frontmatter.test.ts or src/phases/lint.test.ts — buildTitleMap": 78e0af84bfb33cfa
    "src/phases/lint.test.ts — validateWikiSources": 5b2684f8e45a6760
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Task 2: wiki_sources Fix"
      section_hash: b36ce4fd2a4f32c8
      text: >-
        Terminology inconsistency: 'titleAliases' (Architecture §Task 2, Data Flow §Lint pipeline)
        vs 'titleMap' (Components §lint.ts). 'knownStems ∪ titleAliases' implies Set<string>,
        but buildTitleMap returns Map<string,string> and validateWikiSources takes the full Map.
        Unclear whether titleAliases = titleMap.values() (stems only) or the full Map.
      verdict: fixed
      verdict_at: 2026-06-02
chain:
  intent: docs/superpowers/intents/2026-06-02-bfs-similarity-expansion-wiki-sources-fix-intent.md
---
# Design: BFS Similarity Expansion + wiki_sources Fix

**Date:** 2026-06-02
**Status:** approved
**Intent:** [2026-06-02-bfs-similarity-expansion-wiki-sources-fix-intent.md](../intents/2026-06-02-bfs-similarity-expansion-wiki-sources-fix-intent.md)

## Overview

Two changes to the query and lint pipelines:

1. **BFS Similarity Expansion** — after BFS topology traversal, rank non-seed pages by vector/Jaccard similarity against the query and keep top-K. Replaces the unused Hub threshold setting.
2. **wiki_sources Fix** — extend lint's dead-link resolution to cover Obsidian-style title links (e.g. `[[Настройка прокси]]`), and add a post-process guard that prevents LLM-driven false-positive removal of valid `wiki_sources` entries.

---

## Architecture

### Task 1: BFS Similarity Expansion

New function `bfsExpandRanked` in `src/wiki-graph.ts`. Wraps existing `bfsExpand`: runs full BFS first, then similarity-ranks the non-seed results, returning seeds + top `bfsTopK` ranked pages.

`src/phases/query.ts` replaces `bfsExpandWithHops` with `bfsExpandRanked`, passing `query`, `pages`, `similarity`, and `bfsTopK`.

`hubThreshold` removed from `src/types.ts`, `src/settings.ts`, `src/phases/lint.ts`. Replaced by `bfsTopK` (default: 10).

### Task 2: wiki_sources Fix

New function `buildTitleMap` in `src/phases/lint.ts`. Runs once before the per-article loop. Reads H1 (or `title:` frontmatter) from all non-wiki vault files, builds a lowercased `title → stem` map.

`knownStems` in lint is extended with stems from `titleMap` (its values) before being used in dead-link checks and passed to the LLM prompt context.

New function `validateWikiSources` applied as a post-process step after each LLM fix: for every `[[entry]]` in `wiki_sources`, resolve against `knownStems ∪ titleAliases`. Remove only if unresolvable from both.

---

## Components & Interfaces

### `src/wiki-graph.ts`

```typescript
export async function bfsExpandRanked(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
  pages: Map<string, string>,          // vaultPath → content (Jaccard fallback + path mapping)
  query: string,
  bfsTopK: number,
  annotations?: Map<string, string>,   // pageId → annotation (for embedding path)
  similarity?: PageSimilarityService,
): Promise<Set<string>>
```

- Seeds always included in result regardless of `bfsTopK`.
- `bfsTopK <= 0` → returns all BFS pages (backward compat).
- Embedding path: calls `similarity.selectRelevantScored(query, annotations, bfsPaths)` — similarity service handles query embedding internally; page vectors reuse existing cache.
- Jaccard fallback (no similarity or throws): `scoreSeed(questionTokens, pageId, content)` from `wiki-seeds`.
- `pages` keys are vaultPaths; function derives pageIds via `pageId(path)` internally.

### `src/phases/lint.ts`

```typescript
async function buildTitleMap(
  paths: string[],
  vaultTools: VaultTools,
): Promise<Map<string, string>>  // lowercased-title → stem
```

- Parses first `# Heading` (H1) or `title:` frontmatter field.
- Unreadable files silently skipped.
- Duplicate titles: last-write wins.

```typescript
function validateWikiSources(
  content: string,
  knownStems: Set<string>,
  titleMap: Map<string, string>,
): string
```

- Returns content unchanged if frontmatter unparseable.
- Entries not matching `[[...]]` format left intact (already handled by `validateAndRepairWikiPageFrontmatter`).

### `src/types.ts`

```typescript
// Remove:
hubThreshold: number;   // default was 20

// Add:
bfsTopK: number;        // default: 10
```

### `src/settings.ts`

UI label: **"BFS context top-K"**
Description: "Max BFS-expanded pages ranked by similarity and added to query context. 0 = all pages."

---

## Data Flow

### Query pipeline

```
question
  → seed selection (embedding/Jaccard from _index.md annotations) [unchanged]
  → bfsExpandRanked(seeds, graph, depth, pages, question, bfsTopK, annotations, similarity)
      internally: bfsExpand → full expanded set
      embedding path: similarity.selectRelevantScored(query, annotations, bfsPaths)
                      → page vectors from cache, query vector fetched once internally
      Jaccard fallback: scoreSeed(questionTokens, pageId, content) per BFS page
      result: seeds + top bfsTopK ranked non-seeds
  → buildContextBlock [unchanged]
  → LLM
```

Page vectors already cached after `similarity.loadCache()` in Phase 2. No extra cache load needed.

### Lint pipeline

```
allMdPaths
  → buildTitleMap(non-wiki files)          ← NEW, runs once
  → knownStems ∪ titleMap.values()         ← extended set (stems only)

per-article loop:
  → LLM lint fix [unchanged]
  → validateWikiSources(content, knownStems, titleMap)   ← NEW post-process
  → write fixed content
```

`buildTitleMap` runs once before the loop. Cost: O(non-wiki files) reads — acceptable, these paths are already enumerated in `allMdPaths`.

---

## Error Handling

| Location | Failure | Behaviour |
|---|---|---|
| `bfsExpandRanked` | Embedding unavailable / no queryVector | Jaccard fallback |
| `bfsExpandRanked` | Similarity throws | Log, fall back to full BFS |
| `bfsExpandRanked` | `bfsTopK <= 0` | Return all BFS pages |
| `buildTitleMap` | File unreadable | Skip file silently |
| `buildTitleMap` | No H1 found | Skip (stem already in knownStems by filename) |
| `validateWikiSources` | Unparseable frontmatter | Return content unchanged |

---

## What Does Not Change

- `bfsExpand`, `bfsExpandWithHops` — unchanged
- `filterStaleWikiLinks` — unchanged (does not touch `wiki_sources`)
- `PageSimilarityService` — unchanged
- Frontmatter format — unchanged
- `validateAndRepairWikiPageFrontmatter` — unchanged

---

## Testing

### `src/wiki-graph.test.ts` — `bfsExpandRanked`

- Seeds always in result even when `bfsTopK=1` and many BFS pages exist
- `bfsTopK=0` returns all BFS pages
- Jaccard path: page with higher overlap score included over lower-scored page when both fit in top-K
- Embedding path: mock `queryVector` → cosine ranking respected
- Similarity throws → fallback to full BFS, no exception

### `src/utils/raw-frontmatter.test.ts` or `src/phases/lint.test.ts` — `buildTitleMap`

- H1 parsed correctly: `# Настройка прокси` → `"настройка прокси" → "wiki_os_pac_file"`
- Case-insensitive: `[[НАСТРОЙКА ПРОКСИ]]` resolves

### `src/phases/lint.test.ts` — `validateWikiSources`

- `[[Настройка прокси]]` with matching titleMap entry → preserved
- `[[wiki_os_deleted_page]]` not in knownStems, not in titleMap → removed
- Invalid frontmatter → returned unchanged
- Entry without `[[...]]` format → left intact
