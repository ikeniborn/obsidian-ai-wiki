# Graph Report - src  (2026-05-18)

## Corpus Check
- Corpus is ~30,321 words - fits in a single context window. You may not need a graph.

## Summary
- 1114 nodes · 1698 edges · 76 communities (57 shown, 19 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_WikiController + View Layer|WikiController + View Layer]]
- [[_COMMUNITY_Init Phase Tests|Init Phase Tests]]
- [[_COMMUNITY_Obsidian API Mocks|Obsidian API Mocks]]
- [[_COMMUNITY_Domain Store + Events|Domain Store + Events]]
- [[_COMMUNITY_AgentRunner Integration Tests|AgentRunner Integration Tests]]
- [[_COMMUNITY_Ingest Phase + Tests|Ingest Phase + Tests]]
- [[_COMMUNITY_Wiki Path + Init Helpers|Wiki Path + Init Helpers]]
- [[_COMMUNITY_LlmWikiView Render|LlmWikiView Render]]
- [[_COMMUNITY_DSPy Scripts|DSPy Scripts]]
- [[_COMMUNITY_WikiGraph + GraphCache|WikiGraph + GraphCache]]
- [[_COMMUNITY_Lint Phase|Lint Phase]]
- [[_COMMUNITY_AgentRunner Core|AgentRunner Core]]
- [[_COMMUNITY_ClaudeCliClient|ClaudeCliClient]]
- [[_COMMUNITY_Type References (claude)|Type References (claude)]]
- [[_COMMUNITY_Query Phase|Query Phase]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
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
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
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
1. `LlmWikiView` - 34 edges
2. `VaultTools` - 34 edges
3. `WikiController` - 33 edges
4. `I18n` - 31 edges
5. `LlmClient` - 26 edges
6. `RunEvent` - 19 edges
7. `AgentRunner` - 13 edges
8. `VaultAdapter` - 13 edges
9. `LlmCallOptions` - 12 edges
10. `obsidian-llm-wiki Plugin` - 12 edges

## Surprising Connections (you probably didn't know these)
- `requestUrl()` --calls--> `mobileFetch()`  [INFERRED]
  vitest.mock.ts → src/mobile-fetch.ts
- `Ingest Operation` --conceptually_related_to--> `Incremental Entity Type Update`  [INFERRED]
  README.md → prompts/init-incremental.md
- `lint-chat prompt template` --semantically_similar_to--> `lint prompt template`  [INFERRED] [semantically similar]
  prompts/lint-chat.md → prompts/lint.md
- `main()` --calls--> `load_examples()`  [INFERRED]
  scripts/dspy/optimize.py → scripts/dspy/lib/loader.py
- `main()` --calls--> `run_mipro()`  [INFERRED]
  scripts/dspy/optimize.py → scripts/dspy/lib/optimizer.py

## Communities (76 total, 19 thin omitted)

### Community 0 - "WikiController + View Layer"
Cohesion: 0.07
Nodes (14): WikiController, I18n, AddDomainModal, BusyCloseModal, EditDomainModal, buildProxyUrl(), createProxyDispatcher(), createProxyFetch() (+6 more)

### Community 1 - "Init Phase Tests"
Cohesion: 0.04
Nodes (51): ac, adapter, bootstrapDomainJson, bootstrapJson, bootstrapUpdate, concept, created, current (+43 more)

### Community 2 - "Obsidian API Mocks"
Cohesion: 0.05
Nodes (31): AbstractInputSuggest, activeDocument, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl() (+23 more)

### Community 3 - "Domain Store + Events"
Cohesion: 0.05
Nodes (27): applyDomainEvent(), migrateDomainsV2(), DomainCorruptError, DomainStore, validateDomainId(), migrateDomainWikiFolder(), FileErrorModal, consolidateSourcePaths() (+19 more)

### Community 4 - "AgentRunner Integration Tests"
Cohesion: 0.05
Nodes (36): ac, baseArgs, calls, ev, events, fail, fb, llm (+28 more)

### Community 5 - "Ingest Phase + Tests"
Cohesion: 0.06
Nodes (40): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), buildIngestSummary(), detectDomain(), domain (+32 more)

### Community 6 - "Wiki Path + Init Helpers"
Cohesion: 0.05
Nodes (31): alreadyAnalyzed, appendLog(), collected, delta, dryRun, existing, existingDomain, force (+23 more)

### Community 7 - "LlmWikiView Render"
Cohesion: 0.08
Nodes (6): LlmWikiView, registerLinkHandler(), sanitizeLinks(), summariseInput(), translateSystemEvent(), truncate()

### Community 8 - "DSPy Scripts"
Cohesion: 0.08
Nodes (21): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+13 more)

### Community 9 - "WikiGraph + GraphCache"
Cohesion: 0.09
Nodes (26): bfsExpand(), buildWikiGraph(), CacheEntry, GraphCache, hashPages(), checkGraphStructure(), pageId(), WikiGraph (+18 more)

### Community 10 - "Lint Phase"
Cohesion: 0.06
Nodes (28): absWiki, allIssues, backlinks, { content, outputTokens: tok }, diffReport, entityTypesBlock, existingArticles, files (+20 more)

### Community 11 - "AgentRunner Core"
Cohesion: 0.07
Nodes (33): AgentRunner, AgentRunner.buildOptsFor, AgentRunner.run, AgentRunner.runOperation, AgentRunner.writeDevLog, WikiController.buildAgentRunner, WikiController.dispatch, WikiController.dispatchChat (+25 more)

### Community 12 - "ClaudeCliClient"
Cohesion: 0.08
Nodes (24): ClaudeCliClient, ClaudeCliConfig, cfg, chunks, client, createPromise, ctrl, largeSystem (+16 more)

### Community 13 - "Type References (claude)"
Cohesion: 0.1
Nodes (30): AgentRunner, ClaudeCliClient, GraphCache, LlmWikiView, obsidian-llm-wiki Plugin, parseStreamLine, selectSeeds, Settings / autodetectCwd (+22 more)

### Community 14 - "Query Phase"
Cohesion: 0.07
Nodes (25): allPageIds, contextBlock, entityTypesBlock, files, { graph, fromCache }, indexAnnotations, messages, META_FILES (+17 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (13): patchWikiFields(), toVaultPath(), EffectiveSettings, resolveEffective(), DEFAULTS, LocalConfig, ProxyConfig, ConfirmModal (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (17): ChatMessage, ClaudeOperationConfig, DEFAULT_SETTINGS, LlmCallOptions, LlmWikiPluginSettings, NativeOperationConfig, OnFileError, OpKey (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (13): buildChatParams(), extractStreamDeltas(), extractUsage(), injectSystemPrompt(), isJsonModeError(), JSON_MODE_KEYWORDS, parseStructured(), prependBaseContract() (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (21): adapter, collect(), configJson, createMock, dom, domain, domainA, domainB (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (21): appendMissingLines(), escapeRawControlsInStrings(), escapeRegExp(), extractJsonObject(), FormatResponse, lemmas(), looksTruncated(), MissingToken (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (14): adapter, blocks, callArgs, create, ctrl, history, json, json1 (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (7): en, es, locales, ru, DomainModal, QueryModal, p

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (15): isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate(), e, ev (+7 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (9): adapter, domain, events, llm, updates, VALID_PATCH_JSON, vt, withTypes (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (11): blocked, domain, events, llm, llmResponse, pages, req, resultEvent (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (11): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (6): wrapMobileNoStream(), callArgs, completion, createMock, inner, wrapped

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (9): ctx, domain, events, { llm, getCapturedMessages }, makeAdapterWithPages(), mockAdapter(), noisePages, pages (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (10): files, messages, META_FILES, pagesBlock, start, systemContent, wikiVaultPath, LintChatSchema (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (10): askBtn, askSaveBtn, cancelBtn, finalEl, finishedAt, progressCount, resultSection, resultToggle (+2 more)

### Community 35 - "Community 35"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (6): EvalResult, messages, params, parseEvalResponse(), userContent, render()

### Community 37 - "Community 37"
Cohesion: 0.28
Nodes (7): CallSite, formatZodFeedback(), parseWithRetry(), ParseWithRetryArgs, ParseWithRetryResult, streamOnce(), StructuredValidationError

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (8): DomainEntryResponse, DomainEntrySchema, EntityTypeSchema, EntityTypesDeltaResponse, EntityTypesDeltaSchema, LintChatResponse, SeedsResponse, SeedsSchema

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (6): big, pages, q, r, s, t

### Community 42 - "Community 42"
Cohesion: 0.52
Nodes (6): bodyContent(), parseFmKeywords(), scoreSeed(), selectSeeds(), STOP_WORDS, tokenize()

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (4): collect(), makeLlm(), mockAdapter(), mockAdapterWithSources()

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (4): format.md (LLM prompt), _format_schema.md (template), _wiki_schema.md (template), wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 50 - "Community 50"
Cohesion: 0.5
Nodes (4): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, DSPy Prompt Optimizer README, Evaluator Prompt Template

### Community 51 - "Community 51"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (3): ChatMessage, RunRequest, WikiOperation (union type)

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **463 isolated node(s):** `ViewState`, `CallSite`, `ParseWithRetryArgs`, `ParseWithRetryResult`, `WikiController.format` (+458 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VaultTools` connect `Community 27` to `Community 32`, `Init Phase Tests`, `AgentRunner Integration Tests`, `Ingest Phase + Tests`, `Wiki Path + Init Helpers`, `Community 45`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 21`, `Community 25`, `Community 29`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `RunEvent` connect `Community 16` to `Domain Store + Events`, `AgentRunner Integration Tests`, `Community 37`, `Ingest Phase + Tests`, `Wiki Path + Init Helpers`, `Community 36`, `WikiGraph + GraphCache`, `Community 15`, `Community 17`, `Community 24`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `LlmClient` connect `Community 17` to `Community 32`, `Init Phase Tests`, `AgentRunner Integration Tests`, `Community 37`, `Ingest Phase + Tests`, `Wiki Path + Init Helpers`, `Community 36`, `Community 15`, `Community 16`, `Community 18`, `Community 21`, `Community 25`, `Community 29`, `Community 31`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `ViewState`, `CallSite`, `ParseWithRetryArgs` to the rest of the system?**
  _463 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `WikiController + View Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Init Phase Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Obsidian API Mocks` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._