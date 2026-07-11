---
review:
  spec_hash: c9b1b3540043f2ab
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-gold-bm25-eval-harness-intent.md
---
# Gold Set BM25 Eval Harness — Design

Date: 2026-07-11
Status: approved
Intent: `docs/superpowers/intents/2026-07-11-gold-bm25-eval-harness-intent.md`

## Acceptance (from intent)

### Desired Outcomes

- A checked gold set exists for the five HLD eval queries, with relevant page
  ids/paths and short rationale per query.
- The eval harness can compare at least these variants:
  - current weighted lexical retrieval;
  - BM25 page retrieval;
  - BM25 chunk retrieval;
  - RRF fusions of weighted lexical, BM25 page, BM25 chunk, and legacy broad rank.
- The report shows per-query and aggregate `Recall@5`, `nDCG@5`, `MRR`, legacy
  `Overlap@5`, and variant deltas.
- The accepted variant improves gold metrics over current weighted lexical
  retrieval without dropping any existing legacy-overlap floor.
- The harness remains deterministic, offline, and does not mutate the Rostelecom
  HLD source vault.

### Health Metrics

- No per-query legacy `Overlap@5` regression below current accepted floors:
  `0.40`, `1.00`, `0.40`, `0.60`, `0.20`.
- Current weighted lexical retrieval remains available as a baseline variant.
- Runtime Query behavior does not change unless a later approved step explicitly
  promotes a variant from eval to runtime.
- HLD eval stays offline: no LLM, embeddings, network, OpenAI, Ollama, or source
  vault mutation.
- Focused tests, lint, build, and `wiki_lint(obsidian-ai-wiki)` pass.

## Approach Options

### Option A — Gold labels + A/B harness inside existing HLD eval (chosen)

Keep `scripts/eval-jsonl-domain-storage.ts` as the orchestration entry point, add
a repo-owned gold set, and evaluate retrieval variants after the isolated JSONL
domain is built. This is the smallest effective step because it reuses existing
source loading, JSONL build, query definitions, report path, and no-regression
legacy-overlap gate.

Trade-off: the eval script grows and should be split with small pure helper modules
when implementation starts.

### Option B — Separate standalone eval command

Create a new command dedicated to BM25/gold-set experiments. This isolates the
experiment but duplicates domain build and report logic, and makes it easier for
JSONL storage eval and retrieval-quality eval to drift.

### Option C — Promote BM25 to runtime immediately

Implement BM25 in runtime Query and then evaluate. This is premature: the intent
explicitly says this step is eval-only and runtime promotion needs later approval.

## Decisions

1. **Gold metrics are primary for quality.** Legacy `Overlap@5` remains a
   no-regression guard, not the main optimization target.
2. **No runtime behavior change.** BM25 and A/B variants live in eval-only code
   until a later checked step promotes a variant.
3. **BM25 is pure and deterministic.** Use a local implementation with fixed
   parameters (`k1 = 1.2`, `b = 0.75`) and the existing lexical tokenizer.
4. **Gold labels are repo artifacts.** Store query labels in a small JSON file
   under `docs/superpowers/evals/`, keyed by query id and eval vault path.
5. **A/B variants share one report.** One HLD report lists all variants, metrics,
   and the accepted best variant.

## Gold Set

Create `docs/superpowers/evals/hld-gold-set.json`:

```json
{
  "version": 1,
  "source": "Rostelecom HLD",
  "queries": {
    "data-export-s3-clickhouse": {
      "relevant": [
        {
          "path": "!Wiki/hld-jsonl-eval/pages/экспорт-витрин-из-гп-в-кх-через-s3.md",
          "grade": 3,
          "rationale": "Primary HLD for export through S3 and ClickHouse."
        }
      ]
    }
  }
}
```

Rules:

- `path` uses the deterministic eval vault path produced by `slugify`.
- `grade` is integer relevance: `3 = primary`, `2 = directly relevant`,
  `1 = supporting/context`, `0` omitted.
- Each of the five fixed queries must have at least five relevant labels when the
  source corpus supports it. If fewer exist, the rationale must state why.
- Gold labels are manually curated and reviewable; no LLM/model labels.

Initial labels should be conservative and based on the already observed eval
outputs plus the HLD page titles. They are allowed to include pages that legacy
overlap currently misses when the page title/path is clearly semantically relevant.

## BM25 Module

Create `src/bm25.ts` as a pure Obsidian-free helper:

- `tokenize` is passed in by caller or imported from `src/lexical-retrieval.ts`.
- `buildBm25Index(documents)` computes document length, average length, document
  frequency, and stores token frequencies.
- `rankBm25(queryTokens, index, limit)` scores documents with:

```ts
idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen)));
```

- Sorting is deterministic: score descending, then id/path ascending.
- Empty query or empty corpus returns empty ranks.
- No file IO, network, Obsidian imports, or runtime settings.

Documents:

- Page BM25 document: `path + title + description`.
- Chunk BM25 document: `path + heading + body/embedText`.

## Eval Variants

Add a small variant model inside the harness:

```ts
type RetrievalVariantId =
  | "weighted-lexical"
  | "bm25-page"
  | "bm25-chunk"
  | "rrf-weighted-bm25"
  | "rrf-weighted-bm25-legacy";
```

For each query:

- `weighted-lexical`: current accepted `jsonlTop` behavior remains baseline.
- `bm25-page`: page BM25 top paths.
- `bm25-chunk`: unique page paths from chunk BM25 top chunks.
- `rrf-weighted-bm25`: RRF over weighted page/chunk ranks plus BM25 page/chunk.
- `rrf-weighted-bm25-legacy`: same as above plus legacy broad rank as a guarded
  no-regression source.

The harness chooses an accepted best variant by:

1. discard variants that drop any legacy-overlap floor for that query;
2. rank remaining variants by aggregate `nDCG@5`, then `Recall@5`, then `MRR`;
3. require the best variant to be at least as good as `weighted-lexical` on every
   aggregate gold metric and better on at least one of `nDCG@5`, `Recall@5`, or
   `MRR`.

If no variant beats current weighted lexical without legacy regression, verdict is
`needs_tuning`, not `accepted`.

## Metrics

For each query and variant:

- `Recall@5`: relevant labels present in top 5 divided by number of relevant labels,
  capped by 5 for fairness when a query has more than five labels.
- `nDCG@5`: graded relevance using `grade` values.
- `MRR`: reciprocal rank of first relevant result.
- `LegacyOverlap@5`: current overlap against legacy baseline floors.

Aggregate metrics are macro averages across the five fixed HLD queries.

The report includes:

- current weighted lexical metrics;
- each BM25/RRF variant metrics;
- best accepted variant;
- per-query top 5 results with gold grades;
- legacy floor pass/fail;
- a short rationale when a variant improves gold metrics but is rejected by
  legacy no-regression.

## Error Handling

- Missing gold-set file fails the eval command with a clear message.
- Gold labels for unknown query ids fail validation.
- Gold paths absent from the built eval domain fail validation because labels would
  not be comparable.
- Duplicate labels in one query fail validation.
- Empty relevant labels fail validation.
- BM25 with empty corpus returns empty ranks, causing `needs_tuning`, not crash.
- Missing HLD source path keeps the existing clear failure before partial output.

## Testing

Add focused tests for:

- BM25 ranks a document with repeated exact query terms above a generic document.
- BM25 length normalization prevents a long template from dominating.
- Empty query/corpus returns empty ranks.
- Gold-set parser rejects unknown query ids, missing paths, duplicate labels, and
  empty relevant lists.
- Metrics compute expected `Recall@5`, `nDCG@5`, and `MRR` on a tiny fixture.
- Eval report includes variant table, gold metrics, legacy floors, and best variant.
- Synthetic HLD eval remains accepted with the gold set fixture.

Verification commands:

- focused node tests for BM25, eval harness, lexical retrieval, and JSONL index;
- live HLD eval CLI against the Rostelecom HLD source;
- `npm run lint`;
- `npm run build`;
- `wiki_lint(domain=obsidian-ai-wiki)` after docs/wiki updates.

## Documentation

Update:

- `docs/rag-quality-recommendations.md`: document gold metrics and BM25/RRF A/B
  harness as the quality path beyond legacy overlap.
- iwiki `jsonl-domain-storage` Eval section: record the final best variant and
  aggregate gold metrics after implementation.
- final chain result report.

## Out of Scope

- Runtime Query behavior changes.
- Settings UI changes.
- Dense embeddings, vector storage, or `index.jsonl` schema changes.
- LLM/model-generated relevance labels.
- Mutating the Rostelecom HLD source vault.
