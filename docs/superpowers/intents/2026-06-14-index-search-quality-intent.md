# Intent: index search quality (informative annotations + multi-vector retrieval)

**Date:** 2026-06-14
**Status:** draft

## Objective
Search fails to surface wiki content that demonstrably exists. The `_index.md`
annotation is the only text used for seed retrieval (embedding cosine + Jaccard),
and it is too thin: a 1–2 sentence summary capped at ~500 chars, embedded as a
single averaged vector per page. Facts that live in the page body but not in the
summary are invisible to retrieval. Result: added knowledge is not found, and the
wiki's usefulness collapses. Fix now because low recall makes the tool not worth
using.

## Desired Outcomes
- A query about a fact contained in a wiki page body (not just title/summary)
  returns that page in the seed set via similarity convergence.
- Recall measured on a set of real "query → expected page" pairs rises versus the
  current single-vector-over-summary baseline.
- The improvement holds on both retrieval paths: embedding mode and offline
  Jaccard fallback.

## Health Metrics
- Ingest dedup quality (`selectByEntities`) — no new duplicate pages introduced.
- Offline Jaccard fallback works with no API key.
- Embedding incrementality preserved — re-embed only changed content via hash,
  not the whole vault per run.
- Precision: higher recall must not flood results with noise.
- Cost/latency may grow for quality, but only to a reasonable bound.

## Strategic Context
- Producers of index annotations: `ingest`, `lint`, `lint-chat` (all write via
  `upsertIndexAnnotation`). Any new annotation/vector format must be emitted by
  all three.
- Consumers: `query` (seed selection) and `ingest` (dedup `selectByEntities`).
  No external tools/plugins read `_index.md`.
- Embedding store already exists: `domainEmbeddingsPath` →
  `EmbeddingCacheFile { model, dimensions, entries: { pid: { vec, hash } } }`
  (`src/page-similarity.ts:470`). Currently one vector per pid.
- Priority trade-off: **quality (trust)** is the primary vector; speed and cost
  are secondary up to a reasonable limit.

## Constraints
### Steering (behavioral guidance)
- Reuse `_index.md` (extend the format) and the existing embeddings cache file —
  do NOT introduce separate sidecar files.
- Multi-vector = extend the existing `EmbeddingCacheFile.entries` schema to hold
  several vectors per pid; not a new file, not a new store.
- `/embeddings` calls may be split into multiple requests if needed.
- Tags from page frontmatter are NOT to be included in the index description —
  they only add noise (explicitly rejected during intent capture).
- Annotation should be built from summarization of the page's actual sections +
  keywords, so body facts reach the retrieval text.

### Hard (architectural enforcement)
- Keep the single-line invariant of `_index.md`: one line per page, readable by
  `parseIndexAnnotations` (`src/wiki-index.ts:7`). Richer content stays within
  that one line.
- Do NOT modify page frontmatter.
- Do NOT add new external dependencies (no vector DB).
- Do NOT break backward compatibility of existing vaults (graceful handling of
  old index/cache; full re-embed is acceptable and done manually by the user).

## Autonomy Zones
- Full autonomy (reversible, low risk): implementation of the chosen variant —
  code, tests, embeddings-cache schema. Synthetic retrieval test added and run.
- Guarded (log + confidence threshold): none specific.
- Proposal-first (needs approval): **choice of index architecture** — multi-vector
  vs enriched single-vector vs hybrid — presented with trade-offs for the user to
  pick. This is a HUMAN CHECKPOINT.
- No autonomy (human only): manual full re-embed of the vault after a cache-schema
  change (the user runs it manually).

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. The architecture choice is a HUMAN CHECKPOINT.

## Stop Rules
- Halt if: the chosen architecture would require breaking the single-line
  `_index.md` invariant, touching frontmatter, or adding an external vector DB.
- Escalate if: dedup quality or offline Jaccard fallback regress, or precision
  degrades visibly (noise floods results).
- Done when: on a set of real "query → expected page" pairs, recall is higher
  than the current baseline AND dedup + offline-Jaccard remain intact, verified
  by a synthetic retrieval test plus manual check after build.
