# Graph-Aware Query & Lint

**Date:** 2026-05-12  
**Status:** Approved

## Problem

Query loads all wiki pages into a flat 80 000-char context block. Two failure modes:

1. **Quality degradation** — LLM drowns in irrelevant pages, answer quality drops.
2. **Context overflow** — large wikis exceed `MAX_CONTEXT_CHARS`, important pages get silently truncated.

Lint performs only regex-level structural checks (dead links, frontmatter). Graph-level pathologies — isolated entities, hub overload, one-directional links — go undetected.

## Solution

Build an in-memory wiki graph from `[[links]]` at runtime (no persistence, no cache). Use it to:

- **Query**: select only seed pages + BFS neighbors instead of all pages.
- **Lint**: add three graph-structural checks before the LLM lint pass.

## Architecture

### New file: `src/wiki-graph.ts`

Three pure functions, no side effects, no I/O:

```typescript
type WikiGraph = Map<string, Set<string>>; // pageId → outgoing links

function buildWikiGraph(pages: Map<string, string>): WikiGraph
function bfsExpand(seeds: string[], graph: WikiGraph, depth: number): Set<string>
function checkGraphStructure(graph: WikiGraph, hubThreshold: number): string
```

`buildWikiGraph` — regex scan of all pages for `[[...]]` links, O(pages × links).  
`bfsExpand` — BFS from seed nodes up to `depth` hops.  
`checkGraphStructure` — returns newline-joined issue strings (same format as existing `checkStructure`).

### `src/phases/query.ts` changes

Replace flat page concatenation with graph-filtered context:

```
loadAllWikiPages()
  → buildWikiGraph(pages)
  → keywordSeeds(question, pages)     // match question words against page names
  → llmSelectSeeds(candidates, index) // only if keyword found 0 candidates
  → bfsExpand(seeds, graph, depth)    // depth from settings.graphDepth
  → buildContextBlock(selectedPages)  // only selected pages, priority: seed > hop-1 > hop-2
  → LLM.answer()
```

**Seed selection logic:**

| Keyword candidates | Action |
|---|---|
| ≥ 1 found | Use as seeds directly (skip LLM pre-pass) |
| 0 found | LLM pre-pass: send question + all page names, get `{ "seeds": [...] }` |

If after BFS expansion `selectedPages` still exceeds `MAX_CONTEXT_CHARS`, truncate by priority: seed pages first, then hop-1, then hop-2.

### `src/phases/lint.ts` changes

Add graph checks to structural analysis:

```typescript
const structuralIssues = checkStructure(pages);               // existing
const graphIssues = checkGraphStructure(graph, hubThreshold); // new
const allIssues = [structuralIssues, graphIssues].filter(Boolean).join("\n");
```

Graph issues are passed to the LLM lint prompt unchanged — LLM proposes fixes (add back-link, split hub page, etc.).

**Three graph checks:**

| Check | Condition | Issue string |
|---|---|---|
| Isolated node | `inLinks === 0 && outLinks === 0` | `page: isolated node (no links in or out)` |
| Hub page | `outLinks > hubThreshold` | `page: hub node (N outgoing links)` |
| Unidirectional link | `A → B` but `B` exists in graph and has no link back to `A` | `A → [[B]] not reciprocated` |

## Settings

Two new fields in `LlmWikiPluginSettings`:

| Field | Type | Default | Description |
|---|---|---|---|
| `graphDepth` | `number` | `1` | BFS hops from seed nodes in query. `0` = seeds only. |
| `hubThreshold` | `number` | `20` | Outgoing-link count triggering hub warning in lint. |

Both exposed in the Settings tab under a new "Graph" section.

## Data Flow

```
query.ts
  loadAllWikiPages() → pages: Map<string,string>
  buildWikiGraph(pages) → graph: WikiGraph
  keywordSeeds(question, pages) → candidates: string[]
  [if candidates.length === 0] llmSelectSeeds(question, indexContent) → seeds
  bfsExpand(seeds, graph, depth) → selectedIds: Set<string>
  filter pages by selectedIds → selectedPages: Map<string,string>
  buildContextBlock(selectedPages) → contextBlock: string
  LLM(systemPrompt, question, contextBlock) → answer

lint.ts
  loadAllWikiPages() → pages: Map<string,string>
  buildWikiGraph(pages) → graph: WikiGraph
  checkStructure(pages) → structuralIssues: string
  checkGraphStructure(graph, hubThreshold) → graphIssues: string
  LLM(lintPrompt, allIssues, pages) → lintReport
```

## Files Touched

| File | Change |
|---|---|
| `src/wiki-graph.ts` | **New** — `buildWikiGraph`, `bfsExpand`, `checkGraphStructure` |
| `src/phases/query.ts` | Replace flat context with graph-filtered context |
| `src/phases/lint.ts` | Add `checkGraphStructure` to structural checks |
| `src/settings.ts` | Add `graphDepth`, `hubThreshold` fields + UI |
| `src/types.ts` | Extend `LlmWikiPluginSettings` with two new fields |

## Out of Scope

- Persisted graph cache (not needed — build time negligible vs LLM latency)
- Graph visualization in Obsidian UI
- Cross-domain graph traversal
- Weighted edges or semantic similarity
