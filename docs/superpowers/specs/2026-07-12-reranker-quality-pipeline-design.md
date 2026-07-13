---
review:
  spec_hash: f49b096990722f33
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-12-reranker-quality-pipeline-intent.md
---
# Reranker Quality Pipeline - Design

Date: 2026-07-12
Status: approved
Intent: `docs/superpowers/intents/2026-07-12-reranker-quality-pipeline-intent.md`

## Acceptance From Intent

- Settings show a separate `Reranker` block, consistent with existing model settings.
- Users can enable or disable runtime reranking.
- Users can choose or enter a reranker model without the UI recommending one specific model.
- Query gathers candidates through lexical seeds, description-vector seeds, chunk-vector retrieval, graph BFS expansion, graph-local page scoring, chunk scoring, and candidate union before reranking.
- Final answer context uses top chunks after rerank when reranker succeeds.
- Query falls back to current candidate ordering when reranker loading, scoring, timeout, or endpoint support fails.
- Settings expose explicit top-K controls and explain `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- Settings validate `rerankerTopN >= contextTopN`.
- No quality stage becomes default-on until eval evidence supports that decision.

## User Decisions

1. Keep lexical and vector retrieval parallel at the recall layer.
2. Do not make lexical and vector retrieval strict sequential filters.
3. After graph BFS, rerank graph pages locally with lexical, page-description vector, and graph-distance signals.
4. Score graph chunks with lexical, chunk-vector, and inherited page scores before the reranker input pool.
5. Do not introduce `graphChunkTopN` in the first design. If eval shows graph chunks are too noisy or too narrow, add it later as an explicit setting.
6. Do not show `BAAI/bge-reranker-v2-m3` or any other concrete reranker model as a recommendation in settings.

## Approaches Considered

### Chosen: recall union, graph-local scoring, bounded rerank

Lexical page seeds, page-description vectors, and direct chunk vectors run as independent recall inputs. Their output feeds graph BFS, graph-local page scoring, chunk scoring, and a bounded candidate union. The selected reranker model only sees `rerankerTopN` candidates, and the LLM answer context only receives `contextTopN` chunks.

This keeps recall broad while using graph-local scoring and reranking to improve precision. It also keeps latency bounded by explicit settings.

### Rejected: strict lexical then vector, or vector then lexical

A strict sequence makes the first stage a hard filter. It can drop relevant pages when the user uses different wording than the wiki, when RU and EN domain terms differ, or when a page is only reachable through graph context.

### Rejected: rerank the full corpus

Full-corpus reranking is slower and duplicates work already done by lexical, vector, and graph retrieval. It also makes the latency target harder to enforce.

## Runtime Pipeline

The Query pipeline becomes:

1. `Retrieval input`: original question or expanded query when a later query-expansion stage is enabled.
2. `Query embedding`: generated only when semantic retrieval is enabled and an embedding model is configured.
3. `Lexical page seeds`: weighted lexical seed selection over page records, bounded by `seedTopK`.
4. `Description-vector page seeds`: semantic search over page descriptions, also bounded by `seedTopK`.
5. `Direct chunk-vector candidates`: semantic search over chunk vectors for candidate recall.
6. `Seed page union`: merge lexical and description-vector page seeds with deterministic de-duplication.
7. `Graph BFS`: expand from seed pages using `graphDepth` and `bfsTopK`.
8. `Graph-local page scoring`: rerank graph pages with lexical score, page-description vector score, graph distance, and existing boilerplate demotion.
9. `Chunk scoring`: score chunks from selected graph pages with lexical chunk score, chunk-vector score, inherited page score, and existing boilerplate demotion.
10. `Candidate union`: merge graph-derived chunks and direct chunk-vector candidates, then bound to `rerankerTopN`.
11. `Reranker`: when enabled and configured, score `(query, candidate text)` pairs using the selected reranker model.
12. `Context selection`: send `contextTopN` chunks to the answer LLM, ordered by reranker score when reranker succeeds or by pre-rerank score when it falls back.

## Settings Design

Add a `Reranker` block in the native-agent settings area near `Semantic Search` and `Retrieval`.

New settings under `nativeAgent`:

- `rerankerEnabled?: boolean`
  - Default: `false` until no-regression eval evidence and explicit default-on approval exist.
  - DoD: missing legacy settings behave as disabled.
- `rerankerModel?: string`
  - Default: empty string.
  - DoD: the UI allows free text and model picker reuse, but does not recommend one concrete model.
- `rerankerTopN?: number`
  - Default: `30`.
  - Valid range: integer `1..100`.
  - DoD: controls the candidate pool sent to the reranker.
- `contextTopN?: number`
  - Default: `8`.
  - Valid range: integer `1..50`.
  - DoD: controls final chunks sent to the answer LLM.
- `rerankerTimeoutMs?: number`
  - Default: `800`.
  - Valid range: integer `100..5000`.
  - DoD: timeout triggers fallback to pre-rerank order.

Existing settings receive updated defaults or descriptions:

- `seedTopK`
  - Default for this profile: `8`.
  - DoD: description says it controls lexical and page-description vector seed pages.
- `graphDepth`
  - Default: `1`.
  - DoD: description remains graph expansion depth from seed pages.
- `bfsTopK`
  - Default for this profile: `25`.
  - DoD: description says it caps graph-expanded pages before graph-local scoring.

The Reranker block must include a short flow explanation:

```text
seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN
```

Validation rules:

- `rerankerTopN >= contextTopN`.
- Invalid values are normalized before runtime use, and the UI edit path shows a settings notice when it corrects or rejects an invalid value.
- Runtime also normalizes settings so hand-edited config cannot break Query.

## Reranker Adapter

Create a small pure adapter module, for example `src/reranker.ts`.

Responsibilities:

- Normalize reranker config.
- Build bounded `(id, text, metadata)` candidates.
- Call the configured reranker endpoint with timeout and abort support.
- Return ranked candidate ids with scores.
- Return a typed fallback reason on disabled, missing model, unsupported endpoint, timeout, malformed response, or thrown error.

The first implementation reuses native-agent `baseUrl` and API key unless a later design adds separate reranker endpoint settings. The UI must make the reranker model visible before runtime uses it.

The adapter must not depend on Obsidian UI classes. HTTP code can follow the existing embedding fetch pattern, but candidate normalization and fallback behavior must stay unit-testable.

## Query Integration

Single-domain Query:

- Replace implicit `chunkLimit = seedTopK * 3` with explicit `rerankerTopN` and `contextTopN`.
- Keep `retrieveDomainCandidates` as the first candidate gather stage.
- Apply graph-local page scoring before chunk collection when graph candidates exist.
- Apply chunk scoring before the reranker pool is truncated.
- Run reranker after candidate union and before `renderContextChunks`.
- Record diagnostics for reranker enabled/disabled, candidates scored, timeout/fallback reason, and duration.

Cross-domain Query:

- Replace `cfg.seedTopK * 3` with explicit `rerankerTopN` and `contextTopN`.
- Merge per-domain candidate pools before final reranker selection.
- Keep domain collision-safe ids and existing WikiLink validation semantics.
- Apply the same timeout and fallback behavior as single-domain Query.

Fallback behavior:

- Disabled reranker: current pre-rerank ordering.
- Missing model: current pre-rerank ordering.
- Timeout or endpoint error: current pre-rerank ordering.
- Malformed scores: current pre-rerank ordering.
- Abort signal: exit without emitting post-abort stats or answer events.

## Follow-Up Quality Stages

Query expansion:

- Later stage, separate toggle.
- Runs before candidate gathering.
- Must preserve original query and add bounded domain synonyms or terms.
- Must fall back to original query on error or timeout.

Answer-grounding and citation gate:

- Later stage, separate toggle.
- Runs after answer generation against selected context chunks.
- Must not cite pages outside selected context.
- Weak or unsupported claim handling is defined by the later grounding spec.

Dedup and merge hygiene:

- Existing graph health and dedup settings remain separate from runtime reranker.
- Near-duplicate lint and merge hygiene improve corpus quality before retrieval.
- No automatic merge behavior changes in this reranker slice.

## Eval And No-Regression Gate

The first implementation plan must run the same HLD no-regression gate used for accepted runtime retrieval changes.

Required evidence:

- `Recall@5` does not fall below baseline.
- `nDCG@5` improves or does not regress.
- Aggregate `MRR >= 0.90`.
- No per-query legacy-overlap floor regresses.
- p95 Query latency target regression is at most `+500 ms`.
- p95 Query latency regression above `+1 sec` is a stop condition.
- Reranker fallback cases do not fail Query.

The eval profile must exercise:

- `seedTopK = 8`
- `graphDepth = 1`
- `bfsTopK = 25`
- `rerankerTopN = 30`
- `contextTopN = 8`
- `rerankerTimeoutMs = 800`

The eval must not change gold labels or no-regression floors.

## Acceptance Criteria

1. Settings expose a separate Reranker block.
   - DoD: toggle, model, `rerankerTopN`, `contextTopN`, and timeout are visible in native settings.
2. Settings explain top-K flow.
   - DoD: UI text includes `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
3. Settings validate candidate and context limits.
   - DoD: `rerankerTopN < contextTopN` is corrected or rejected before saving and before runtime use.
4. Runtime uses explicit limits.
   - DoD: Query and cross-domain Query no longer use `seedTopK * 3` as the chunk/context candidate limit.
5. Runtime reranker is bounded and optional.
   - DoD: reranker receives at most `rerankerTopN` candidates and final context contains at most `contextTopN` chunks.
6. Runtime fallback is deterministic.
   - DoD: disabled, missing model, timeout, endpoint error, and malformed response all preserve pre-rerank behavior.
7. No concrete model is recommended in settings.
   - DoD: settings text does not name `BAAI/bge-reranker-v2-m3` or another model as recommended.
8. Wiki and repository docs describe the pipeline.
   - DoD: docs and iwiki record graph-local scoring and the deferred `graphChunkTopN` decision.

## Risks And Mitigations

- Latency risk: cross-encoder reranking can add request time.
  - Mitigation: bound candidates with `rerankerTopN`, enforce `rerankerTimeoutMs`, and record duration diagnostics.
- Endpoint compatibility risk: reranker APIs are less standardized than chat and embeddings APIs.
  - Mitigation: keep adapter isolated and fallback on unsupported response shape.
- Recall loss risk: strict filters can remove good candidates.
  - Mitigation: keep lexical, description-vector, and chunk-vector retrieval as recall inputs, not hard filters.
- Settings drift risk: existing `seedTopK`, `graphDepth`, and `bfsTopK` live in different UI sections.
  - Mitigation: add concise Reranker block explanation and update existing descriptions to match the same flow.
- Graph noise risk: graph chunks can be too broad.
  - Mitigation: graph-local page scoring and chunk scoring run before reranker; `graphChunkTopN` is deferred until eval evidence shows it is needed.

## Out Of Scope

- Recommending a specific reranker model in settings.
- Promoting BM25 or BM25/RRF into runtime Query.
- Changing `index.jsonl` schema.
- Changing gold labels or no-regression floors.
- Enabling query expansion, answer-grounding, or dedup/merge automation by default in this slice.
- Adding `graphChunkTopN` before eval evidence shows a need.
