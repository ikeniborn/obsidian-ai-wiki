---
review:
  spec_hash: "26880de6a7ac1469"
  last_run: "2026-06-01"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: CRITICAL
      section: "Architecture"
      section_hash: "8f89b6fcc187176e"
      text: "UI gating by agentLogEnabled was unspecified — view.ts would show trace regardless of setting, contradicting intent."
      verdict: fixed
      verdict_at: "2026-06-01"
chain:
  intent: "docs/superpowers/intents/2026-06-01-query-tracing-intent.md"
---

# Design: Query Pipeline Tracing

**Date:** 2026-06-01
**Status:** draft
**Intent:** [[docs/superpowers/intents/2026-06-01-query-tracing-intent.md]]

## Overview

Add structured tracing to the query pipeline so seed selection scores, BFS expansion by hop, and LLM token counts are visible in the Obsidian UI and `_agent.jsonl`. No changes to query logic or shared ingest/lint paths.

## Architecture

The existing `graph_stats` RunEvent is extended with two new fields. A new `bfsExpandWithHops` function is added alongside the unchanged `bfsExpand`. A new `selectRelevantScored` method is added to `PageSimilarityService` alongside the unchanged `selectRelevant`. `selectSeeds` in `wiki-seeds.ts` changes its return type (only one caller: `query.ts`). The `_agent.jsonl` log receives richer data for free via the existing `logEvent` mechanism.

All tracing output is gated by `agentLogEnabled` in plugin settings. When disabled: `view.ts` renders `graph_stats` in the existing compact form (no scores, no BFS-by-hop), and `logEvent` does not write to disk. When enabled: full trace visible in UI and written to `_agent.jsonl`.

## Components

### `src/types.ts` — extend `graph_stats`

```ts
| {
    kind: "graph_stats";
    seeds: string[];
    expanded: number;
    total: number;
    fromCache: boolean;
    seedScores: Record<string, number>;      // id → score (jaccard or cosine)
    expandedByHop: Record<number, string[]>; // hop depth → [pageIds]
  }
```

### `src/wiki-graph.ts` — new function

```ts
export function bfsExpandWithHops(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
): { expanded: Set<string>; byHop: Record<number, string[]> }
```

`bfsExpand` is unchanged (still used by `lint.ts`).

### `src/wiki-seeds.ts` — change return type of `selectSeeds`

```ts
// Before:
export function selectSeeds(...): string[]

// After:
export function selectSeeds(...): { id: string; score: number }[]
```

Only caller is `query.ts`. No ingest/lint impact.

### `src/page-similarity.ts` — new method

```ts
async selectRelevantScored(
  sourceContent: string,
  indexAnnotations: Map<string, string>,
  allPaths: string[],
): Promise<{ path: string; score: number }[]>
```

Existing `selectRelevant` is unchanged (used by lint/format/init).

### `src/phases/query.ts` — collect and emit scores

Embedding mode calls `selectRelevantScored` instead of `selectRelevant`, collects `{path, score}` pairs. Jaccard mode uses updated `selectSeeds` return value. Both modes build `seedScores: Record<string, number>`. BFS uses `bfsExpandWithHops` to get `expandedByHop`. These are passed to the `graph_stats` yield.

The extra fields (`seedScores`, `expandedByHop`) are always computed — they come free from existing calls. When `agentLogEnabled` is false: `view.ts` renders compact form (no scores/hops), `logEvent` skips disk write.

### `src/view.ts` — render extended `graph_stats`

When `agentLogEnabled` is **true** — full trace:
```
🌐 Seeds: ArticleA (0.87), ArticleB (0.72), ArticleC (0.41)  [cache hit]
   BFS +1: [ArticleD, ArticleE]
   BFS +2: [ArticleF, ArticleG]
```

When `agentLogEnabled` is **false** — existing compact form (unchanged):
```
🌐 Граф: 3 seeds [ArticleA, ArticleB, ArticleC] → 7 / 42 страниц
```

Rules:
- `view.ts` reads `this.plugin.settings.agentLogEnabled` to select render mode
- Seeds truncated to 5, remainder shown as "…+N"
- BFS hop lines omitted if `expandedByHop` is empty (depth=0 or no links)
- Score formatted to 2 decimal places

### `src/phases/llm-utils.ts` — extend `computeSpeedText`

```
// Before:
in: 312 tok/s · out: 45 tok/s · latency: 820ms

// After:
in: 4821 tok (312 tok/s) · out: 156 tok (45 tok/s) · latency: 820ms
```

## Data Flow

```
query.ts
  ├── selectSeeds (scored return) / selectRelevantScored → seedScores: Record<string, number>
  ├── bfsExpandWithHops → { expanded: Set, byHop: Record<number, string[]> }
  └── yield graph_stats { ...existing, seedScores, expandedByHop }
        └── view.ts renders seeds+scores+BFS-by-hop
        └── logEvent() writes to _agent.jsonl (if agentLogEnabled)

llm-utils.ts computeSpeedText
  └── "in: N tok (X tok/s) · out: M tok (Y tok/s) · latency: Zms"
```

## `_agent.jsonl` entry (no format change, richer data)

```json
{
  "ts": "2026-06-01T12:00:00.000Z",
  "session": "abc123",
  "op": "query",
  "domainId": "domain-1",
  "event": {
    "kind": "graph_stats",
    "seeds": ["ArticleA", "ArticleB"],
    "expanded": 4,
    "total": 42,
    "fromCache": true,
    "seedScores": { "ArticleA": 0.87, "ArticleB": 0.72 },
    "expandedByHop": { "1": ["ArticleC", "ArticleD"], "2": ["ArticleE", "ArticleF"] }
  }
}
```

## Error Handling

- `selectRelevantScored` falls back to score=0 if embedding fetch fails (same behavior as `selectRelevant`)
- `bfsExpandWithHops` returns empty `byHop` if seeds not in graph (same as `bfsExpand` returning empty set)
- Missing scores default to 0 — display gracefully omits "(0.00)" entries

## Testing

- Existing ingest/lint tests must pass unchanged (shared files not broken)
- `bfsExpandWithHops` unit test: verify hop attribution matches BFS depth
- `selectSeeds` unit test: verify returned scores match jaccard calculation
- `selectRelevantScored` unit test: verify scores returned in embedding and jaccard modes
- Integration: `graph_stats` event in query run contains non-empty `seedScores` and `expandedByHop`

## Constraints Honored

- `selectRelevant` signature unchanged → lint/format/init unaffected
- `bfsExpand` unchanged → lint.ts unaffected
- No new API calls, no new log channels
- Tracing (UI + log) gated by existing `agentLogEnabled` setting — both `view.ts` render mode and `logEvent` disk write check this flag
- Seed selection logic unchanged — scores are read-only metadata
