---
review:
  spec_hash: 391e0bd315589b1e
  last_run: 2026-06-29
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Retrieval knobs (no new settings)"
      fragment: "graphDepth, seedSimilarityThreshold, rrfK, and the similarity mode are reused as-is"
      text: "seedMinScore is passed in the cfg object but was not enumerated among the reused knobs"
      fix: "List seedMinScore in the Retrieval-knobs section (per-domain, stage 1)"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-002
      phase: clarity
      severity: INFO
      section: "Prompt / Context Assembly"
      fragment: "union of entity types of domains present in finalIds"
      text: "entity_types_block size bound not tied to a test assertion"
      fix: "Add a Testing assertion covering entity_types_block domains"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-003
      phase: consistency
      severity: INFO
      section: "1. Extract retrieveDomainCandidates()"
      fragment: "seedMinScore: number;"
      text: "cfg field names seedMinScore while the knobs prose omitted it (same root as F-001)"
      fix: "Reconcile cfg fields with the reused-knobs prose"
      verdict: fixed
      verdict_at: 2026-06-29
chain:
  intent: null
---

# Cross-Domain Wiki Search — Design

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan

## Problem

When the sidebar domain selector is set to `(all)` and the user runs a query, the
current code silently searches only the **first** domain. `runQuery` (`src/phases/query.ts:53`)
takes `const domain = domains[0]`, even though `agent-runner.ts:159` already passes
**all** domains when `domainId` is `undefined`. So "all domains" is a no-op that
quietly drops every domain but one.

We want a real cross-domain search: when the user opts into "all", retrieve relevant
pages from **every** domain, then narrow the merged pool down with a second retrieval
pass, and send only the final page set to the LLM as a single answer.

## Goals

- A per-query scope choice ("All" vs "Domain") surfaced next to the query input when
  the sidebar is on `(all)`, plus a per-query override when a concrete domain is selected.
- A two-stage cross-domain retrieval:
  - **Stage 1** — sequentially over every domain: vector seeds + graph BFS → candidate pool.
  - **Stage 2** — among the merged pool only: re-rank by vector + graph (RRF fusion) → final top-N.
- One LLM call on the final merged page set.
- Graceful degradation to Jaccard when embeddings are not configured.
- No new settings; reuse the existing retrieval knobs.

## Non-Goals

- No new BFS expansion in stage 2 — stage 2 operates strictly on the stage-1 candidate
  pool ("among the selected"); it never pulls in new pages.
- No per-domain answers + LLM synthesis (rejected approach C). Exactly one LLM call.
- No change to the legacy `domainId === undefined` path (kept as-is for safety).
- No auto-saved `Q-…` page for cross-domain answers (query is dispatched with `save=false`).

## UX — Scope Toggle

A segmented control ("All" / "Domain") rendered next to the query input in `src/view.ts`,
beside the existing `domainSelect`. Behaviour is driven by the sidebar selection:

| sidebar `domainSelect`         | "All" segment | "Domain" segment       | default |
|--------------------------------|---------------|------------------------|---------|
| `(all)` (value `""`)           | enabled       | **disabled**           | "All"   |
| a concrete domain              | enabled       | enabled (= that domain)| "Domain"|

- "Domain" always means the domain currently selected in the sidebar. It is disabled
  while the sidebar is on `(all)` (there is no concrete domain to target).
- Per-query override: even with a concrete domain in the sidebar, the user may pick
  "All" to run cross-domain for this one query.
- On sidebar change the toggle resets to the row default (no stale scope↔domain mismatch).
- The last in-row scope choice is remembered in `localConfig` as `lastQueryScope`
  (mirrors how `lastDomain` is persisted today).
- i18n labels for the two segments and the disabled hint are added to en/ru/es.

### Routing

`view.ts` submit → `controller.query`:

- "Domain" → `controller.query(q, domainId)` — single-domain, unchanged.
- "All"    → `controller.query(q, "*")` — new cross-domain sentinel.

`controller.query` / `dispatch` pass `"*"` through as `domainId`. In `agent-runner.run`
the domain-resolution rule becomes:

```
domainId === "*"      → all domains      → runCrossDomainQuery
domainId concrete     → [that domain]    → runQuery (unchanged)
domainId === undefined→ all domains      → runQuery(domains[0])   // legacy, untouched
```

The `"*"` sentinel (rather than reusing `undefined`) keeps the legacy `undefined` path
intact and makes cross-domain an explicit, intentional signal.

## Architecture

### 1. Extract `retrieveDomainCandidates()` (refactor of `query.ts`)

Phases 1–4 of `runQuery` (read index → seed select + gate + fallback → glob → readAll →
build graph → `bfsExpandRanked`) are extracted into a reusable function. After the
refactor, single-domain `runQuery` calls the same function, so its observable behaviour
is unchanged (verified by a snapshot equivalence test).

```ts
async function* retrieveDomainCandidates(
  domain: DomainEntry,
  question: string,
  vaultTools: VaultTools,
  similarity: PageSimilarityService | undefined,
  signal: AbortSignal,
  cfg: {
    graphDepth: number;
    seedTopK: number;
    seedMinScore: number;
    bfsTopK: number;
    seedSimilarityThreshold: number;
  },
): AsyncGenerator<RunEvent, DomainCandidates | null>;
```

It is a generator so it can forward the existing progress events
(`tool_use` / `tool_result` / `graph_stats`); the orchestrator labels them per domain.
The result is delivered via the generator `return` value.

```ts
interface DomainCandidates {
  domainId: string;
  pages: Map<string, string>;        // ONLY candidate page content (seeds ∪ bfs), not the whole domain
  seeds: string[];                   // per-domain seed stems
  candidateIds: Set<string>;         // seeds ∪ bfsTopK-expanded
  seedScores: Record<string, number>;     // cosine | jaccard
  expandedScores: Record<string, number>; // from bfsExpandRanked
  graph: Map<string, Set<string>>;   // domain subgraph (stems globally unique)
  annotations: Map<string, string>;  // index annotations of candidates (for the final prompt)
  retrievalMode: RetrievalMode;
  denseMax: number;
  seedFallback: "none" | "jaccard" | "llm";
  seedFallbackReason?: SeedFallbackReason;
}
```

**Memory:** the function builds the graph over the domain's full page set (needed to scan
`[[links]]`) but returns only candidate content in `pages`. The full page `Map` goes out
of scope when the function returns and is GC'd. Peak memory ≈ one domain + the accumulated
pool. `graphCache` continues to cache the subgraph per domain id.

**Empty domain** (no index / no candidates) → `return null`; the orchestrator skips it.

`runQuery` (single-domain) becomes: call `retrieveDomainCandidates(domains[0])`; if `null`,
emit the existing "No relevant pages found" error; otherwise run the optional fusion +
`buildContextBlock` + LLM tail exactly as today. Pure refactor, no contract change.

### 2. Orchestrator `runCrossDomainQuery()` (new `src/phases/query-cross-domain.ts`)

Signature mirrors `runQuery`, with `domains: DomainEntry[]` = all domains.

**Stage 1 — gather (sequential):**

```
pool = []
for (const domain of domains) {
  if (signal.aborted) return
  yield { kind: "tool_use", name: `Domain: ${domain.name}` }   // visible sequential progress
  const res = yield* retrieveDomainCandidates(domain, question, vaultTools, similarity, signal, cfg)
  if (res) pool.push(res)
  // non-candidate content already freed inside the function
}
if (pool.length === 0) { yield { kind: "error", message: "No relevant pages found across domains." }; return }
```

**Stage 2 — merge + re-search among the selected:**

```
mergedGraph    = union of res.graph            // disjoint; stems are globally unique
mergedSeeds    = union of res.seeds
mergedSeedSc    = union of res.seedScores       // cosine comparable across domains (global embedding model)
mergedExpSc     = union of res.expandedScores
allCandidates  = union of res.candidateIds
mergedPages    = union of res.pages
mergedAnnos    = union of res.annotations

fusedOrder = fuseVectorGraph(                    // REUSE src/fusion.ts
  mergedSeeds, allCandidates,
  mergedSeedSc, mergedExpSc,
  mergedGraph, graphDepth, rrfK)                  // RRF of vector rank + graph hop/inDegree, globally

finalIds = fusedOrder.slice(0, seedTopK)          // top-seedTopK across the whole merged pool
```

`fuseVectorGraph` already implements exactly "re-search by vector and graph among the
selected": the vector list ranks the pool by cosine desc, the graph list ranks by hop
distance asc (tie-broken by inDegree), and RRF fuses the two. It introduces no new nodes —
it operates over `seeds ∪ expanded`. Cross-domain cosine is comparable because the
embedding model is a single global setting. In Jaccard mode the same scores are
token-overlap values and RRF works identically.

**Context + LLM (single call):**

```
contextBlock = buildContextBlock(mergedPages, new Set(mergedSeeds), new Set(finalIds), seedTopK, fusedOrder)
// availableLinks = finalIds (all prefixed, unique, valid link targets)
// → one streaming LLM call + the existing link-validation tail (knownStems built from the whole vault)
```

**Sequential, not parallel** — as requested; also gentler on memory and the embedding endpoint.

### Retrieval knobs (no new settings)

- `seedTopK` governs **both** stages: top-`seedTopK` seeds per domain in stage 1, and the
  top-`seedTopK` final pages in stage 2. (User intent: "pick 5 → search top-5 per domain,
  then top-5 among the found.")
- `bfsTopK` governs the stage-1 graph expansion depth (candidate gathering).
- `seedMinScore` is reused as-is and applies **per-domain in stage 1** (the Jaccard seed
  floor inside `retrieveDomainCandidates`); it is not re-applied in stage 2.
- `graphDepth`, `seedSimilarityThreshold`, `rrfK`, and the similarity mode are reused as-is.
- No new setting → **no settings migration**. Every field of the `cfg` object passed to
  `retrieveDomainCandidates` (`graphDepth`, `seedTopK`, `seedMinScore`, `bfsTopK`,
  `seedSimilarityThreshold`) maps to one of these existing settings.

Note: the single-domain context cap is `topK * 3` (an existing constant at `query.ts:169`,
allowing seeds + up to 2×seedTopK BFS pages). Cross-domain deliberately does **not** use
`*3`; it caps the final context at exactly `seedTopK` pages.

## Prompt / Context Assembly

The `prompts/query.md` template is unchanged; only the placeholder values differ for
cross-domain:

| placeholder             | single-domain         | cross-domain                                              |
|-------------------------|-----------------------|----------------------------------------------------------|
| `domain_name`           | `domain.name`         | "All domains (N): work, personal, …" (i18n)              |
| `available_links_block` | selectedIds           | `finalIds` — unchanged (stems prefixed, unique, valid)   |
| `entity_types_block`    | the domain's types    | union of entity types **of domains present in `finalIds`**, grouped by domain (≤ seedTopK domains → bounded) |
| `index_block`           | full `_index.md`      | annotations of `finalIds` only (`domain/stem: annotation`), NOT every domain's full index |

Cross-domain is transparent to the LLM: it simply receives pages from several domains in
one context and answers, linking only to targets in `available_links_block`.

## Telemetry / Events

- `tool_use { name: "Domain: <name>" }` before each domain in stage 1 → visible sequential progress.
- Per-domain `graph_stats` (existing shape) are forwarded from `retrieveDomainCandidates`,
  so the user sees seeds / fallback / retrievalMode for each domain.
- `eval_meta.found_pages = finalIds`; `retrievalConfig` gains `crossDomain: true` and
  `domainsSearched: N`. `question` / `answer` as usual → dev-mode rating works unchanged
  (query axes: answer + retrieval).
- The LLM tail (`tool_use Answering` → stream → `ValidateLinks` / `FixingLinks`) is reused verbatim.

## Error Handling & Edge Cases

- Domain with no `_index.md` / no candidates → `retrieveDomainCandidates` returns `null` → skipped.
- All domains empty → `{ error: "No relevant pages found across domains." }`.
- Embedding failure on a domain → existing per-domain fallback (cosine → jaccard →
  `llmSelectSeeds`) inside the function, isolated. One failing domain does not break others.
- Zero domains configured → `{ error: "No domains configured." }`.
- `signal.aborted` checked between domains and inside the function → cancellation leaves no half-work.
- Duplicate stems across domains are impossible (the `wiki_<domain>_…` mask), so graph/score
  merging is collision-free. A defensive guard logs a warning if a stem is already present in
  `mergedGraph` (a sign of a broken mask) and keeps the first.

## Testing

Out-of-vault eval following the existing `eval/` pattern (tsx, no Obsidian):

- `eval/cross-domain/run.ts`: 2–3 synthetic domains with pages + a deterministic fake
  embedding provider.
- Assertions:
  1. Stage-1 pool = union of every domain's candidates (none lost).
  2. `finalIds.length ≤ seedTopK`, ordered by fused order.
  3. The cross-domain final set contains pages from more than one domain when relevance is spread.
  4. Jaccard mode (no embeddings) yields a non-empty final set.
  5. An empty domain is skipped without failing the run.
  6. Refactor equivalence: single-domain `runQuery` via the new `retrieveDomainCandidates`
     returns the same answer / same `found_pages` as before the refactor (snapshot).
  7. `entity_types_block` covers exactly the domains present in `finalIds` (no entity types
     from domains absent from the final set, none missing).
- `npm run lint` for lint/typecheck.

## Docs (post-implementation, mandatory)

- `iwiki:iwiki-ingest` on `src/phases/query-cross-domain.ts` → add a "Cross-Domain Query"
  section to `docs/wiki/retrieval.md` and update `operations.md#Query`.
- `/iwiki-lint` — no broken refs, no orphans.

## Files Touched

| file | change |
|------|--------|
| `src/phases/query.ts` | extract `retrieveDomainCandidates`; `runQuery` calls it (refactor) |
| `src/phases/query-cross-domain.ts` | **new** — `runCrossDomainQuery` orchestrator |
| `src/agent-runner.ts` | route `domainId === "*"` to `runCrossDomainQuery` |
| `src/controller.ts` | pass `"*"` sentinel through `query` / `dispatch` |
| `src/view.ts` | scope toggle UI + submit routing |
| `src/local-config.ts` | `lastQueryScope` persistence |
| `src/i18n.ts` | scope labels + "All domains (N)" (en/ru/es) |
| `eval/cross-domain/run.ts` | **new** — cross-domain eval |
