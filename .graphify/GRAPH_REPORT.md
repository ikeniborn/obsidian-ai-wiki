# Graph Report - src/phases  (2026-06-04)

## Corpus Check
- Corpus is ~15,892 words - fits in a single context window. You may not need a graph.

## Summary
- 312 nodes · 408 edges · 12 communities (10 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `parseWithRetry()` - 12 edges
2. `buildChatParams()` - 12 edges
3. `render()` - 11 edges
4. `extractStreamDeltas()` - 9 edges
5. `parseStructured()` - 7 edges
6. `wrapStreamWithStats()` - 7 edges
7. `streamOnce()` - 6 edges
8. `missingTokensWithContext()` - 6 edges
9. `extractUsage()` - 6 edges
10. `buildLlmCallStatsEvent()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `llmSelectSeeds()` --calls--> `parseWithRetry()`  [INFERRED]
  src/phases/query.ts → src/phases/parse-with-retry.ts
- `actualizeDomainConfig()` --calls--> `parseWithRetry()`  [INFERRED]
  src/phases/lint.ts → src/phases/parse-with-retry.ts
- `parseFormatOutput()` --calls--> `parseStructured()`  [INFERRED]
  src/phases/format.ts → src/phases/llm-utils.ts
- `streamOnce()` --calls--> `buildChatParams()`  [INFERRED]
  src/phases/parse-with-retry.ts → src/phases/llm-utils.ts
- `streamOnce()` --calls--> `wrapStreamWithStats()`  [INFERRED]
  src/phases/parse-with-retry.ts → src/phases/llm-utils.ts

## Communities (12 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (53): absWiki, allMdPaths, allStructuralIssues, allWikiStems, annotations, articleName, articlePaths, backlinks (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (49): absWiki, allSourceWarnings, backlinkToday, { content: filteredSource, warnings: relatedWarnings }, { content: repairedPage, warnings: pageWarnings }, { content: repairedSource, warnings: sourceWarnings }, { content: sourcedPage, injected }, { content: wikiArticlesFiltered, warnings: wikiArticlesWarnings } (+41 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (39): baseParams, callStats, embedWarnings, lastSlash, messages, missing1, missing2, missingFinal (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (31): messages, params, { reasoning, content, outputTokens: tok }, requestStartMs, start, { stream, getStats }, systemContent, tok (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (30): allAnnotatedIds, allAnnotatedPaths, contextBlock, entityTypesBlock, expandedPages, files, graphResult, indexAnnotations (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (28): files, messages, META_FILES, pagesBlock, pwtEvents, start, systemContent, wikiVaultPath (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (12): alreadyAnalyzed, annotationsCache, collected, dryRun, existing, force, messages, sourceFiles (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.28
Nodes (10): analyzeAttachments(), analyzeExcalidraw(), analyzeImage(), analyzePdf(), arrayBufferToBase64(), callVisionLlm(), getMimeType(), PdfjsDoc (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (8): EvalResult, messages, params, userContent, buildEntityTypesBlock(), buildExtractMessages(), buildIngestMessages(), render()

## Knowledge Gaps
- **207 isolated node(s):** `META_FILES`, `question`, `wikiVaultPath`, `indexAnnotations`, `topK` (+202 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `render()` connect `Community 8` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `buildChatParams()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 8`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `parseWithRetry()` connect `Community 3` to `Community 0`, `Community 1`, `Community 4`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `parseWithRetry()` (e.g. with `llmSelectSeeds()` and `buildLlmCallStatsEvent()`) actually correct?**
  _`parseWithRetry()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `buildChatParams()` (e.g. with `streamOnce()` and `retryInvalidPaths()`) actually correct?**
  _`buildChatParams()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `render()` (e.g. with `buildExtractMessages()` and `buildIngestMessages()`) actually correct?**
  _`render()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `extractStreamDeltas()` (e.g. with `streamOnce()` and `retryInvalidPaths()`) actually correct?**
  _`extractStreamDeltas()` has 2 INFERRED edges - model-reasoned connections that need verification._