# Wiki Graph

The wiki graph represents `[[WikiLink]]` connections between pages. Used for BFS context expansion in query and for structural health checks in lint.

## Graph Structure

An adjacency map `Map<pageId, Set<pageId>>`. Built from vault page content by scanning `[[...]]` patterns. Page IDs are bare file stems (no path, no `.md`).

See [[src/wiki-graph.ts#buildWikiGraph]].

## Query Graph Traversal

BFS from seed pages up to `graphDepth` hops. The graph is treated as **undirected**: `A → [[B]]` allows traversal B→A. Rationale: backlinks are symmetric in the user's mental model.

Seeds are always included in the result regardless of ranking. [[src/wiki-graph.ts#bfsExpand]] returns all reachable IDs. [[src/wiki-graph.ts#bfsExpandRanked]] wraps it with similarity/Jaccard ranking and a `bfsTopK` cap — only the top-K non-seed BFS pages are passed to the LLM. When `bfsTopK=0`, all BFS pages are returned. If the similarity service throws, falls back to full BFS.

## Graph Cache

`GraphCache` caches the built graph per domain ID keyed by a content hash. Avoids rebuilding the graph on every query when pages haven't changed.

Invalidated on any wiki-mutating operation (ingest, lint, lint-chat, init). See [[src/wiki-graph-cache.ts#GraphCache]], [[src/wiki-graph-cache.ts#graphCache]].

## Structural Health Check

`checkGraphStructure` reports isolated nodes (no in or out links) and non-reciprocated links. Results appear in the lint report. Hub node detection was removed — use `bfsTopK` in settings to control context size instead.

See [[src/wiki-graph.ts#checkGraphStructure]].
