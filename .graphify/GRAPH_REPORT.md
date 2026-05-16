# Graph Report - src  (2026-05-17)

## Corpus Check
- 9 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 173 nodes · 271 edges · 15 communities (7 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_View UI Layer|View UI Layer]]
- [[_COMMUNITY_Core Plugin Modules|Core Plugin Modules]]
- [[_COMMUNITY_AgentRunner Operations|AgentRunner Operations]]
- [[_COMMUNITY_WikiController Methods|WikiController Methods]]
- [[_COMMUNITY_Zod Schema Definitions|Zod Schema Definitions]]
- [[_COMMUNITY_AgentRunner Class|AgentRunner Class]]
- [[_COMMUNITY_Cache & Single-Flight|Cache & Single-Flight]]
- [[_COMMUNITY_Question Modal|Question Modal]]
- [[_COMMUNITY_Core Types|Core Types]]
- [[_COMMUNITY_Format Apply|Format Apply]]
- [[_COMMUNITY_LLM Call Options|LLM Call Options]]
- [[_COMMUNITY_View Entry|View Entry]]
- [[_COMMUNITY_Domain Entry Schema|Domain Entry Schema]]
- [[_COMMUNITY_Seeds Schema|Seeds Schema]]
- [[_COMMUNITY_Entity Types Delta|Entity Types Delta]]

## God Nodes (most connected - your core abstractions)
1. `LlmWikiView` - 34 edges
2. `WikiController` - 28 edges
3. `AgentRunner` - 8 edges
4. `WikiController.dispatch` - 7 edges
5. `RunEvent` - 6 edges
6. `AgentRunner.run` - 6 edges
7. `parseWithRetry` - 6 edges
8. `runLintFixChat` - 6 edges
9. `registerLinkHandler()` - 5 edges
10. `WikiController.dispatchChat` - 5 edges

## Surprising Connections (you probably didn't know these)
- `LintChatSchema (Zod)` --conceptually_related_to--> `lint-chat prompt template`  [INFERRED]
  src/phases/zod-schemas.ts → prompts/lint-chat.md
- `runLintFixChat` --references--> `lint-chat prompt template`  [EXTRACTED]
  src/phases/lint-chat.ts → prompts/lint-chat.md
- `lint-chat prompt template` --semantically_similar_to--> `lint prompt template`  [INFERRED] [semantically similar]
  prompts/lint-chat.md → prompts/lint.md
- `WikiController` --shares_data_with--> `RunHistoryEntry`  [EXTRACTED]
  src/controller.ts → src/types.ts
- `WikiController.dispatch` --calls--> `LlmWikiView.setRunning`  [EXTRACTED]
  src/controller.ts → src/view.ts

## Hyperedges (group relationships)
- **Controller → AgentRunner → View event streaming loop** — controller_dispatch, agent_runner_run, view_appendevent [EXTRACTED 1.00]
- **lint-chat fix pipeline: runLintFixChat → parseWithRetry → LintChatSchema** — lint_chat_runlintfixchat, parse_retry_parsewithretry, zod_schemas_lintchatschema [EXTRACTED 1.00]
- **Structured output retry pattern: parseWithRetry + Zod schemas + structural_error RunEvent** — parse_retry_parsewithretry, zod_schemas_domainentryschema, types_runevent [INFERRED 0.85]

## Communities (15 total, 8 thin omitted)

### Community 0 - "View UI Layer"
Cohesion: 0.08
Nodes (6): LlmWikiView, registerLinkHandler(), sanitizeLinks(), summariseInput(), translateSystemEvent(), truncate()

### Community 1 - "Core Plugin Modules"
Cohesion: 0.1
Nodes (30): files, messages, META_FILES, pagesBlock, start, systemContent, wikiVaultPath, CallSite (+22 more)

### Community 2 - "AgentRunner Operations"
Cohesion: 0.08
Nodes (32): AgentRunner.buildOptsFor, AgentRunner.run, AgentRunner.runOperation, AgentRunner.writeDevLog, WikiController.buildAgentRunner, WikiController.dispatch, WikiController.dispatchChat, WikiController.format (+24 more)

### Community 3 - "WikiController Methods"
Cohesion: 0.14
Nodes (3): patchWikiFields(), toVaultPath(), WikiController

### Community 4 - "Zod Schema Definitions"
Cohesion: 0.2
Nodes (9): DomainEntryResponse, DomainEntrySchema, EntityTypeSchema, EntityTypesDeltaResponse, EntityTypesDeltaSchema, LintChatResponse, LintChatSchema, SeedsResponse (+1 more)

### Community 6 - "Cache & Single-Flight"
Cohesion: 0.33
Nodes (6): AgentRunner, WikiController cache invalidation on mutating ops, WikiController single-flight guard, WikiController, LlmClient (interface), LlmWikiPluginSettings

### Community 8 - "Core Types"
Cohesion: 0.67
Nodes (3): ChatMessage, RunRequest, WikiOperation (union type)

## Knowledge Gaps
- **47 isolated node(s):** `WikiDomain`, `OpMap`, `ClaudeOperationConfig`, `NativeOperationConfig`, `DEFAULT_SETTINGS` (+42 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LlmWikiView` connect `View UI Layer` to `Core Plugin Modules`?**
  _High betweenness centrality (0.224) - this node is a cross-community bridge._
- **Why does `WikiController` connect `WikiController Methods` to `Core Plugin Modules`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `AgentRunner` connect `AgentRunner Class` to `Core Plugin Modules`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `WikiDomain`, `OpMap`, `ClaudeOperationConfig` to the rest of the system?**
  _47 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `View UI Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Core Plugin Modules` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `AgentRunner Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._