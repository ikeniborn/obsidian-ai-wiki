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

Four pure functions, no side effects, no I/O:

```typescript
type WikiGraph = Map<string, Set<string>>; // pageId → outgoing pageIds

// Strip vault-path prefix and .md suffix → bare entity name used as graph node ID.
// e.g. "!Wiki/ai/ИИ-агент.md" → "ИИ-агент"
function pageId(vaultPath: string): string

function buildWikiGraph(pages: Map<string, string>): WikiGraph
function bfsExpand(seeds: string[], graph: WikiGraph, depth: number): Set<string>
function checkGraphStructure(graph: WikiGraph, hubThreshold: number): string
```

**`pageId(vaultPath)`** — `path.basename(vaultPath, ".md")`. Used everywhere to normalize vault paths to graph node IDs.

**`buildWikiGraph(pages)`** — iterates all pages, extracts `[[links]]` via `/\[\[([^\]|#]+)/g`, maps source `pageId → Set<target pageId>`. Dead links (target not in `pages`) create dangling targets — `graph.get(target)` returns `undefined`, BFS silently skips them. O(pages × avg_links).

**`bfsExpand(seeds, graph, depth)`** — BFS on **undirected** graph: at each hop, follow both outgoing edges (`graph.get(node)`) and incoming edges (pre-computed reverse index). Rationale: pages that link *to* a seed are as relevant as pages the seed links *to*. Returns `Set<pageId>` including seeds.

**`checkGraphStructure(graph, hubThreshold)`** — returns newline-joined issue strings (same format as existing `checkStructure`).

### `src/phases/query.ts` changes

Replace flat page concatenation with graph-filtered context. `pages` and `indexContent` are already read by existing code — no new I/O.

```
pages = vaultTools.readAll(files)           // existing
indexContent = tryRead(vaultTools, ...)     // existing
graph = buildWikiGraph(pages)               // new
candidates = keywordSeeds(question, pages)  // new: keyword match on pageId(path)
seeds = candidates.length > 0
  ? candidates
  : await llmSelectSeeds(question, indexContent, llm, model, signal)  // new: pre-pass
if seeds.length === 0:
  seeds = [...pages.keys()].map(pageId)    // fallback: treat all pages as seeds
selectedIds = bfsExpand(seeds, graph, settings.graphDepth)
selectedPages = filter pages where pageId(path) ∈ selectedIds
contextBlock = buildContextBlock(selectedPages, MAX_CONTEXT_CHARS)
LLM(systemPrompt, question, contextBlock)  // existing call, new contextBlock
```

**`keywordSeeds(question, pages)`** — split question by `\W+`, keep words with `length > 3`, match against `pageId(path).toLowerCase()` for each page. Returns matching pageIds.

**`llmSelectSeeds(question, indexContent, llm, model, signal)`** — sends question + index to LLM, returns `{ "seeds": ["PageA", "PageB"] }`. Uses lightweight call (no streaming). Timeout-guarded by existing `signal`.

**Fallback chain:**
1. Keyword → candidates found → use directly
2. Keyword → 0 candidates → LLM pre-pass
3. LLM pre-pass → 0 seeds or error → treat all pages as seeds (existing behavior)

**Context priority when `selectedPages` exceeds `MAX_CONTEXT_CHARS`:** seed pages first, then hop-1, then hop-2+.

### `src/phases/lint.ts` changes

Graph checks feed into ALL THREE LLM calls in lint:

```typescript
const pages = await vaultTools.readAll(files);  // existing
const graph = buildWikiGraph(pages);             // new
const structuralIssues = checkStructure(pages);  // existing
const graphIssues = checkGraphStructure(graph, settings.hubThreshold);  // new
const allIssues = [structuralIssues, graphIssues].filter(Boolean).join("\n");
```

1. **Lint report LLM call** — replace `structuralIssues` with `allIssues` in user message.
2. **`actualizeDomainConfig`** — unchanged (receives page content, not issues).
3. **`buildFixMessages`** — replace `structuralIssues` param with `allIssues` so LLM auto-fixer sees graph issues too.

Graph issues LLM can fix: add reciprocal `[[link]]` for unidirectional edges, add at least one link to/from isolated pages, note hub pages for user attention (no auto-split — too destructive).

**Three graph checks in `checkGraphStructure`:**

| Check | Condition | Issue string |
|---|---|---|
| Isolated node | `inDegree === 0 && outDegree === 0` | `- page: isolated node (no links in or out)` |
| Hub page | `outDegree > hubThreshold` | `- page: hub node (N outgoing links)` |
| Unidirectional link | `A → B`, B exists in graph, B has no link to A | `- A → [[B]] not reciprocated` |

Hub check uses **outgoing** degree only — flags pages referencing too many others (potential scope creep).

## Settings

Two new fields in `LlmWikiPluginSettings` and `DEFAULT_SETTINGS`:

| Field | Type | Default | Description |
|---|---|---|---|
| `graphDepth` | `number` | `1` | BFS hops from seed nodes in query. `0` = seeds only, max sensible value: 3. |
| `hubThreshold` | `number` | `20` | Outgoing-link count triggering hub warning in lint. |

Both exposed in the Settings tab under a new "Graph" section.

## Data Flow

```
query.ts
  vaultTools.readAll(files) → pages: Map<vaultPath, content>
  tryRead(..._index.md) → indexContent: string          // already exists
  buildWikiGraph(pages) → graph: WikiGraph              // new
  keywordSeeds(question, pages) → candidates: string[]  // new
  [candidates.length === 0]
    llmSelectSeeds(question, indexContent) → seeds      // new, may return []
  [seeds.length === 0] → seeds = all pageIds            // fallback
  bfsExpand(seeds, graph, depth) → selectedIds: Set<string>
  filter pages → selectedPages: Map<vaultPath, content>
  buildContextBlock(selectedPages) → contextBlock: string
  LLM(systemPrompt, question, contextBlock) → answer    // existing call

lint.ts
  vaultTools.readAll(files) → pages: Map<vaultPath, content>
  buildWikiGraph(pages) → graph: WikiGraph              // new
  checkStructure(pages) → structuralIssues: string      // existing
  checkGraphStructure(graph, hubThreshold) → graphIssues: string  // new
  allIssues = structuralIssues + graphIssues
  LLM(lintPrompt, allIssues, pages) → lintReport        // allIssues replaces structuralIssues
  actualizeDomainConfig(...) → patch                    // unchanged
  buildFixMessages(..., allIssues, ...) → fixMessages   // allIssues replaces structuralIssues
  LLM(fixMessages) → fixedPages
```

## Files Touched

| File | Change |
|---|---|
| `src/wiki-graph.ts` | **New** — `pageId`, `buildWikiGraph`, `bfsExpand`, `checkGraphStructure` |
| `src/phases/query.ts` | Add graph build + seed finding + BFS; replace flat contextBlock |
| `src/phases/lint.ts` | Add `buildWikiGraph` + `checkGraphStructure`; pass `allIssues` to both LLM calls |
| `src/types.ts` | Extend `LlmWikiPluginSettings` + `DEFAULT_SETTINGS` with `graphDepth`, `hubThreshold` |
| `src/settings.ts` | Add "Graph" section UI for `graphDepth`, `hubThreshold` |

## Out of Scope

- Persisted graph cache (build time negligible vs LLM latency)
- Graph visualization in Obsidian UI
- Cross-domain graph traversal
- Weighted edges or semantic similarity
- Auto-split of hub pages (too destructive for auto-fix)
