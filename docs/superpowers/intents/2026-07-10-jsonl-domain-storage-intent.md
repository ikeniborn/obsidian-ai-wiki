---
review:
  intent_hash: d876b3521e2eb0b5
  last_run: 2026-07-10
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: JSONL domain storage

**Date:** 2026-07-10
**Status:** approved

## Objective

Replace the current wiki service-file layout with a JSONL-centered storage model
that is closer to OKF/iwiki conventions and easier to inspect, stream, migrate, and
evaluate.

The current model keeps global domain metadata under `!Wiki/_config/_domain.json`,
domain metadata under per-domain `_config` folders, retrieval annotations in
`_index.md`, operation history in `_log.md`, and vectors in `_embeddings.json`.
The target direction removes `_config`, replaces markdown service files with
JSONL records, and eliminates the separate embeddings file by storing chunk
metadata and embedding vectors in `index.jsonl`.

The root `!Wiki` folder should contain only a global `domain` JSONL file if that
global registry remains necessary. `index.jsonl` and `log.jsonl` live inside each
domain separately. The design must analyze whether the global `!Wiki/domain` file
is still needed at all, or whether each domain can become self-contained and be
discovered by settings and the sidebar from domain-local metadata. The design must
also analyze whether entity types still need explicit domain-level management, or
whether types can be derived from the domain structure and page frontmatter.

## Desired Outcomes

- New domains are created without `_config` folders.
- Each domain stores its retrieval index in a domain-local `index.jsonl`.
- Each domain stores its operation history in a domain-local `log.jsonl`.
- `_embeddings.json` is removed; embedding vectors are stored in `index.jsonl`
  records with their chunk metadata.
- Settings and the sidebar can load and display domains from the new storage
  source.
- Query works against the new index format.
- The design explicitly decides whether to keep a global root `!Wiki/domain`
  registry or move to fully self-contained domain metadata.
- The design explicitly decides whether entity types remain managed domain
  metadata or become derived from domain structure/page data.
- An eval harness builds a test domain from
  `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`,
  runs five test queries, and reports whether retrieval effectiveness is acceptable.

## Health Metrics

- Retrieval quality must not regress.
- Recall of relevant pages and chunks must not regress.
- Query latency must not regress beyond a threshold accepted during design.
- Ingest and index rebuild time must not regress beyond a threshold accepted during
  design.
- Service-file size must stay controlled and understandable.
- Manual inspection of domain files must remain practical for a human operator.

## Strategic Context

- Interacts with:
  - `src/domain-store.ts` and `src/domain.ts` for domain metadata persistence.
  - `src/wiki-path.ts` for service-file locations.
  - `src/wiki-index.ts` for retrieval descriptions and index reconciliation.
  - `src/wiki-log.ts` for domain operation history.
  - `src/page-similarity.ts`, `src/wiki-seeds.ts`, and query phases for retrieval
    vectors, chunks, and fallback paths.
  - Settings and sidebar code that list, create, update, and display domains.
  - OKF migration/export code because frontmatter, body links, and retrieval
    sections must stay compatible with the OKF direction.
  - Eval tooling that must exercise the new format on real HLD notes.
- Priority trade-off: **trust, then speed, then cost**.

## Constraints

### Steering (behavioral guidance)

- Prefer storage that is easy to inspect manually and easy to migrate safely.
- Keep domain-local files self-explanatory where possible, so a domain can be
  reasoned about without reading a hidden global config directory.
- Use line-oriented JSONL records for index and log data so records can be appended,
  streamed, diffed, and partially recovered.
- Evaluate both global-registry and self-contained-domain designs before choosing
  the storage contract.
- Evaluate whether entity types still need explicit management before preserving
  that concept in the new format.
- Keep the HLD eval harness isolated from the source vault and from production
  domain data.

### Hard (architectural enforcement)

- Do not store embedding vectors in markdown body or markdown frontmatter.
- `## Related` and `## External links` sections must not be embedded into retrieval
  vectors.
- `index.jsonl` must become the runtime source of truth for chunk metadata and
  embedding vectors after migration.
- `log.jsonl` must become the runtime source of truth for domain operation history
  after migration.
- Legacy `_index.md`, `_log.md`, `_embeddings.json`, and `_config` paths must not
  remain runtime sources of truth after the migration completes.
- Migration must not lose existing domains, source paths, analyzed source hashes,
  descriptions, vectors, entity-type information, logs, or page data.
- Jaccard fallback must remain available when embeddings are missing or unusable.
- The HLD source vault must not be mutated by the eval harness.

## Autonomy Zones

- Full autonomy (reversible, low risk): schema field names, JSONL record shapes,
  pure parser/serializer helpers, fixture layout, and unit-test structure.
- Guarded (log + evidence threshold): migration order, one-release legacy fallback
  reads, performance thresholds, index rebuild strategy, and eval report shape.
- Proposal-first (needs approval): keeping or removing the global `!Wiki/domain`
  registry, keeping or removing managed entity types, changing user-visible domain
  settings, or changing retrieval ranking defaults.
- No autonomy (human only): deleting legacy data without a successful migration and
  recovery path, removing Jaccard fallback, mutating the HLD source vault, or adding
  an external vector database/cloud storage dependency.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first or no-go decisions is
> marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the design cannot account for existing domain metadata, entity types,
  analyzed source hashes, descriptions, vectors, logs, and query fallback behavior.
- Halt if: any migration path can delete or overwrite legacy service files before
  the new files are verified.
- Escalate if: eval results show retrieval quality, recall, query latency, rebuild
  time, service-file size, or manual inspectability regressing.
- Escalate if: the self-contained-domain option and the global-registry option have
  no clear trust/speed/cost winner.
- Done when: a checked design specifies the new storage contract, domain discovery
  model, entity-type decision, migration behavior, runtime read/write paths, query
  behavior, and HLD eval harness; later implementation evidence shows the new
  format, migration, settings/sidebar, query, and five-query HLD evaluation working
  without regressions against the critical health metrics.
