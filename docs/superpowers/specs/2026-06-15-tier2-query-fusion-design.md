---
review:
  spec_hash: b227f5fd52b5fc02
  last_run: 2026-06-15
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Component 1 — Fusion"
      text: "vague 'minimally' replaced with explicit exported inDegree(graph) helper shared by both call sites"
      verdict: fixed
    - id: F-002
      phase: clarity
      severity: INFO
      section: "Goals"
      text: "vague 'graceful' replaced with explicit fallback chain (Jaccard→llmSelectSeeds→error, no new mechanism)"
      verdict: fixed
chain:
  intent: null
---
# Tier 2 — Query Fusion + Threshold Fallback (Design)

Date: 2026-06-15
Status: Approved (brainstorming) — ready for implementation plan
Source recommendation: `docs/rag-quality-recommendations.md` § "Tier 2 — конвейер Query"

## Context

The native Query pipeline (`src/phases/query.ts#runQuery`) already does two-phase
retrieval: similarity seed selection (embedding, Jaccard, or Tier 1 hybrid dense⊕Jaccard
RRF) followed by BFS graph expansion (`bfsExpandRanked`). The final context block is
assembled **seeds-first, then BFS-expanded pages concatenated** and capped by page count.

Tier 1 (graph health + hybrid seed selection) and the eval harness (Recall@k, MRR over a
gold set; configs `dense`/`jaccard`/`hybrid`) are already shipped. `src/rrf.ts` exists and
is reused here. `scripts/eval-config.ts` already reserves a Tier 2 `dense+rrf` slot.

Tier 2 closes three gaps from the recommendation doc:

1. **Vector ⊕ BFS fusion** — the final context is concat, not a true fusion of the vector
   signal and the graph signal.
2. **Similarity threshold + fallback** — there is no max-cosine gate; weak seeds flow
   straight into BFS.
3. ~~Cross-encoder rerank~~ — **deferred** (see Out of Scope). No `/rerank` infra exists
   (Ollama does not serve cross-encoders natively), and fusion + threshold must be proven
   on the eval harness first.

## Goals

- Order the Query context by a scale-free fusion of vector rank and graph rank (RRF).
- Gate weak embedding seeds behind a tunable similarity threshold; below it, fall back
  through existing paths only (Jaccard → `llmSelectSeeds` → empty-seeds error), adding no
  new retrieval mechanism.
- Ship both as **opt-in, default-off** toggles that are measurable on the existing eval
  harness, with zero regression when off.

## Non-Goals (Out of Scope)

- **Cross-encoder rerank** (`bge-reranker-v2-m3`). Deferred to a separate spec once fusion
  is proven and a `/rerank` endpoint decision is made.
- **Token-budget context cap.** The fused context keeps the current page-count cap
  (`topK * 3`). Token budgeting stays Tier 3.
- **Weighted linear fusion** (`α·cosine + β·graph_score`). Rejected in favor of RRF — it
  needs scale calibration and two extra tuning knobs without measured benefit.

## Design

### Approach: pure RRF over the union (chosen)

Over the union `U = seeds ∪ BFS-expanded selected pages`, build two ranked lists and fuse
them with the existing `rrf()`:

- **vector list** — `U` sorted by similarity score descending. Seeds contribute
  `seedScores`, expanded pages contribute `expandedScores`; both come from the same
  `PageSimilarityService` and are already computed in the current pipeline.
- **graph list** — `U` sorted by graph proximity: hop distance ascending (seed = hop 0,
  expanded = its discovery hop from `bfsExpandWithHops`), tie-broken by backlink count
  (`inDegree` over the `WikiGraph`) descending.

`rrf([vectorList, graphList], rrfK)` produces the fused order. Every union page appears in
both lists, so the fusion is well-formed and scale-free (no cosine-vs-graph calibration).

Alternatives considered: weighted linear (rejected, see Non-Goals); RRF only on the BFS
tail with seeds pinned first (rejected — does not actually fuse, seeds ignore the graph
signal).

### Component 1 — Fusion (`src/fusion.ts`, new, pure)

```
fuseVectorGraph(
  seeds: string[],
  selectedIds: Set<string>,
  seedScores: Record<string, number>,
  expandedScores: Record<string, number>,
  graph: WikiGraph,
  depth: number,
  rrfK: number,
): string[]   // union page ids in fused order
```

- Derives the vector list from `seedScores ∪ expandedScores` over `selectedIds`.
- Derives the graph list: hop map from `bfsExpandWithHops(seeds, graph, depth)` (seeds =
  hop 0); backlink count from graph `inDegree`. Sort hop asc, then `inDegree` desc, then
  stable.
- Calls `rrf([vectorList, graphList], rrfK)` and returns ordered ids.
- Pure — unit-testable with no Obsidian APIs. Backlink counts come from a new exported
  helper `inDegree(graph: WikiGraph): Map<string, number>`; extract the existing inline
  computation from `checkGraphStructure` into this shared helper and call it from both
  sites (no duplication).

### Component 2 — Threshold + fallback (`src/phases/query.ts#runQuery`)

Applies only in `embedding` / `hybrid` modes (Jaccard mode is already keyword-based).
After seed selection, before BFS:

```
maxSeedScore = max(values(seedScores))   // 0 if no seeds
if maxSeedScore < seedSimilarityThreshold:
    jaccardSeeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations)
    if jaccardSeeds non-empty: use them (seeds + seedScores from Jaccard)
    else: fall through to existing llmSelectSeeds path
```

`seedSimilarityThreshold` default `0` disables the gate (current behavior). The existing
empty-seeds → `llmSelectSeeds` guard remains the final safety net. Emit a trace marker
(e.g. extend the existing tool_use/tool_result or `graph_stats`) indicating the fallback
branch taken, so the Query trace shows why seeds changed.

### Component 3 — Context ordering (`src/phases/query.ts#buildContextBlock`)

When `bfsFusion` is on, order the context by the fused order from Component 1 instead of
seeds-first concat. Keep the existing page-count cap (`topK * 3`). When `bfsFusion` is off,
the current ordering is unchanged (zero regression). Seed/BFS distinction is retained only
for the trace, not for ordering.

### Component 4 — Settings (`src/settings.ts`, `src/types.ts`)

Two new opt-in fields under `nativeAgent`, mirroring `hybridRetrieval`:

- `bfsFusion?: boolean` — default `false`. Reuses the existing `rrfK` setting.
- `seedSimilarityThreshold?: number` — default `0` (gate off). Tuned via eval.

UI toggles in `settings.ts` placed next to the hybrid-retrieval block. `runQuery` gains the
two values threaded from effective settings (same pattern as `bfsTopK` / `seedTopK`).

### Component 5 — Eval (`scripts/eval-config.ts`, `scripts/eval-retrieval.ts`)

Add a `dense+rrf` config (the slot already reserved in `eval-config.ts`). The runner applies
the fused order to the union and reports Recall@k / MRR against the gold set, comparable to
the `dense` baseline. This is the gate for ever flipping `bfsFusion` default-on.

## Data Flow

```
question
 → seed-select (embedding / hybrid)        → seedScores
 → maxSeedScore < seedSimilarityThreshold?
        ├─ yes → jaccard seeds → empty? → llmSelectSeeds
        └─ no  → (keep embedding seeds)
 → BFS depth 1 (bfsExpandRanked)            → selectedIds + expandedScores
 → bfsFusion on?
        ├─ yes → fuseVectorGraph(...)       → fused order
        └─ no  → seeds-first concat (current)
 → buildContextBlock(order, cap = topK*3)
 → answer (+ existing link validation)
```

## Error Handling

- `fuseVectorGraph` is pure and total: empty union → empty result → existing
  "No relevant pages found" guard fires.
- Threshold fallback degrades monotonically: Jaccard empty → `llmSelectSeeds` →
  empty-seeds error. No new failure surface.
- `bfsFusion` off and `seedSimilarityThreshold` `0` reproduce current behavior exactly —
  the safe default.

## Testing

Unit (Vitest, pure functions — no Obsidian):

- `fusion`: two ranked lists fuse to the expected order; ties broken by hop then backlink;
  a page present in only one list still ranks; `rrfK` respected.
- threshold gate: `maxSeedScore` above keeps embedding seeds; below triggers Jaccard;
  Jaccard-empty falls through to `llmSelectSeeds`.
- eval: `dense+rrf` resolves in `resolveConfigs`; the runner applies fused order.

`lat.md/tests.md`: add a "Tier 2 — Query Fusion" section (sibling to the Tier 1 section),
`require-code-mention: true`, with leaf specs for fusion ordering, threshold fallback, and
the eval config. Each leaf gets a one-line `// @lat:` ref in the test code.

## lat.md Documentation Updates

- `lat.md/operations.md` § Query: document the fused ordering and the threshold fallback
  chain under "Seed Selection" / a new "Fusion" subsection.
- Cross-link `[[src/fusion.ts#fuseVectorGraph]]` from the operations spec.
- After implementation: run `lat check` (post-task checklist) — all wiki links and code
  refs must pass.
- `docs/rag-quality-recommendations.md`: the Tier 2 mermaid already depicts the target
  pipeline; mark the fusion + threshold steps as shipped once merged.

## Rollout

1. Land fusion + threshold behind default-off toggles (zero regression).
2. Run `dense` vs `dense+rrf` on the gold set; record Recall@k / MRR delta.
3. Flip `bfsFusion` default-on only if the delta is positive; otherwise keep opt-in and
   iterate on the graph-list tie-break / `rrfK`.

## Open Questions

None blocking. Threshold value and `rrfK` are eval-tuned, not fixed in this spec.
