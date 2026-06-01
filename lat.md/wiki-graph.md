# Wiki Graph

The wiki graph represents `[[WikiLink]]` connections between pages. Used for BFS context expansion in query and for structural health checks in lint.

## Graph Structure

An adjacency map `Map<pageId, Set<pageId>>`. Built from vault page content by scanning `[[...]]` patterns. Page IDs are bare file stems (no path, no `.md`).

See [[src/wiki-graph.ts#buildWikiGraph]].

## Query Graph Traversal

BFS from seed pages up to `graphDepth` hops. The graph is treated as **undirected**: `A → [[B]]` allows traversal B→A. Rationale: backlinks are symmetric in the user's mental model.

Seeds not in the graph are silently skipped. Two functions: [[src/wiki-graph.ts#bfsExpand]] returns all reachable IDs. [[src/wiki-graph.ts#bfsExpandWithHops]] additionally tracks which pages are discovered at each hop depth, enabling query tracing diagnostics.

## Graph Cache

`GraphCache` caches the built graph per domain ID keyed by a content hash. Avoids rebuilding the graph on every query when pages haven't changed.

Invalidated on any wiki-mutating operation (ingest, lint, lint-chat, init). See [[src/wiki-graph-cache.ts#GraphCache]], [[src/wiki-graph-cache.ts#graphCache]].

## Structural Health Check

`checkGraphStructure` reports isolated nodes (no links), hub nodes (out-degree > `hubThreshold`), and non-reciprocated links. Results appear in the lint report.

`hubThreshold` is configurable in settings (default 20). See [[src/wiki-graph.ts#checkGraphStructure]].
