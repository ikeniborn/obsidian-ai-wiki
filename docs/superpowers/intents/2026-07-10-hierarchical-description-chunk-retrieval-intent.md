---
review:
  intent_hash: b58b660b9fd0cad2
  last_run: 2026-07-10
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: hierarchical description-to-chunk retrieval

**Date:** 2026-07-10
**Status:** approved

## Objective

Current multi-vector retrieval embeds the article description as its own summary
chunk and also prepends that description to every section chunk. Page scoring then
uses the best similarity across all page vectors. The repeated description blurs
the semantic meaning of section vectors, so detailed chunk relevance is not
independent from broad article relevance.

Replace this with hierarchical retrieval. First, compare the query with article
description vectors to select seed articles. Next, expand those seeds through the
wiki graph. Finally, compare the query with clean section chunk vectors only inside
the resulting article pool. Give the LLM only the relevant chunks, each carrying
its article identifier and section heading, rather than complete article bodies.

## Desired Outcomes

- Article description vectors select the initial seed articles for a query.
- Wiki graph neighbours of the selected seed articles join the candidate article
  pool before detailed retrieval.
- Detailed retrieval ranks clean section chunks only within the candidate pool;
  article descriptions are not part of section chunk embedding input.
- The LLM context contains only selected chunk bodies with their article identifier
  and section heading. It does not contain complete candidate articles by default.
- When embeddings are unavailable, retrieval continues through a Jaccard fallback
  instead of failing the query.

## Health Metrics

- Answer quality must not regress against the current retrieval baseline.
- Recall of relevant facts and expected pages must not regress against the current
  retrieval baseline.
- Query latency is measured before and after the change. A small increase is
  acceptable; a change that makes normal interactive querying impractical requires
  escalation before release.
- Offline and embedding-failure query paths remain usable through Jaccard fallback.
- Retrieval cost is tracked, but ranks behind quality and latency when trade-offs
  are necessary.

## Strategic Context

- Interacts with:
  - `src/page-similarity.ts` — chunk construction, embedding cache, and similarity
    scoring.
  - `src/phases/query.ts` — seed selection, graph expansion, candidate selection,
    and single-domain context assembly.
  - `src/phases/query-cross-domain.ts` — cross-domain candidate merging and final
    context selection.
  - `src/wiki-graph.ts` and `src/wiki-graph-cache.ts` — graph expansion from seed
    articles.
  - `src/wiki-index.ts` — article descriptions used for broad article retrieval.
  - Retrieval eval harnesses under `eval/` — baseline quality, recall, fallback,
    latency, and context-shape evidence.
- Priority trade-off: **quality, then speed, then cost**.

## Constraints

### Steering (behavioral guidance)

- Keep broad article discovery and detailed chunk relevance as distinct ranking
  stages with separately interpretable scores.
- Use description similarity only to choose seed articles; graph neighbours may
  enter the candidate pool without passing the description-similarity gate.
- Require graph-derived articles to produce relevant chunks before any of their
  content enters the LLM context.
- Preserve existing retrieval observability and extend it where needed to expose
  article-pool and final-chunk decisions.

### Hard (architectural enforcement)

- A section chunk embedding input must not contain the article description.
- Final LLM retrieval context must contain selected chunks with article identifier
  and section heading, not full candidate article bodies by default.
- Preserve Jaccard fallback when embedding configuration or requests are unavailable.
- Do not add an external vector database, a new cloud service, or an additional LLM
  call for retrieval.
- Do not change user-visible retrieval settings or their defaults without a separate
  proposal and user approval.

## Autonomy Zones

- Full autonomy (reversible, low risk): internal types, embedding-cache layout,
  chunk metadata format, and tests.
- Guarded (log + retrieval evaluation): `topK`, similarity thresholds, graph depth,
  and ranking calibration.
- Proposal-first (needs approval): new user-visible settings or changes to existing
  defaults.
- No autonomy (human only): removal of Jaccard fallback, addition of a cloud service,
  or addition of another LLM call.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first or no-go decisions is
> marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: section chunk embeddings still include article descriptions, or the
  normal final context path still sends complete candidate articles.
- Escalate if: baseline answer quality or relevant-fact recall regresses, Jaccard
  fallback cannot be preserved, or latency becomes impractical for interactive use.
- Done when: retrieval evidence shows description-based seed selection, graph-based
  candidate expansion, clean chunk ranking inside that pool, and final context made
  only from relevant chunks with article identifiers and headings, while quality and
  recall match or exceed baseline and Jaccard fallback remains operational.
