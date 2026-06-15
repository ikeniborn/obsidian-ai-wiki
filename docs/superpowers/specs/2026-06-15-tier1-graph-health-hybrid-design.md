---
review:
  spec_hash: 62a03434c3393df2
  last_run: 2026-06-15
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "B2. hybrid similarity mode"
      section_hash: 986f64839043a901
      text: '"widened candidate pool ... bounded to keep cost flat" — no explicit numeric bound for the pre-RRF candidate pool; the exact value is deferred to the implementation plan.'
      verdict: accepted
      verdict_at: 2026-06-15
    - id: F-002
      phase: clarity
      severity: INFO
      section: "A2. Lint near-duplicate report"
      section_hash: 7bd705fb9386baa7
      text: '"default cap generous enough for typical wikis" — the pairwise-cost page cap default is unspecified; pinned in the plan.'
      verdict: accepted
      verdict_at: 2026-06-15
chain:
  intent: docs/superpowers/intents/2026-06-14-rag-query-quality-intent.md
  depends_on: docs/superpowers/specs/2026-06-15-rag-eval-harness-design.md
---
# Design: Tier 1 — graph health + hybrid retrieval (RAG quality)

**Date:** 2026-06-15
**Status:** draft
**Intent:** [docs/superpowers/intents/2026-06-14-rag-query-quality-intent.md](../intents/2026-06-14-rag-query-quality-intent.md)
**Scope:** Tier 1 of the staged RAG-quality plan. Two components: (A) graph health
— dedup-on-Ingest + Lint near-duplicate; (B) hybrid retrieval — dense ⊕ jaccard via RRF.
The retrieval eval harness (Phase 1, already merged — PR #9) is the instrument that measures
this tier. Tier 2 (RRF over vector+BFS, cross-encoder rerank, similarity threshold) is out of scope.

## Decisions taken during brainstorming (fixed inputs to the plan)

These were resolved with the user and are not re-litigated downstream:

1. **Hybrid sparse source = the existing `jaccard` mode**, fused with `embedding` (dense) via RRF.
   No new embedding endpoint (`bge-m3` rejected — it lands in the parent's *no-autonomy* zone:
   a mandatory new external endpoint). Keyless-friendly.
2. **Dedup gate = post-LLM cosine gate** on Ingest, not a pre-LLM prompt change.
3. **Dedup resolve = redirect + LLM-merge.** A fired gate triggers a small LLM merge call that
   folds the new content into the existing page. Chosen because Ingest's "Update" is a full
   **overwrite** (`vault-tools` `write`, verified at `src/phases/ingest.ts:347`) — a blind
   create→update redirect would clobber the existing page. LLM-merge preserves both sides.
4. **Per-operation models (recommendation #3) — out of scope.** The infrastructure already exists
   (`perOperation` flag + `operations` map for both backends, resolved in
   `src/agent-runner.ts:buildOptsFor` and `src/controller.ts`). Nothing to build; the user sets it.

## Acceptance (from intent)

Carried from the approved intent. FIXED inputs.

### Desired Outcomes (this tier)
- **No duplicates after Ingest** — re-ingesting a similar note updates the existing page instead
  of spawning a second; lint surfaces near-duplicate pairs as merge candidates.
- **Better seeds via hybrid** — dense+sparse fusion surfaces pages that dense-only misses
  (API names, flags, error codes — exact tokens dense loses); visible on eval.

(The other two parent Outcomes — Recall@k/MRR are real numbers; fallback instead of noise —
belong to Phase 1 (done) and Tier 2 respectively.)

### Health Metrics (must not degrade)
- **Offline Jaccard path works keyless.** Every new feature degrades gracefully with no embedding
  endpoint: hybrid → jaccard; dedup gate → jaccard overlap; lint near-dup → embedding-only, no-op
  without a cache.
- **Query token budget (~6800 tok/call) does not grow.** Hybrid reorders seeds; it does not enlarge
  the seed set or the context.
- **Query latency unchanged with flags off.** All new behavior is behind flags defaulting OFF; the
  hot path is untouched until opt-in. With hybrid ON, p50 grows ≤ 20% vs flags-off (extra jaccard
  pass + RRF over a bounded candidate pool).
- **Existing test suite stays green; no new `tsc` errors in touched files; `lint` clean.**

### Done when (BOTH hold)
1. *Ship gate* — each feature behind its flag, tests pass, `lint`+`tsc` clean on touched files,
   all four Health Metrics intact.
2. *Observable outcome* — the eval harness shows `hybrid` Recall@k/MRR measured against the
   `dense`/`jaccard` baselines on the fixed gold set, and `hybrid` demonstrates a measurable
   improvement over dense-only; re-ingesting a near-duplicate note does not spawn a second page.

## Overview

Tier 1 keeps the wiki graph healthy (fewer duplicate pages → better BFS and better seed selection)
and makes seed retrieval hybrid (dense embedding fused with sparse token overlap). All work is
flag-gated with safe-off defaults, so default behavior and the keyless path are unchanged.

Two independent components, each understandable and testable on its own:

- **A — Graph health:** A1 dedup gate on Ingest, A2 near-duplicate report in Lint.
- **B — Hybrid retrieval:** an `rrf` util + a `hybrid` similarity mode, plus a `hybrid` eval config.

## Components

### A1. Dedup gate on Ingest

One purpose: stop Ingest from creating a page that is a near-duplicate of one that already exists;
instead merge the new content into the existing page.

**Location:** `src/phases/ingest.ts`, the page write loop (`src/phases/ingest.ts:316`), acting only
on pages that would be a **create** (`existingContent === null`, `src/phases/ingest.ts:324`).

**New similarity method** — `PageSimilarityService.maxCosineToExisting(candidateText, excludePids)`:
- `embedding` mode: embed `candidateText` (one `/embeddings` call, batchable across the run's
  create-candidates), max-pool cosine against every cached chunk vector of every page not in
  `excludePids`. Returns `{ pid, score }` for the best match (`score = 0` if cache empty).
- `jaccard` mode: token-overlap (`scoreSeed`/Jaccard) of `candidateText` against each page's
  annotation; same `{ pid, score }` shape. Keeps the gate working keyless.

`excludePids` = the pids created/written earlier in this same Ingest run (so two genuinely new
pages in one run don't suppress each other) plus the candidate's own pid.

**Gate logic per create-candidate:**
1. `const { pid, score } = await similarity.maxCosineToExisting(text, excluded)`.
2. `if (dedupOnIngest && score >= dedupThreshold)` → **fire**: this candidate duplicates page `pid`.
3. On fire: run an LLM merge (below), write the merged content to the existing page (Update), skip
   the duplicate create, push a `ОБЪЕДИНЕНА` log entry, and emit a dedup `info_text` event naming
   both pages and the score.
4. Otherwise: the existing create path runs unchanged.

**LLM merge call:** reuses the Ingest LLM caller already in scope (`llm`, `model`, `opts`) via
`parseWithRetry` (the same helper used for LLM #1/#2 at `src/phases/ingest.ts:122,233`). A new merge
prompt (`prompts/`) takes the existing page body + the new candidate body and returns one merged page
(frontmatter + `wiki_sources` preserved; existing facts not dropped). After writing, the page's index
annotation is refreshed via the existing `upsertIndexAnnotation` path.

**Flags:** `dedupOnIngest: boolean` (default **false**), `dedupThreshold: number` (default **0.85** —
high, only near-identical pages; guarded: the chosen value is logged). `dedupThreshold <= 0` also
disables the gate.

### A2. Lint near-duplicate report

One purpose: surface pairs of existing pages that are near-duplicates, as merge candidates.

**Location:** `src/phases/lint.ts`. The similarity cache is already loaded for Lint
(`src/phases/lint.ts:253`) and Lint already owns merge/redirect machinery
(`src/phases/lint.ts:422`).

**Logic:** after the cache is loaded (embedding mode only), compute pairwise max-pool cosine across
all pages; collect unordered pairs with `score >= nearDupThreshold`. Emit each pair as an
`info_text` event (both pids + score), grouped into a "near-duplicate candidates" summary. This is
**report-only** (proposal-first / HUMAN CHECKPOINT per intent) — it does not auto-merge; the user or
a later Lint merge handles it.

**Cost guard:** O(N²) over pages × O(chunks²) per pair. For large vaults, cap at a configurable page
count and `log()` what was skipped (no silent truncation). Default cap generous enough for typical
wikis.

**Flags:** `lintNearDuplicate: boolean` (default **false**), `nearDupThreshold: number`
(default **0.80**). No-op when no embedding cache exists (keyless).

### B1. `rrf` fusion util

One purpose: rank-based fusion of several ranked ID lists, scale-free.

**Location:** new `src/rrf.ts`. Pure, Obsidian-free, unit-tested.

```
rrf(rankedLists: string[][], k = 60): { id: string; score: number }[]
// score(id) = Σ over lists  1 / (k + rank_in_list(id))   (rank 1-based)
// returns ids sorted by descending fused score
```

Built here for hybrid (dense rank ⊕ jaccard rank). **Reused by Tier 2** (vector rank ⊕ BFS rank) —
one implementation, no duplication later.

### B2. `hybrid` similarity mode

One purpose: produce a fused dense+sparse seed ranking behind the existing `selectRelevantScored`
interface, so Query picks it up transparently.

**Location:** `src/page-similarity.ts`.

- `SimilarityConfig.mode` gains `"hybrid"` (currently `"jaccard" | "embedding"`).
- `selectRelevantScored` / `selectRelevant` in `hybrid` mode:
  1. Run `selectEmbeddingScored` and `selectJaccardScored` over a **widened candidate pool** (not
     pre-truncated to `topK`, so RRF sees full ranks; bounded to keep cost flat).
  2. Feed the two ranked `path` lists into `rrf(..., rrfK)`.
  3. Return the top `topK` fused entries in the existing `{ path, score }[]` shape.
- **Keyless degradation:** in `hybrid` with no embedding endpoint, `selectEmbedding*` already falls
  back to jaccard internally → fusion degenerates to jaccard ⊕ jaccard ≈ jaccard. No crash, no
  key required.
- **Consumer:** the Query seed path (`selectRelevantScored` in `src/phases/query.ts`) — no change
  there beyond mode selection. `selectByEntities` (Ingest entity retrieval) is **not** changed in
  this tier.

**Flag:** `rrfK: number` (default **60**). Mode is selected via the existing similarity-mode setting
(extended to offer `hybrid`); default mode unchanged → opt-in.

### B3. `hybrid` eval config

One purpose: make hybrid measurable with the existing harness.

**Location:** `scripts/eval-config.ts` + `scripts/eval-retrieval.ts`.

- `eval-config.ts`: add `hybrid` → `"hybrid"` in `NAME_TO_MODE`; extend the error message.
- `eval-retrieval.ts:makeRunner`: add a `hybrid` branch building a `PageSimilarityService` in
  `hybrid` mode and running the same seed → `bfsExpandRanked` union flow as the `embedding` branch.

Run: `tsx scripts/eval.ts --vault <path> --gold scripts/eval/<vault>.gold.json --config dense,jaccard,hybrid`.

## Data flow

```
Ingest (A1):
  LLM #2 pages ─> per create-candidate ─> maxCosineToExisting(text, runPids)
       │                                        │
       │                          score ≥ dedupThreshold ? ── no ─> create (unchanged)
       │                                        │ yes
       └────────────────────────> LLM merge(existing + new) ─> write existing (Update) + dedup event

Lint (A2):
  cache loaded ─> pairwise max-pool cosine ─> pairs ≥ nearDupThreshold ─> info_text candidates

Query (B):
  question ─> hybrid mode ─> [embedding ranks, jaccard ranks] ─> rrf(k=60) ─> top-k seeds ─> BFS union

Eval (B3):
  --config dense,jaccard,hybrid ─> makeRunner per config ─> Recall@k / MRR table (+ baseline delta)
```

## Error handling

- **Dedup embed failure** (endpoint down mid-run): `maxCosineToExisting` returns `score = 0` (no
  match) so the gate cannot fire on a failed signal — Ingest proceeds with a normal create rather
  than risking a wrong merge. The failure is logged.
- **LLM merge failure / unparsable output:** fall back to the normal create (do not lose the new
  content); emit a warning that the merge was skipped.
- **Hybrid with empty jaccard or empty embedding side:** RRF over one non-empty list = that list's
  order; never throws on an empty list.
- **Lint near-dup, no cache:** skip silently (keyless / not-yet-embedded vault).
- **Eval `hybrid` without endpoint:** same warning the harness already emits for `dense` — labeled,
  not silently mislabeled.

## Settings summary

| Setting | Default | Zone |
|---|---|---|
| `dedupOnIngest` | `false` | feature flag |
| `dedupThreshold` | `0.85` | guarded (log choice, tune by eval) |
| `lintNearDuplicate` | `false` | feature flag |
| `nearDupThreshold` | `0.80` | guarded |
| similarity `mode` adds `hybrid` | unchanged default | feature flag |
| `rrfK` | `60` | guarded |

All-off defaults guarantee the "latency unchanged with flags off" Health Metric.

## Testing

- **Pure unit (vitest, keyless):** `rrf()` (rank math, empty lists, single list); `maxCosineToExisting`
  over a mock cache (embedding + jaccard); lint near-dup pairing + threshold + cap.
- **Eval unit:** `hybrid` config resolves (`tests/eval-config.test.ts`); metrics unaffected.
- **Integration:** Ingest dedup gate with a mock LLM merge (fires → Update + event; below threshold →
  create); Lint near-dup emits expected pairs.
- **Gate:** full current suite green; `lint` clean; no new `tsc` errors in touched files.
- **lat.md:** add test-spec sections (graph-health dedup, lint near-dup, rrf, hybrid mode) under
  `lat.md/tests.md` with `// @lat:` refs; document the features under `lat.md/operations.md` /
  `lat.md/architecture.md`; run `lat check`.

## Autonomy note (from intent)

Each Tier 1 feature is **proposal-first** (HUMAN CHECKPOINT). This design is that proposal for the
graph-health + hybrid bundle. Within it, implementation is full-autonomy; parameter defaults are
guarded (logged); making any external endpoint or API key *mandatory* is no-go (hence `bge-m3`
rejected and every feature degrades keyless).

## Out of scope (later)

- `bge-m3` dense+sparse single-model retrieval (new mandatory endpoint — no-go as default).
- Per-operation model defaults / presets (recommendation #3 — infra already exists).
- `selectByEntities` hybrid (Ingest entity retrieval keeps its current dense/jaccard branches).
- Tier 2: RRF over vector+BFS, cross-encoder rerank, similarity threshold + fallback (the `rrf` util
  built here is reused there).
- Auto-merge in Lint and wiring eval into CI as a gate.
