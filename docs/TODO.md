# Task Log

| Topic | Status | Intent | Spec | Plan | Result | Opened | Closed | Notes |
|-------|--------|--------|------|------|--------|--------|--------|-------|
| graph-floor-formula | in-progress | n/a | ✓ | ✓ | – | 2026-06-30 |  | Robust spread-relative floor bar for compressed cosine ranges (Approach A) |
| tag-standardization | done | n/a | ✓ | ✓ | OK | 2026-07-03 | 2026-07-03 | Domain tag registry; entity+theme categories; reuse in ingest/format; normalizeTag |
| okf-integration | done | n/a | ✓ | ✓ | OK | 2026-07-10 | 2026-07-10 | OKF-native frontmatter + graph in body + description overview + migration + offline export (bundle serializer, fs writer, UI); all OKF evals green |
| hierarchical-description-chunk-retrieval | done | ✓ | ✓ | ✓ | OK | 2026-07-10 | 2026-07-10 | Hierarchical description seed selection, graph candidate expansion, clean chunk context |
| jsonl-domain-storage | done | ✓ | ✓ | ✓ | OK | 2026-07-10 | 2026-07-11 | JSONL storage/migration/query implemented; HLD eval live retrieval accepted |
| lexical-retrieval-quality | done | ✓ | ✓ | ✓ | OK | 2026-07-11 | 2026-07-11 | Weighted lexical scorer for eval harness and runtime Query fallback; HLD avg Overlap@5 0.68 |
| gold-bm25-eval-harness | done | ✓ | ✓ | ✓ | OK | 2026-07-11 | 2026-07-11 | Curated HLD gold set plus offline BM25/RRF A/B harness; live verdict needs_tuning for BM25/RRF variants |
| bm25-template-demotion | done | ✓ | ✓ | ✓ | OK | 2026-07-11 | 2026-07-11 | BM25 retest plus controlled boilerplate/template demotion |
| runtime-boilerplate-demotion | done | ✓ | ✓ | ✓ | OK | 2026-07-11 | 2026-07-12 | Default-enabled runtime rank-only boilerplate demotion factor 0.15 |
| reranker-quality-pipeline | done | ✓ | ✓ | ✓ | OK | 2026-07-12 | 2026-07-12 | Runtime reranker settings and staged quality pipeline |
| reranker-integration-eval | in-progress | ✓ | ✓ | ✓ | needs_work | 2026-07-12 |  | LiteLLM rerank eval blocked: lemonade-reranker-bge-reranker-v2-m3 returns provider error |
| guarded-rerank-tuning | done | ✓ | ✓ | ✓ | OK | 2026-07-13 | 2026-07-13 | Accepted page-aware rerank gate; nDCG@5 0.9254→0.9321, p95 +601 ms |
| structured-output-pipeline-resilience | done | ✓ | ✓ | ✓ | OK | 2026-07-14 | 2026-07-14 | Resilient structured-output recovery for empty/non-JSON/backend-incompatible LLM responses |
| storage-layout-sidecar-fix | done | n/a | ✓ | ✓ | OK | 2026-07-14 | 2026-07-15 | Fresh init aborts: JSONL sidecars leak into content filter; orphan !Wiki/_config folder |
| init-robustness-and-model-probes | in-progress | n/a | ✓ | ✓ | – | 2026-07-15 |  | effectiveSubfolder fallback, isWikiPagePath centralization, fail-fast embedding/bootstrap, dimensions opt-in, embedding+reranker Check probes |
| domain-metadata-live-stream | done | n/a | ✓ | ✓ | OK | 2026-07-15 | 2026-07-15 | Robust metadata.jsonl persistence (direct write + verify + tmp-promotion self-heal + surfaced error) and live LLM reasoning/token stream on init+ingest structured steps |
| domain-type-routing | done | n/a | n/a | n/a | OK | 2026-07-15 | 2026-07-15 | Directed bugfixes (no formal chain): (1) stop recreating !Wiki/_config on init; (2) server-enforced per-entity-type page routing (entity-routing.ts) + LLM classifier fallback + reject, no entities/ default; (3) preserve metadata.jsonl during force-reinit wipe; (4) isResuming keys on entity_types not analyzed_sources so bootstrap runs for a fresh domain (else zero types → routing rejects every page); (5) delete domain removes the whole !Wiki/<domain> folder (removeDomainFolder); (6) OKF ## Sources body section — server-enforced navigable [[source]] link from `resource` (ensureSourcesSection), embedded (not excluded), so wiki→source connection is not lost |
| dedup-and-sidebar-refinements | in-progress | n/a | ✓ | – | – | 2026-07-15 |  | Search+write dedup guards (A+D); sidebar ask-button swap; graph !Wiki scope + ask-wiki parity audits |
