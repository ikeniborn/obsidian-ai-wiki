# Graph Report - .  (2026-05-17)

## Corpus Check
- 145 files · ~108,304 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1094 nodes · 1719 edges · 76 communities (56 shown, 20 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.81)
- Token cost: 38,732 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Query Phase|Query Phase]]
- [[_COMMUNITY_Controller Layer|Controller Layer]]
- [[_COMMUNITY_Init Phase Tests|Init Phase Tests]]
- [[_COMMUNITY_Obsidian Mock Infrastructure|Obsidian Mock Infrastructure]]
- [[_COMMUNITY_Domain Store|Domain Store]]
- [[_COMMUNITY_Claude CLI Client|Claude CLI Client]]
- [[_COMMUNITY_AgentRunner Tests|AgentRunner Tests]]
- [[_COMMUNITY_Wiki Path & Templates|Wiki Path & Templates]]
- [[_COMMUNITY_UI View Layer|UI View Layer]]
- [[_COMMUNITY_AgentRunner Core|AgentRunner Core]]
- [[_COMMUNITY_Lint Phase|Lint Phase]]
- [[_COMMUNITY_DSPy Optimization|DSPy Optimization]]
- [[_COMMUNITY_Plugin Architecture Docs|Plugin Architecture Docs]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_Lint Phase Tests|Lint Phase Tests]]
- [[_COMMUNITY_DSPy Library|DSPy Library]]
- [[_COMMUNITY_LLM Utils & Chat|LLM Utils & Chat]]
- [[_COMMUNITY_Ingest Phase|Ingest Phase]]
- [[_COMMUNITY_Format Phase Tests|Format Phase Tests]]
- [[_COMMUNITY_Plugin Entry Point|Plugin Entry Point]]
- [[_COMMUNITY_Types & AgentRunner Files|Types & AgentRunner Files]]
- [[_COMMUNITY_Effective Settings|Effective Settings]]
- [[_COMMUNITY_Modal Components|Modal Components]]
- [[_COMMUNITY_Lint-Chat Phase|Lint-Chat Phase]]
- [[_COMMUNITY_Init Thinking Tests|Init Thinking Tests]]
- [[_COMMUNITY_VaultTools|VaultTools]]
- [[_COMMUNITY_Lint-Chat Tests|Lint-Chat Tests]]
- [[_COMMUNITY_DSPy Data Loader|DSPy Data Loader]]
- [[_COMMUNITY_Query Phase Tests|Query Phase Tests]]
- [[_COMMUNITY_Cache Invalidation Tests|Cache Invalidation Tests]]
- [[_COMMUNITY_DSPy Dev Logs|DSPy Dev Logs]]
- [[_COMMUNITY_Controller Utilities|Controller Utilities]]
- [[_COMMUNITY_Mobile LLM Wrap|Mobile LLM Wrap]]
- [[_COMMUNITY_Query Thinking Tests|Query Thinking Tests]]
- [[_COMMUNITY_View Metrics Tests|View Metrics Tests]]
- [[_COMMUNITY_Plugin Dependencies|Plugin Dependencies]]
- [[_COMMUNITY_Zod Schemas|Zod Schemas]]
- [[_COMMUNITY_Raw Frontmatter Utils|Raw Frontmatter Utils]]
- [[_COMMUNITY_Settings UI|Settings UI]]
- [[_COMMUNITY_Evaluator Phase|Evaluator Phase]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]

## God Nodes (most connected - your core abstractions)
1. `VaultTools` - 36 edges
2. `LlmWikiView` - 34 edges
3. `WikiController` - 33 edges
4. `I18n` - 31 edges
5. `LlmClient` - 29 edges
6. `RunEvent` - 22 edges
7. `LlmCallOptions` - 15 edges
8. `AgentRunner` - 13 edges
9. `VaultAdapter` - 13 edges
10. `obsidian-llm-wiki Plugin` - 12 edges

## Surprising Connections (you probably didn't know these)
- `LintChatSchema (Zod)` --conceptually_related_to--> `lint-chat prompt template`  [INFERRED]
  src/phases/zod-schemas.ts → prompts/lint-chat.md
- `runLintFixChat` --references--> `lint-chat prompt template`  [EXTRACTED]
  src/phases/lint-chat.ts → prompts/lint-chat.md
- `requestUrl()` --calls--> `mobileFetch()`  [INFERRED]
  vitest.mock.ts → src/mobile-fetch.ts
- `Ingest Operation` --conceptually_related_to--> `Incremental Entity Type Update`  [INFERRED]
  README.md → prompts/init-incremental.md
- `lint-chat prompt template` --semantically_similar_to--> `lint prompt template`  [INFERRED] [semantically similar]
  prompts/lint-chat.md → prompts/lint.md

## Hyperedges (group relationships)
- **DSPy MIPROv2 optimization pipeline: dev.jsonl → loader → optimizer → writer** — dspy_dev_jsonl, dspy_load_examples, dspy_run_mipro, dspy_write_optimized, dspy_optimize_py [EXTRACTED 1.00]
- **Backend selection: DSPY_BACKEND env selects between Ollama and ClaudeCodeLM via make_lm** — dspy_dspy_backend_env, dspy_make_lm, dspy_claudecodelm [EXTRACTED 1.00]
- **Placeholder preservation: template syntax + restore_placeholders survive MIPROv2 rewriting** — dspy_placeholder_syntax, dspy_restore_placeholders, dspy_miprov2 [EXTRACTED 1.00]
- **DSPy optimization pipeline: evaluator prompt + operation prompts + dev log form closed feedback loop** — dspy_readme, prompt_evaluator, prompt_ingest, prompt_ingest_optimized, concept_dspy_miprov2 [EXTRACTED 0.95]

## Communities (76 total, 20 thin omitted)

### Community 0 - "Query Phase"
Cohesion: 0.05
Nodes (48): allPageIds, buildContextBlock(), contextBlock, entityTypesBlock, files, { graph, fromCache }, messages, META_FILES (+40 more)

### Community 1 - "Controller Layer"
Cohesion: 0.07
Nodes (15): WikiController, resolveEffective(), I18n, AddDomainModal, BusyCloseModal, EditDomainModal, buildProxyUrl(), createProxyDispatcher() (+7 more)

### Community 2 - "Init Phase Tests"
Cohesion: 0.04
Nodes (51): ac, adapter, bootstrapDomainJson, bootstrapJson, bootstrapUpdate, concept, created, current (+43 more)

### Community 3 - "Obsidian Mock Infrastructure"
Cohesion: 0.05
Nodes (31): AbstractInputSuggest, activeDocument, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl() (+23 more)

### Community 4 - "Domain Store"
Cohesion: 0.05
Nodes (27): applyDomainEvent(), migrateDomainsV2(), DomainCorruptError, DomainStore, validateDomainId(), migrateDomainWikiFolder(), FileErrorModal, consolidateSourcePaths() (+19 more)

### Community 5 - "Claude CLI Client"
Cohesion: 0.06
Nodes (39): ClaudeCliClient, ClaudeCliConfig, isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate() (+31 more)

### Community 6 - "AgentRunner Tests"
Cohesion: 0.05
Nodes (36): ac, baseArgs, calls, ev, events, fail, fb, llm (+28 more)

### Community 7 - "Wiki Path & Templates"
Cohesion: 0.05
Nodes (32): alreadyAnalyzed, appendLog(), collected, delta, dryRun, existing, existingDomain, force (+24 more)

### Community 8 - "UI View Layer"
Cohesion: 0.08
Nodes (6): LlmWikiView, registerLinkHandler(), sanitizeLinks(), summariseInput(), translateSystemEvent(), truncate()

### Community 9 - "AgentRunner Core"
Cohesion: 0.06
Nodes (38): AgentRunner, AgentRunner.buildOptsFor, AgentRunner.run, AgentRunner.runOperation, AgentRunner.writeDevLog, WikiController.buildAgentRunner, WikiController.dispatch, WikiController.dispatchChat (+30 more)

### Community 10 - "Lint Phase"
Cohesion: 0.06
Nodes (29): absWiki, allIssues, backlinks, { content, outputTokens: tok }, diffReport, entityTypesBlock, existingArticles, files (+21 more)

### Community 11 - "DSPy Optimization"
Cohesion: 0.08
Nodes (21): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+13 more)

### Community 12 - "Plugin Architecture Docs"
Cohesion: 0.1
Nodes (30): AgentRunner, ClaudeCliClient, GraphCache, LlmWikiView, obsidian-llm-wiki Plugin, parseStreamLine, selectSeeds, Settings / autodetectCwd (+22 more)

### Community 13 - "Format Phase"
Cohesion: 0.14
Nodes (21): appendMissingLines(), escapeRawControlsInStrings(), escapeRegExp(), extractJsonObject(), FormatResponse, lemmas(), looksTruncated(), MissingToken (+13 more)

### Community 14 - "Lint Phase Tests"
Cohesion: 0.09
Nodes (21): adapter, collect(), configJson, createMock, dom, domain, domainA, domainB (+13 more)

### Community 15 - "DSPy Library"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 16 - "LLM Utils & Chat"
Cohesion: 0.17
Nodes (12): buildChatParams(), extractStreamDeltas(), extractUsage(), injectSystemPrompt(), isJsonModeError(), JSON_MODE_KEYWORDS, parseStructured(), prependBaseContract() (+4 more)

### Community 17 - "Ingest Phase"
Cohesion: 0.16
Nodes (13): appendLog(), buildEntityTypesBlock(), buildIngestMessages(), detectDomain(), extractParentSourcePath(), parseJsonPages(), collect(), makeLlm() (+5 more)

### Community 18 - "Format Phase Tests"
Cohesion: 0.11
Nodes (14): adapter, blocks, callArgs, create, ctrl, history, json, json1 (+6 more)

### Community 19 - "Plugin Entry Point"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 20 - "Types & AgentRunner Files"
Cohesion: 0.19
Nodes (13): ClaudeOperationConfig, DEFAULT_SETTINGS, LlmCallOptions, LlmClient, NativeOperationConfig, OpKey, OpMap, RunRequest (+5 more)

### Community 21 - "Effective Settings"
Cohesion: 0.18
Nodes (8): EffectiveSettings, DEFAULTS, LocalConfig, ProxyConfig, parseTimeoutString(), LlmWikiPluginSettings, p, r

### Community 22 - "Modal Components"
Cohesion: 0.12
Nodes (4): ConfirmModal, DomainModal, FolderInputSuggest, QueryModal

### Community 23 - "Lint-Chat Phase"
Cohesion: 0.14
Nodes (14): files, messages, META_FILES, pagesBlock, start, systemContent, wikiVaultPath, CallSite (+6 more)

### Community 24 - "Init Thinking Tests"
Cohesion: 0.13
Nodes (9): adapter, domain, events, llm, updates, VALID_PATCH_JSON, vt, withTypes (+1 more)

### Community 26 - "Lint-Chat Tests"
Cohesion: 0.13
Nodes (11): blocked, domain, events, llm, llmResponse, pages, req, resultEvent (+3 more)

### Community 27 - "DSPy Data Loader"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 28 - "Query Phase Tests"
Cohesion: 0.18
Nodes (11): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+3 more)

### Community 29 - "Cache Invalidation Tests"
Cohesion: 0.23
Nodes (12): build(), DOMAIN, domain2, invalidateSpy, makeApp(), makeDomainStore(), makeLocalConfigStore(), makePlugin() (+4 more)

### Community 30 - "DSPy Dev Logs"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 31 - "Controller Utilities"
Cohesion: 0.41
Nodes (8): patchWikiFields(), toVaultPath(), ChatMessage, OnFileError, RunEvent, RunHistoryEntry, WikiOperation, ViewState

### Community 32 - "Mobile LLM Wrap"
Cohesion: 0.18
Nodes (6): wrapMobileNoStream(), callArgs, completion, createMock, inner, wrapped

### Community 33 - "Query Thinking Tests"
Cohesion: 0.18
Nodes (9): ctx, domain, events, { llm, getCapturedMessages }, makeAdapterWithPages(), mockAdapter(), noisePages, pages (+1 more)

### Community 34 - "View Metrics Tests"
Cohesion: 0.18
Nodes (10): askBtn, askSaveBtn, cancelBtn, finalEl, finishedAt, progressCount, resultSection, resultToggle (+2 more)

### Community 35 - "Plugin Dependencies"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 36 - "Zod Schemas"
Cohesion: 0.2
Nodes (9): DomainEntryResponse, DomainEntrySchema, EntityTypeSchema, EntityTypesDeltaResponse, EntityTypesDeltaSchema, LintChatResponse, LintChatSchema, SeedsResponse (+1 more)

### Community 37 - "Raw Frontmatter Utils"
Cohesion: 0.33
Nodes (8): buildWikiFields(), hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), removeWikiFields(), ARTICLES, result, upsertRawFrontmatter()

### Community 39 - "Evaluator Phase"
Cohesion: 0.29
Nodes (5): EvalResult, messages, params, parseEvalResponse(), userContent

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 41 - "Community 41"
Cohesion: 0.4
Nodes (4): en, es, locales, ru

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): collect(), makeLlm(), mockAdapter(), mockAdapterWithSources()

### Community 46 - "Community 46"
Cohesion: 0.5
Nodes (4): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, DSPy Prompt Optimizer README, Evaluator Prompt Template

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (4): format.md (LLM prompt), _format_schema.md (template), _wiki_schema.md (template), wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 49 - "Community 49"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (3): ChatMessage, RunRequest, WikiOperation (union type)

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **447 isolated node(s):** `ViewState`, `CallSite`, `ParseWithRetryArgs`, `ParseWithRetryResult`, `META_FILES` (+442 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VaultTools` connect `VaultTools` to `Query Phase`, `Query Thinking Tests`, `Init Phase Tests`, `AgentRunner Tests`, `Wiki Path & Templates`, `Lint Phase`, `Community 44`, `Format Phase`, `Lint Phase Tests`, `Ingest Phase`, `Format Phase Tests`, `Types & AgentRunner Files`, `Init Thinking Tests`, `Query Phase Tests`, `Controller Utilities`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `DSPy Optimization` to `Effective Settings`, `Controller Utilities`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `RunEvent` connect `Controller Utilities` to `Query Phase`, `Domain Store`, `Claude CLI Client`, `AgentRunner Tests`, `Wiki Path & Templates`, `Evaluator Phase`, `Lint Phase`, `Format Phase`, `LLM Utils & Chat`, `Ingest Phase`, `Types & AgentRunner Files`, `Lint-Chat Phase`, `Cache Invalidation Tests`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **What connects `ViewState`, `CallSite`, `ParseWithRetryArgs` to the rest of the system?**
  _447 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Query Phase` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Controller Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Init Phase Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._