---
review:
  spec_hash: c79f21787a61abc3
  last_run: 2026-05-15
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Out of Scope"
      text: "Word 'fast' used as adjective without metric in Out-of-Scope rationale."
      verdict: fixed
      verdict_at: 2026-05-15
---

# Graph Cache, Smarter Seeds, Visibility

**Date:** 2026-05-15
**Status:** Draft
**Extends:** [2026-05-12 Graph-Aware Query & Lint](./2026-05-12-graph-aware-query-lint-design.md)

## Problem

Three gaps in current graph-aware implementation:

1. **No visibility.** `runQuery` selects seeds and expands via BFS but never emits which pages were chosen or how many were kept. Users cannot diagnose why a page was/wasn't included in the answer context.
2. **Naive seed selection.** `keywordSeeds()` matches whole-word tokens only against `pageId` (filename), not page content. Russian morphology + content-only references miss easily: question "neural network" misses page `Машинное-обучение` even when its content contains "neural network".
3. **No cache.** Both `query` and `lint` rebuild the graph from scratch on every call (O(pages × avg_links)). On a 500-page wiki, both phases waste the work; on rapid successive queries (chat thread), this compounds.

## Solution

Three additive changes, each independently shippable, opt-in via existing settings defaults:

1. **`GraphCache`** — in-memory, per-domain, hash-keyed. Invalidated on writes; hash check as safety net.
2. **`wiki-seeds.ts`** — extracted seed-selection module with content-aware scoring (Jaccard on tokens from pageId + content head + question), top-K cut, stop-words.
3. **`graph_stats` RunEvent** — emit `{seeds, expanded, total, fromCache}` so view + tests can observe seed selection.

Default settings preserve current behavior closely (Phase E rollout documents the small differences).

## Architecture

### New file: `src/wiki-graph-cache.ts` (~80 LOC)

```typescript
type CacheEntry = { hash: string; graph: WikiGraph };

export class GraphCache {
  private store = new Map<string, CacheEntry>();

  get(domainId: string, pages: Map<string, string>): { graph: WikiGraph; fromCache: boolean };
  invalidate(domainId: string): void;
  clear(): void; // for tests
}

export const graphCache = new GraphCache();
```

**Hash function:** stable string from sorted entries `${path}:${content.length}`. Content-length proxies for mtime (Obsidian's `TFile.stat.mtime` not always available in tests; length cheap and changes on every meaningful edit). Hash collisions are not safety-critical: stale graph degrades answer quality slightly until next write triggers `invalidate`.

**Lifetime:** module singleton, in-memory only. Plugin reload → empty cache → first call rebuilds. Rebuild cost is bounded by `pages × avg_outgoing_links` — same cost as current pre-cache implementation, so worst-case parity.

**Concurrency:** single-flight controller already serializes phase calls. No locking needed.

### New file: `src/wiki-seeds.ts` (~120 LOC)

```typescript
export function tokenize(s: string): Set<string>;
export function scoreSeed(
  questionTokens: Set<string>,
  pageId: string,
  content: string,
): number;
export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
): string[];
```

**Tokenize:** split on `/[\s\W]+/u`, lowercase, drop tokens with length ≤ 2, drop stop-words. Stop-word list ~30 items (RU: что, как, для, или, это, при, без, …; EN: the, a, an, of, to, is, are, was, …). Stored as `const STOP_WORDS = new Set([...])` in module.

**Score:** Jaccard `|Q ∩ P| / |Q ∪ P|` where:
- Q = tokenize(question)
- P = tokenize(pageId) ∪ tokenize(content.slice(0, 200))

`200` chars covers frontmatter + first heading + lead paragraph for typical wiki page. Cap protects against giant pages dominating tokenization cost (otherwise O(content.length) per page).

**selectSeeds:** computes score for each page, drops pages with `score < minScore`, sorts descending, returns top-K pageIds. Empty if no page passes threshold (caller falls back to LLM seeds → allPageIds, same chain as today).

### Modified file: `src/phases/query.ts`

```typescript
// before:
const graph = buildWikiGraph(pages);
let seeds = keywordSeeds(question, pages);
if (seeds.length === 0) {
  const seedRes = await llmSelectSeeds(...);
  seeds = seedRes.seeds;
  outputTokens += seedRes.outputTokens;
}

// after:
const { graph, fromCache } = graphCache.get(domain.id, pages);
let seeds = selectSeeds(question, pages, seedTopK, seedMinScore);
if (seeds.length === 0) {
  const seedRes = await llmSelectSeeds(...);
  seeds = seedRes.seeds;
  outputTokens += seedRes.outputTokens;
}
if (seeds.length === 0) seeds = allPageIds;
const selectedIds = bfsExpand(seeds, graph, graphDepth);
yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: pages.size, fromCache };
```

Two new args to `runQuery`: `seedTopK: number`, `seedMinScore: number`.

Inline `keywordSeeds` function deleted from `query.ts`.

### Modified file: `src/phases/lint.ts`

```typescript
// before:
const graph = buildWikiGraph(pages);

// after:
const { graph } = graphCache.get(domain.id, pages);
```

No event emission from lint (lint already has rich output). `fromCache` discarded.

### Modified file: `src/types.ts`

```typescript
// In LlmWikiPluginSettings:
seedTopK: number;      // default 5, range [1, 50]
seedMinScore: number;  // default 0.1, range [0, 1]

// In RunEvent union:
| {
    kind: "graph_stats";
    seeds: string[];
    expanded: number;
    total: number;
    fromCache: boolean;
  }
```

### Modified file: `src/agent-runner.ts`

Propagate `this.settings.seedTopK`, `this.settings.seedMinScore` into `runQuery` calls (both save=false and save=true branches).

### Modified file: `src/main.ts`

After each successful write that mutates wiki pages (ingest/lint/query-save/init), call `graphCache.invalidate(domainId)`. Where exactly:
- `controller.ts` already wraps phases — invalidate in the controller's post-run hook based on which operation ran.
- For ingest: invalidate after the final `vaultTools.write` succeeds.
- For lint: invalidate after the fixed-pages loop completes.
- For query (save=true): invalidate after `vaultTools.write(savePath, ...)`.
- For init: invalidate after the operation completes.

Implementation: place invalidation calls in `controller.ts` (after each `runOperation` completes successfully with the operation's domain ID). Single call site avoids touching every phase file.

### Modified file: `src/view.ts`

Handle new event kind in `onEvent`:

```typescript
case "graph_stats": {
  const cacheHint = e.fromCache ? " (cache hit)" : "";
  const seedPreview = e.seeds.slice(0, 3).join(", ") + (e.seeds.length > 3 ? `, …+${e.seeds.length - 3}` : "");
  this.renderLine(`Граф: ${e.seeds.length} seeds [${seedPreview}] → ${e.expanded} / ${e.total} страниц${cacheHint}`);
  break;
}
```

### Modified file: `src/settings.ts` + `src/i18n.ts`

Two new UI fields (number inputs, clamp on save):
- `seedTopK_name` / `seedTopK_desc` — "Seed top-K" / "Maximum seed pages selected by keyword score (1–50)."
- `seedMinScore_name` / `seedMinScore_desc` — "Seed min score" / "Minimum Jaccard score for a page to be considered a seed (0.0–1.0)."

Translations: en, ru, es (mirror existing pattern at i18n.ts:78–81, 282–285, 484–487).

## Data Flow

```
User → query("neural network")
  │
  ▼
runQuery
  ├─ vaultTools.readAll(files) → pages
  │
  ├─ graphCache.get(domainId, pages)
  │    ├─ hash = sortedKeys+lengths
  │    ├─ if matches stored → return {graph, fromCache:true}
  │    └─ else buildWikiGraph(pages), store, return {graph, fromCache:false}
  │
  ├─ selectSeeds(question, pages, topK=5, minScore=0.1)
  │    ├─ tokens(question) ∩ tokens(pageId + content[:200]) per page
  │    ├─ filter score >= minScore
  │    └─ top-K by score desc
  │
  ├─ if seeds.empty → llmSelectSeeds (existing)
  ├─ if still empty → seeds = allPageIds
  │
  ├─ selectedIds = bfsExpand(seeds, graph, graphDepth)
  ├─ yield graph_stats event
  │
  ├─ buildContextBlock(pages, seedSet, selectedIds)
  └─ llm.chat.completions.create(...)

Concurrent: any wiki write
  → main.ts hook → graphCache.invalidate(domainId)
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Hash collision (theoretical) | Stale graph degrades quality; next write invalidates. No crash. |
| `selectSeeds` returns `[]` | Existing fallback: `llmSelectSeeds`. |
| `llmSelectSeeds` returns `[]` or throws | Existing fallback: `seeds = allPageIds`. |
| `tokenize(question)` empty (short query, all stop-words) | `selectSeeds` returns `[]` → LLM fallback. |
| `seedTopK` invalid (NaN, <1, >50) | Settings UI clamps to `[1, 50]`. Internal clamp as defense in depth. |
| `seedMinScore` invalid (NaN, <0, >1) | Settings UI clamps to `[0, 1]`. |
| `invalidate` called before `get` | No-op: `Map.delete` of missing key. |
| Cache stale after external Obsidian edit | Hash mismatch on next `get` → automatic rebuild. |
| `bfsExpand` seed not in graph | Already handled (existing test). |

All errors are graceful degradation; no new `RunEvent` of kind `error` introduced.

## Testing

### New test files

**`tests/wiki-graph-cache.test.ts`** (~120 LOC)
- `get` returns `fromCache: false` on first call
- `get` returns `fromCache: true` on second call with same pages
- `get` returns `fromCache: false` after `invalidate`
- `get` rebuilds when a page's content length changes (hash mismatch)
- `get` rebuilds when pages added/removed (hash mismatch)
- `clear` empties all entries
- Different `domainId` keys do not collide

**`tests/wiki-seeds.test.ts`** (~150 LOC)
- `tokenize`: lowercase, length filter, stop-words dropped (RU + EN); empty string → empty set
- `scoreSeed`: range `[0, 1]`; identical tokens → 1; disjoint → 0
- `selectSeeds`: topK respected; minScore filters; sorted by score desc; empty when no page passes
- Content-match case: page with keyword only in content (not pageId) is selected
- Russian + English mixed tokens

### Extended test files

**`tests/phases/query.test.ts`** — add:
- `graphDepth=1` BFS expansion: page B reachable from seed A is included
- `graphDepth=2` two-hop expansion
- `llmSelectSeeds` fallback path triggered when no keyword match
- `allPageIds` fallback when LLM returns empty
- `graph_stats` event emitted with correct shape

**`tests/phases/lint.test.ts`** (new or extend existing) — second `runLint` call hits cache (assert via `GraphCache` spy or test internal counter)

**`tests/agent-runner.integration.test.ts`** — write operation triggers `graphCache.invalidate`

### Coverage targets

- New modules: 100% line + branch.
- Modified phases: existing coverage + new BFS/fallback paths.

## Rollout

Five phases, each independently mergeable:

**Phase A — Foundation (no behavior change)**
- Add `src/wiki-graph-cache.ts` + tests.
- Add `src/wiki-seeds.ts` + tests.
- Add `seedTopK`, `seedMinScore` to settings types and defaults.
- Add `graph_stats` to `RunEvent` union.
- No callers yet; pure addition.

**Phase B — Integration**
- Wire `graphCache.get` into `query.ts` and `lint.ts`.
- Wire `selectSeeds` into `query.ts` (replacing inline `keywordSeeds`).
- Emit `graph_stats` from `query.ts`.
- Render `graph_stats` in `view.ts`.

**Phase C — Settings UI**
- Add `seedTopK`, `seedMinScore` fields to settings page.
- Add i18n strings (en, ru, es).

**Phase D — Invalidation**
- Hook `graphCache.invalidate(domainId)` into ingest/lint/query-save/init write paths via `controller.ts` or `main.ts`.

**Phase E — Documentation**
- Update `CLAUDE.md` Architecture section: mention `GraphCache` and `wiki-seeds`.
- Add doc comment in `bfsExpand` noting undirected behavior.
- Update README if user-facing settings warrant mention.

### Backward compatibility

Defaults `seedTopK=5`, `seedMinScore=0.1` are conservative. Compared to the old `pageId` substring match:
- **Recovered cases:** content-only mentions (page body contains keyword, filename doesn't) now score >0 — new wins.
- **Lost cases:** pure substring matches across word boundaries (`"api"` inside `"RapID-ware"`) no longer match because new tokenizer splits on `/[\s\W]+/u`. These were typically false positives; loss is intentional.
- **Net effect:** higher precision (less noise), recall improved on RU content matches.

Risk surface: an unexpectedly noisy seed set (low-quality match scoring above threshold) could push out a more relevant page when truncated by `topK`. Mitigation: phase A ships behavior-neutral additions, phase B is the cut-over. If real-world recall regresses, raise `seedMinScore` (settings-only fix, no code change).

No feature flag added — fallback chains (LLM seeds → allPageIds) preserve the bottom of the funnel, so worst case is "same context as today, plus seed metric event".

## Open Questions

None. Ready for review.

## Out of Scope

- Persistent (on-disk) graph cache.
- Embedding-based seed similarity (would require an embedding model and runtime inference; current keyword approach is deterministic, offline, and has O(pages × tokens) cost with no network dependency).
- Distance-based context trimming (rank expanded pages by hops from seed, drop tail to fit token budget).
- Graph visualization in the side panel.

Items above tracked for a future spec if user feedback warrants them.
