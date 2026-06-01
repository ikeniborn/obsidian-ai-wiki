# Intent: Query Pipeline Tracing

**Date:** 2026-06-01
**Status:** draft

## Objective

Query pipeline has no observability: seeds selected by vector/Jaccard, BFS-expanded articles, and tokens sent to LLM are invisible during execution. Need structured tracing to debug retrieval quality and context size — now, because retrieval behavior is opaque and hard to tune without visibility.

## Desired Outcomes

- Progress shows seeds with scores: "Seeds: [Article A (0.87), Article B (0.72)]"
- Progress shows BFS expansion: "BFS expanded: [Article C, Article D] (+2 hops from seeds)"
- End of query shows: "Tokens sent to LLM: 4821"
- `_agent.jsonl` in `!Wiki\_config` receives a structured trace entry per query run
- All output gated by plugin logging setting (only visible when logging enabled)

## Health Metrics

- Query result (LLM answer + article references) must not change
- No additional API calls or seed recalculation introduced
- Both jaccard and embedding modes produce tracing output
- Ingest and lint flows unaffected by changes to shared files (`wiki-seeds.ts`, `page-similarity.ts`, `wiki-graph.ts`)

## Strategic Context

- Interacts with: Obsidian UI (progress bar / notices), `_agent.jsonl` log file, `src/phases/query.ts`, shared similarity/graph services
- Priority trade-off: **trust** — structured log for debugging over minimal footprint
- Tracing is query-only: `selectRelevant` path, not `selectByEntities` (ingest)

## Constraints

### Steering (behavioral guidance)

- Tracing output routed through existing Obsidian progress mechanism — no new output channel
- `_agent.jsonl` writes are append-only, matching existing entry format
- Scores are informational only — do not alter seed selection logic

### Hard (architectural enforcement)

- Tracing only active when plugin logging is enabled in settings
- Changes to shared files must not introduce side effects on ingest/lint code paths
- Seed selection logic, BFS logic, and LLM response format must not change

## Autonomy Zones

- Full autonomy (reversible, low risk): adding trace output in `query.ts`, reading log level from existing plugin settings
- Guarded (log + confidence threshold): changes in shared files (`wiki-seeds.ts`, `page-similarity.ts`, `wiki-graph.ts`) — verify ingest/lint unaffected before committing
- Proposal-first (needs approval): schema of new `_agent.jsonl` trace entry format — show before implementing
- No autonomy (human only): changing seed selection logic, BFS algorithm, LLM response format

## Stop Rules

- Halt if: changes to shared files break existing ingest or lint tests
- Escalate if: `_agent.jsonl` format needs a breaking change to existing entries
- Done when: existing test suite passes + tracing visible in Obsidian UI with logging enabled + `_agent.jsonl` receives trace entry per query
