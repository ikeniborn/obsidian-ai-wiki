# Intent: BFS Similarity Expansion + wiki_sources Protection

**Date:** 2026-06-02
**Status:** draft

## Objective

Two independent but related problems:

1. **BFS context quality**: BFS expands pages purely by graph topology (WikiLinks), ignoring semantic relevance to the query. After BFS traversal, pages are not ranked — all BFS-reachable pages get equal weight. Hub threshold exists as a lint warning for highly-connected pages but does not improve context selection and adds unnecessary configuration surface.

2. **wiki_sources data loss**: Lint incorrectly deletes `wiki_sources` frontmatter entries, treating valid Obsidian-style links (e.g. `[[Настройка прокси]]`) as dead links. This destroys source provenance data that is critical for tracing wiki pages back to their origin articles. The bug: lint resolves links by filename stem only, missing title-based Obsidian resolution.

## Desired Outcomes

- BFS, after topology traversal, performs an additional similarity pass: for each BFS-reached page, ranks by vector embedding (or Jaccard fallback) against the query and selects top-K most relevant pages
- Hub threshold removed from settings UI and codebase
- `wiki_sources` entries are preserved through all pipeline stages (lint, ingest, query)
- `wiki_sources` entries are removed only when the referenced source article is confirmed non-existent (by filename AND title resolution)
- Lint dead-link resolution for `wiki_sources` resolves by filename stem OR page title (Obsidian-style)
- `wiki_outgoing_links` validated only within the wiki scope (not against external sources)

## Health Metrics

- Query speed does not degrade significantly (similarity pass is additive, not a replacement for BFS)
- Existing `wiki_sources` in current wiki pages are not lost after deployment
- Lint does not fail on valid pages with correct `wiki_sources` entries
- All existing tests remain green

## Strategic Context

- Interacts with: `PageSimilarityService`, `WikiGraph` (BFS), `AgentRunner`, lint pipeline, ingest pipeline, plugin settings UI
- Priority trade-off: **trust > speed** — quality context matters more than latency
- Similarity method: vector embedding (primary) with Jaccard fallback when embedding API unavailable

## Constraints

### Steering (behavioral guidance)
- BFS top-K similarity parameter replaces Hub threshold in settings (1:1 replacement — same position, different semantics)
- Similarity after BFS is additive context enrichment, not a filter that removes BFS pages
- `wiki_sources` link resolution must use Obsidian conventions: resolve by filename stem first, then by page title

### Hard (architectural enforcement)
- Frontmatter format must not change
- `wiki_sources` is a distinct field from `wiki_outgoing_links` — different validation rules apply to each
- `wiki_outgoing_links` validation scope: wiki-internal only

## Autonomy Zones

- **Full autonomy** (reversible, low risk): remove Hub threshold from code and UI; fix lint dead-link resolution for `wiki_sources`; protect `wiki_sources` in ingest/lint
- **Proposal-first** (needs approval): BFS + similarity top-K algorithm design (show design before implementing)
- **No autonomy** (human only): changing frontmatter schema

## Stop Rules

- Halt if: similarity pass increases query latency by >2x in baseline tests
- Halt if: any existing `wiki_sources` data is deleted by the new lint logic during migration
- Escalate if: Obsidian title-resolution logic requires full vault scan (performance concern)
- Done when: lint no longer deletes valid `wiki_sources` entries; BFS returns similarity-ranked pages; Hub threshold absent from UI and code; all tests green
