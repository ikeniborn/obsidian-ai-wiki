---
review:
  spec_hash: 054570c09ee335ca
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-bm25-template-demotion-intent.md
---
# Runtime Boilerplate Demotion — Design

Date: 2026-07-11
Status: approved
Intent: `docs/superpowers/intents/2026-07-11-bm25-template-demotion-intent.md`

## Acceptance (from intent)

### Desired Outcomes

- Live HLD eval shows gold quality improvement over current `weighted-lexical`: `nDCG@5 > 0.91` or `Recall@5 > 0.76`.
- Average improved `Overlap@5` remains at least `0.65`.
- No query drops below its current legacy-overlap floor.
- `MRR` remains at least `0.90`.
- Top-1 result is never `template-*` or `template-readme`.
- The report explains where BM25 helps, where BM25 hurts, and where controlled demotion changes ranking.
- Runtime Query behavior does not change until eval confirms a safe effective value.

### Health Metrics

- Per-query legacy floors from the current harness do not regress.
- Average improved `Overlap@5 >= 0.65`.
- Aggregate `MRR >= 0.90`.
- No top-1 boilerplate/template result.
- Runtime Query behavior remains unchanged until this follow-up enables the verified runtime setting.
- Eval remains deterministic and offline.

### Done When

Live HLD eval shows gold improvement over current `weighted-lexical` (`nDCG@5 > 0.91` or `Recall@5 > 0.76`), average `Overlap@5 >= 0.65`, aggregate `MRR >= 0.90`, no top-1 boilerplate/template result, no per-query floor regression, and the report explains BM25 plus demotion deltas.

## User Decisions

1. Runtime Query enables boilerplate demotion by default.
2. The default demotion factor is `0.15`, matching the winning eval variant.
3. Runtime applies demotion as a final rank-level demotion pass only.
4. BM25 raw scoring and BM25/RRF variants do not move into runtime Query in this change.

## Requirements

1. Add a runtime-safe boilerplate demotion helper that detects only generated HLD boilerplate paths.
   - DoD: `template-readme` and `template-hld-*` are detected; pages merely containing the word `template` are not detected.
2. Add default-enabled advanced settings for boilerplate demotion.
   - DoD: missing legacy settings resolve to `boilerplateDemotionEnabled = true` and `boilerplateDemotionFactor = 0.15`.
3. Apply rank-level demotion after weighted lexical and fusion ranking.
   - DoD: final top-K ranking demotes detected boilerplate pages using the configured factor without changing the relative order of non-boilerplate pages.
4. Thread the demotion config through single-domain and cross-domain runtime Query.
   - DoD: `runQuery` and `runCrossDomainQuery` use the same demotion config from plugin settings.
5. Keep the HLD eval rank-only winning variant as the runtime-equivalent gate.
   - DoD: the live HLD eval report includes `weighted-lexical-demoted` with factor `0.15` and passes all no-regression gates.
6. Update docs and iwiki to document the runtime setting and the reason BM25 remains eval-only.
   - DoD: repository docs and iwiki `jsonl-domain-storage` describe default-enabled boilerplate demotion, factor `0.15`, and BM25 non-promotion.

## Architecture

Create `src/boilerplate-demotion.ts` as an Obsidian-free pure module. It exports:

- `DEFAULT_BOILERPLATE_DEMOTION_FACTOR = 0.15`;
- `isBoilerplatePath(path: string): boolean`;
- `normalizeBoilerplateDemotionConfig(input): BoilerplateDemotionConfig`;
- `demoteBoilerplateRankedItems(items, config, limit)`.

The detector is intentionally narrow. It matches a lowercase markdown basename equal to `template-readme` or starting with `template-hld-`. It does not demote arbitrary pages, sections, or chunks because their text mentions templates.

The runtime rank-level pass is applied after weighted lexical and fusion ranking, before final top-K truncation. The pass uses the same detector and factor as the eval winner, and it preserves deterministic tie-breaking and the relative order of non-boilerplate candidates. The lexical score itself remains unchanged; this avoids the observed conflict where score-level demotion removes a gold-0 template from top-5 but also violates the legacy-overlap no-regression floor.

## Settings

Extend `LlmWikiPluginSettings["nativeAgent"]` with:

- `boilerplateDemotionEnabled?: boolean`;
- `boilerplateDemotionFactor?: number`.

`DEFAULT_SETTINGS.nativeAgent` sets `boilerplateDemotionEnabled: true` and `boilerplateDemotionFactor: 0.15`. The effective config treats missing legacy values as enabled with factor `0.15`. Non-finite values resolve to `0.15`; finite values clamp to `[0, 1]`.

Settings UI adds the controls under the existing `Retrieval` section:

- toggle: `Boilerplate demotion`;
- numeric or slider factor control with range `0..1` and default `0.15`.

The UI description must state that this demotes only generated HLD template/readme pages and does not enable BM25.

## Runtime Data Flow

Single-domain Query:

1. `AgentRunner` reads `settings.nativeAgent.boilerplateDemotionEnabled` and `settings.nativeAgent.boilerplateDemotionFactor`.
2. `runQuery` receives the normalized config.
3. Seed/page scoring keeps the existing weighted lexical score.
4. Chunk ranking keeps the existing weighted lexical score.
5. Final page/chunk/fusion ranking applies rank-level demotion before top-K output.

Cross-domain Query follows the same config path from `AgentRunner` into `runCrossDomainQuery`, so `*` queries do not drift from single-domain behavior.

Embedding vectors, dense similarity computation, vector dimensions, and `index.jsonl` schema do not change. Hybrid mode can change only through its sparse lexical side.

## Eval Gate

The HLD harness keeps the existing `weighted-lexical-demoted` rank-only variant with factor `0.15`. This variant executes the same rank-level helper and config semantics used by runtime Query.

The implementation passes only when the live HLD eval shows:

- average improved `Overlap@5 >= 0.65`;
- no query below its current legacy-overlap floor;
- aggregate `MRR >= 0.90`;
- no top-1 `template-*` or `template-readme`;
- `nDCG@5 > 0.91` or `Recall@5 > 0.76`;
- report text still shows raw BM25 and RRF as eval-only comparisons, not runtime behavior.

If the rank-only runtime-equivalent variant regresses against those guards, the result must not pass. The implementation must return to design or plan review instead of weakening floors.

## Error Handling

- Empty query tokens keep existing empty-ranking behavior.
- Missing paths are treated as non-boilerplate.
- Disabled demotion leaves rank order unchanged except for existing deterministic tie-breakers.
- Factor `0` is equivalent to no rank penalty.
- Factor `1` is the strongest allowed demotion and remains deterministic.
- The demotion helpers perform no filesystem reads and no network calls.

## Testing

Add focused tests for:

- `isBoilerplatePath` narrow matching.
- `normalizeBoilerplateDemotionConfig` defaults, invalid values, and clamping.
- rank-level demotion with stable non-boilerplate ordering.
- settings defaults and UI persistence.
- single-domain and cross-domain Query config threading.
- HLD eval report includes `weighted-lexical-demoted` factor `0.15`.

Verification commands:

- `node --import tsx --test tests/lexical-retrieval.test.ts tests/eval-jsonl-domain-storage.test.ts tests/page-similarity-jsonl.test.ts`
- `npm run lint`
- `npm run build`
- live HLD eval CLI against the Rostelecom HLD source
- `wiki_lint(domain="obsidian-ai-wiki")`

## Documentation

Update `docs/rag-quality-recommendations.md` with the runtime promotion result: default-enabled rank-only boilerplate demotion, factor `0.15`, and BM25 staying eval-only.

Update iwiki `jsonl-domain-storage`, heading `Retrieval` or `Eval`, with the same runtime setting and no-regression evidence after implementation.

## Out of Scope

- Promoting raw BM25, BM25 chunk/page rankers, or BM25/RRF variants into runtime Query.
- Changing dense embedding computation.
- Changing `index.jsonl`, `metadata.jsonl`, or vector schemas.
- Changing HLD gold labels or legacy-overlap floors.
- Broad template detection beyond `template-readme` and `template-hld-*`.
