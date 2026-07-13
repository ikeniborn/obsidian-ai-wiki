---
review:
  spec_hash: 5862de0d58ca2b96
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-12-reranker-integration-eval-intent.md
---
# Reranker Integration Eval - Design

Date: 2026-07-12
Status: approved
Intent: `docs/superpowers/intents/2026-07-12-reranker-integration-eval-intent.md`

## Acceptance From Intent

- The integration eval can be run with one command against `baseUrl + /rerank`.
- The report shows baseline order, reranked order, `Recall@5`, `nDCG@5`, `MRR`, per-query floors, and p95 latency.
- If `/rerank` is unavailable or the model is missing, the eval is explicitly blocked or failed instead of silently passing.
- Gold labels and no-regression floors remain unchanged.
- The report gives a clear decision on whether the selected reranker model can be used for runtime reranking.
- The current plugin runtime pipeline and default behavior must not be broken.

## Non-Regression Boundary

This slice is an eval-only integration gate. It must not change runtime Query semantics, runtime defaults, settings persistence, or the already accepted candidate-selection pipeline unless a focused review finds a concrete bug that blocks the eval.

Runtime files that must remain behavior-compatible:

- `src/reranker.ts`
- `src/agent-runner.ts`
- `src/phases/query.ts`
- `src/phases/query-cross-domain.ts`
- `src/settings.ts`
- `src/types.ts`

Required recheck before result:

- Existing reranker unit tests still pass.
- `npm run lint` and `npm run build` still pass.
- Old hidden limit patterns (`seedTopK * 3`, `topK * 3`, `chunkLimit`) remain absent from Query paths.
- The existing HLD retrieval eval remains accepted.
- The new integration eval is additive and does not make `/rerank` required for normal plugin use.

## Approach

Create a separate Node-side integration eval script instead of extending runtime Query or replacing the existing offline HLD eval.

Chosen approach:

- Add `scripts/eval-reranker-integration.ts`.
- Keep `scripts/eval-jsonl-domain-storage.ts` as the offline retrieval/no-regression harness.
- Reuse the HLD gold set and HLD query themes.
- Build the same isolated eval domain shape as the existing HLD harness.
- Build an eval candidate pool that follows the fixed runtime order:
  `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- Call the real `/rerank` endpoint for the bounded candidate chunks.
- Score baseline candidate order and reranked order against the same gold labels.
- Render a separate markdown report with quality, latency, endpoint/model, and verdict.

Rejected approach:

- Do not make normal plugin Query depend on the integration eval.
- Do not enable reranker by default.
- Do not add a separate runtime reranker endpoint setting in this slice.
- Do not mutate gold labels, legacy floors, or accepted retrieval thresholds.

## CLI Contract

The command should be copy-pasteable and explicit:

```bash
npx tsx scripts/eval-reranker-integration.ts --source "<HLD path>" --out docs/superpowers/evals/reranker-integration-hld-eval.md --base-url "http://localhost:11434/v1" --model "<reranker-model>"
```

Required inputs:

- `--source <path>`: HLD source directory.
- `--out <path>`: markdown report path.
- `--base-url <url>` or `RERANK_BASE_URL`.
- `--model <model>` or `RERANK_MODEL`.

Optional inputs:

- `--endpoint-path <path>` or `RERANK_ENDPOINT_PATH`, default `/rerank`; Lemonade 10.8.1 uses `/v1/reranking`.
- `--api-key <key>` or `RERANK_API_KEY`.
- `--gold <path>`, default `docs/superpowers/evals/hld-gold-set.json`.
- `--eval-root <path>`, default sibling hidden eval root.
- `--reranker-top-n <int>`, default `30`.
- `--context-top-n <int>`, default `8`.
- `--timeout-ms <int>`, default `800`.

Invalid or missing required endpoint/model input must produce a non-accepted blocked result. It must not silently fall back to baseline and print `accepted`.

## Candidate Pipeline

The integration eval approximates the runtime retrieval sequence on the isolated HLD eval domain while staying Node-only:

1. Build page and chunk records from HLD markdown, matching the existing eval domain shape.
2. For each fixed HLD query, compute weighted lexical page candidates and weighted lexical chunk candidates using the same HLD gold/eval token expansion already used by the offline harness.
3. Apply the accepted boilerplate demotion factor `0.15` to page/candidate ordering.
4. Create a bounded chunk candidate pool of at most `rerankerTopN`.
5. Send only bounded candidate text to the configured rerank endpoint.
6. Map reranker response indexes back to stable candidate IDs.
7. Select final context candidates with `contextTopN`.
8. Score both pre-rerank and post-rerank orders against unchanged gold labels.

The first integration eval does not add `graphChunkTopN`. If graph-derived chunks are noisy or too narrow, a later spec may add that setting explicitly.

## Rerank Endpoint Contract

Request:

```json
{
  "model": "<model>",
  "query": "<question>",
  "documents": ["<candidate text>"]
}
```

Accepted response forms:

```json
{ "results": [{ "index": 0, "relevance_score": 0.98 }] }
```

```json
{ "results": [{ "index": 0, "score": 0.98 }] }
```

Malformed JSON, missing `results`, invalid indexes, non-finite scores, timeout, or HTTP errors must produce a blocked or failed integration eval verdict with a clear reason.

The script must count real endpoint calls. A run with zero successful `/rerank` calls cannot be accepted.

## Metrics And Verdict

Per query:

- baseline top candidates before rerank;
- reranked top candidates after `/rerank`;
- `Recall@5`, `nDCG@5`, `MRR`;
- `LegacyOverlap@5` or the existing per-query floor comparison;
- endpoint latency in ms;
- number of candidates sent to `/rerank`;
- verdict reason when blocked or rejected.

Aggregate:

- average baseline metrics;
- average reranked metrics;
- metric deltas;
- p95 reranker latency;
- p95 latency regression versus baseline candidate scoring;
- total `/rerank` calls;
- final verdict: `accepted`, `needs_tuning`, `blocked`, or `rejected`.

Acceptance rules:

- accepted only when endpoint/model inputs are present;
- accepted only when at least one real `/rerank` call succeeds for every query with candidates;
- accepted only when aggregate `MRR >= 0.90`;
- accepted only when `Recall@5` and `nDCG@5` do not regress versus baseline;
- accepted only when no per-query floor regresses;
- blocked when endpoint/model is unavailable, malformed, or no real rerank calls succeed;
- rejected when p95 latency regression is at or above `+1 sec`;
- needs_tuning when quality is close but fails non-hard thresholds.

## Report

Write a markdown report, defaulting to:

`docs/superpowers/evals/reranker-integration-hld-eval.md`

The report must include:

- source path, eval root, endpoint base URL with secrets omitted, model, top-N settings, timeout;
- final verdict;
- aggregate baseline metrics;
- aggregate reranked metrics;
- deltas;
- p95 latency;
- per-query baseline and reranked top lists with gold grades;
- endpoint call counts and blocked/rejected reasons;
- explicit note that this is model-on integration evidence and does not alter plugin runtime defaults.

The report must not print API keys.

Runtime reranker candidates are capped before adapter calls so local reranker backends with small physical batch limits do not crash on long wiki chunks. This does not enable reranking by default; it only bounds text sent when reranking is explicitly enabled.

## Tests

Add deterministic Node tests with a mock local `/rerank` endpoint.

Required test coverage:

- the script calls `/rerank` with `{ model, query, documents }`;
- the mock response changes ranking and the report records reranked order;
- missing model or endpoint produces blocked/non-accepted result;
- malformed response produces blocked/non-accepted result;
- configured `rerankerTopN` bounds documents sent to the endpoint;
- configured `contextTopN` bounds final scored output.

Existing tests that must still pass:

- `node --import tsx --test tests/reranker.test.ts`
- the focused integration eval test file;
- existing HLD eval tests if touched.

## Documentation

Update iwiki `jsonl-domain-storage`, heading `Eval`, to distinguish:

- offline HLD retrieval gate;
- default-off runtime reranker slice;
- real `/rerank` model-on integration eval.

Repository docs and reports must state that accepted integration evidence is model-specific and does not automatically enable reranker by default.

## Implementation Recheck

After implementation, re-read and verify these runtime surfaces:

- `src/reranker.ts`: adapter fallback semantics and response parsing remain compatible with the integration eval endpoint contract.
- `src/phases/query.ts`: single-domain Query still calls reranker after chunk selection and before context rendering.
- `src/phases/query-cross-domain.ts`: cross-domain Query still merges candidates before rerank.
- `src/settings.ts`: no concrete model recommendation is introduced.
- `src/types.ts`: runtime defaults remain default-off.

The result gate must treat any runtime behavior drift as a blocking issue unless the intent/spec/plan are explicitly updated first.
