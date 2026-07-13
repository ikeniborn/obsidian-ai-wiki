---
review:
  spec_hash: 8bbde6da1954a757
  last_run: 2026-07-13
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-13-guarded-rerank-tuning-intent.md
---
# Guarded Rerank Tuning - Design

Date: 2026-07-13
Status: approved
Intent: `docs/superpowers/intents/2026-07-13-guarded-rerank-tuning-intent.md`

## Acceptance From Intent

- Runtime reranking, when explicitly enabled, uses the accepted baseline ordering as a backbone instead of fully replacing it.
- Candidate text sent to the reranker contains enough page and chunk context to make reranker scores more reliable.
- The integration eval can compare full rerank with guarded rerank variants and identify the best no-regression variant.
- The plugin keeps existing Query behavior when reranker is disabled, misconfigured, slow, malformed, or unavailable.
- The latest eval report clearly states whether the guarded rerank variant is accepted, needs tuning, blocked, or rejected.

## Current Evidence

The real LiteLLM route `https://litellm.ikeniborn.ru/v1/rerank` accepts the model `lemonade-reranker-bge-reranker-v2-m3` and returns valid rerank scores. The default full-rerank integration run is fast enough, with p95 latency regression under the `+500 ms` target, but quality regresses versus the pre-rerank baseline.

Observed failure mode: full rerank can promote noisy graph chunks or low-grade pages above strong baseline candidates. A first guarded chunk-level promotion also regressed recall. This means the endpoint is usable, but full replacement ordering and unconstrained chunk promotion are too risky for runtime Query.

## Chosen Approach

Use guarded rerank over baseline order and improve candidate text.

Runtime behavior changes only when reranker is explicitly enabled and a model is configured. The baseline candidate order remains the backbone. Reranker scores are normalized and blended as a bounded boost:

```text
baselineRankScore = 1 / (baselineRank + 1)
normalizedRerankerScore = (score - minScore) / (maxScore - minScore)
finalScore = baselineRankScore + alpha * normalizedRerankerScore
maxPromotion = maximum positions a candidate may move upward
```

The accepted runtime constants are selected from the eval sweep. Current real LiteLLM evidence accepts a page-aware guarded promotion variant:

- `promotionScope = page`
- `alpha = 0.60`
- `maxPromotion = 1`
- `minPromotionScoreGap = 0.20`
- `minPromotionBaselineRatio = 0.95`
- `maxPromotionTargetIndex = 2` (0-based top-3 target window)
- `candidateTextChars = 120`

Equal final scores keep baseline order. Missing reranker scores keep only their baseline rank score. Page-aware mode groups chunks by `articleId`, ranks pages, applies the promotion gates, then emits chunks in page-order round-robin so duplicate chunks from one page do not crowd out other pages.

The previous full-rerank behavior remains available only inside the integration eval as a control variant, not as runtime default behavior.

## Candidate Text

Candidate text should be structured and query-aware:

```text
Title: <file basename without .md>
Path: <wiki path>
Heading: <chunk heading>
Text: <query-aware excerpt>
```

The excerpt is selected from chunk body around the first query-token match. If there is no match, the excerpt uses the beginning of the chunk body. Whitespace is collapsed before truncation. The cap is a fixed code default selected from eval evidence. The current accepted cap is `120` characters; `240` and `480` were too slow or unstable for the current endpoint and timeout.

This makes the reranker see the page identity and local evidence instead of only a heading plus the first few body characters.

## Runtime Boundaries

Unchanged:

- Reranker remains disabled by default.
- `rerankerModel` remains user-configured and empty by default.
- The top-K flow remains `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`.
- `rerankerTopN >= contextTopN` validation remains required.
- Timeout, malformed response, request error, missing model, disabled config, and empty candidates still fall back to pre-rerank order.
- No new UI settings for alpha or candidate text cap in this slice.
- No `graphChunkTopN` in this slice.

Changed:

- `buildRerankerCandidates` receives the query so candidate text can be query-aware.
- `rerankChunks` uses page-aware guarded score blending instead of full score sorting when reranker is enabled.
- Runtime default can promote a page by at most one position, but only into the top-3 target window and only when reranker confidence plus baseline evidence gates pass.
- Eval reporting can compare multiple variants in one run, including full rerank, chunk guarded alpha, promotion-cap variants, and page-aware confidence-gated variants.

## Eval Variants

The integration eval must keep the existing baseline and add model-on variants:

- `full-rerank`: previous full score sort, used as a control.
- `guarded-alpha-0.05-cap-0`: accepted no-regression runtime-safe variant.
- `guarded-alpha-0.05-cap-1`: one-position promotion attempt.
- `guarded-alpha-0.10-cap-1`, `guarded-alpha-0.15-cap-1`, `guarded-alpha-0.25-cap-1`, `guarded-alpha-0.35-cap-1`: stronger boost attempts.
- `guarded-alpha-0.10-cap-2`: wider promotion attempt.
- `page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3`: accepted runtime variant.
- Additional page-aware variants without baseline ratio or top-3 target remain controls and currently need tuning.

The accepted runtime constants come from the best accepted guarded variant. Reranker remains explicitly opt-in.

## Acceptance Criteria

1. Guarded score blending is unit-tested.
   - DoD: a high reranker score cannot arbitrarily jump from a low baseline rank to the top unless the blended final score beats earlier candidates.
2. Candidate text is structured and query-aware.
   - DoD: tests verify title/path/heading fields, query-match excerpt, fallback excerpt, and cap.
3. Fallback behavior is unchanged.
   - DoD: disabled, missing model, timeout, errors, and malformed responses still preserve baseline order and `contextTopN`.
4. Integration eval reports variants.
   - DoD: markdown report includes baseline metrics, per-variant aggregate metrics, per-query top lists, latency, and verdict.
5. Real LiteLLM eval evidence is refreshed.
   - DoD: report records successful `/v1/rerank` calls and final verdict without exposing secrets.
6. Documentation is current.
   - DoD: iWiki `jsonl-domain-storage` describes guarded rerank behavior and latest eval evidence, and `wiki_lint` has no new broken/stale pages.

## Risks

- The accepted improvement is measured on a small HLD gold set; it is a gate, not universal proof.
- Page-aware top-3 promotion may miss useful lower-rank improvements by design.
- A larger text cap may improve reranker judgment but increase latency or backend instability.
- Query-aware excerpts based on lexical token matches may miss semantic evidence when terms differ.

## Out Of Scope

- Query expansion.
- Answer-grounding/citation gate.
- Corpus dedup/merge automation.
- New reranker endpoint settings.
- Default-on reranker behavior.
- Model recommendation text in settings.
