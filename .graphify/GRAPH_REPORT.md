# Graph Report - .  (2026-05-26)

## Corpus Check
- 2 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 71 nodes · 73 edges · 3 communities (2 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]

## God Nodes (most connected - your core abstractions)
1. `buildEntityTypesBlock()` - 3 edges
2. `parseJsonPages()` - 2 edges
3. `buildIngestMessages()` - 2 edges
4. `sourceVaultPath` - 1 edges
5. `domain` - 1 edges
6. `absWiki` - 1 edges
7. `wikiVaultPath` - 1 edges
8. `nonMetaPaths` - 1 edges
9. `{ graph }` - 1 edges
10. `seedIds` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (3 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (31): parseJsonPages(), adapter, badResponse, badResponseFirst, badResponseRetry, block, domain, domainWithoutPath (+23 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (26): absWiki, backlinkToday, domain, existingArticles, expandedIds, { graph }, logEntries, merged (+18 more)

## Knowledge Gaps
- **56 isolated node(s):** `sourceVaultPath`, `domain`, `absWiki`, `wikiVaultPath`, `nonMetaPaths` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildEntityTypesBlock()` connect `Community 2` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `sourceVaultPath`, `domain`, `absWiki` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._