# Graph Report - .  (2026-05-17)

## Corpus Check
- 4 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1095 nodes · 1720 edges · 77 communities (55 shown, 22 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Query & Seed Selection|Query & Seed Selection]]
- [[_COMMUNITY_LLM Client & Streaming|LLM Client & Streaming]]
- [[_COMMUNITY_Vault & File Tools|Vault & File Tools]]
- [[_COMMUNITY_Settings & Config|Settings & Config]]
- [[_COMMUNITY_Agent Runner & Phases|Agent Runner & Phases]]
- [[_COMMUNITY_View & UI|View & UI]]
- [[_COMMUNITY_Graph & Wiki Cache|Graph & Wiki Cache]]
- [[_COMMUNITY_Stream Parsing|Stream Parsing]]
- [[_COMMUNITY_Controller Logic|Controller Logic]]
- [[_COMMUNITY_Testing Infrastructure|Testing Infrastructure]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
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
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]

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

## Communities (77 total, 22 thin omitted)

### Community 0 - "Query & Seed Selection"
Cohesion: 0.05
Nodes (55): EvalResult, messages, params, parseEvalResponse(), userContent, appendLog(), buildEntityTypesBlock(), buildIngestMessages() (+47 more)

### Community 1 - "LLM Client & Streaming"
Cohesion: 0.04
Nodes (51): ac, adapter, bootstrapDomainJson, bootstrapJson, bootstrapUpdate, concept, created, current (+43 more)

### Community 2 - "Vault & File Tools"
Cohesion: 0.05
Nodes (31): AbstractInputSuggest, activeDocument, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl() (+23 more)

### Community 3 - "Settings & Config"
Cohesion: 0.05
Nodes (36): ac, baseArgs, calls, ev, events, fail, fb, llm (+28 more)

### Community 4 - "Agent Runner & Phases"
Cohesion: 0.06
Nodes (39): ClaudeCliClient, ClaudeCliConfig, isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate() (+31 more)

### Community 5 - "View & UI"
Cohesion: 0.06
Nodes (26): applyDomainEvent(), migrateDomainsV2(), DomainCorruptError, DomainStore, validateDomainId(), migrateDomainWikiFolder(), consolidateSourcePaths(), base (+18 more)

### Community 6 - "Graph & Wiki Cache"
Cohesion: 0.05
Nodes (37): parseJsonPages(), absWiki, allIssues, backlinks, { content, outputTokens: tok }, diffReport, entityTypesBlock, existingArticles (+29 more)

### Community 7 - "Stream Parsing"
Cohesion: 0.05
Nodes (31): alreadyAnalyzed, appendLog(), collected, delta, dryRun, existing, existingDomain, force (+23 more)

### Community 8 - "Controller Logic"
Cohesion: 0.08
Nodes (6): LlmWikiView, registerLinkHandler(), sanitizeLinks(), summariseInput(), translateSystemEvent(), truncate()

### Community 9 - "Testing Infrastructure"
Cohesion: 0.06
Nodes (38): AgentRunner, AgentRunner.buildOptsFor, AgentRunner.run, AgentRunner.runOperation, AgentRunner.writeDevLog, WikiController.buildAgentRunner, WikiController.dispatch, WikiController.dispatchChat (+30 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (21): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+13 more)

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (30): AgentRunner, ClaudeCliClient, GraphCache, LlmWikiView, obsidian-llm-wiki Plugin, parseStreamLine, selectSeeds, Settings / autodetectCwd (+22 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (24): allPageIds, contextBlock, entityTypesBlock, files, { graph, fromCache }, messages, META_FILES, minScore (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (13): EffectiveSettings, resolveEffective(), en, es, locales, ru, DEFAULTS, LocalConfig (+5 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (21): adapter, collect(), configJson, createMock, dom, domain, domainA, domainB (+13 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (21): appendMissingLines(), escapeRawControlsInStrings(), escapeRegExp(), extractJsonObject(), FormatResponse, lemmas(), looksTruncated(), MissingToken (+13 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (5): BusyCloseModal, ConfirmModal, DomainModal, FolderInputSuggest, QueryModal

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (14): adapter, blocks, callArgs, create, ctrl, history, json, json1 (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (3): I18n, AddDomainModal, EditDomainModal

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (9): patchWikiFields(), toVaultPath(), ChatMessage, OnFileError, RunHistoryEntry, WikiOperation, ViewState, WikiQuestionModal (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (11): blocked, domain, events, llm, llmResponse, pages, req, resultEvent (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (12): buildContextBlock(), pageId(), scoreSeed(), selectSeeds(), STOP_WORDS, tokenize(), big, pages (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (7): buildWikiGraph(), CacheEntry, GraphCache, hashPages(), WikiGraph, p, r

### Community 28 - "Community 28"
Cohesion: 0.23
Nodes (12): build(), DOMAIN, domain2, invalidateSpy, makeApp(), makeDomainStore(), makeLocalConfigStore(), makePlugin() (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (11): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (9): buildProxyUrl(), createProxyDispatcher(), createProxyFetch(), maskProxyUrl(), parseNoProxy(), shouldBypass(), d, f (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (6): wrapMobileNoStream(), callArgs, completion, createMock, inner, wrapped

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (9): ctx, domain, events, { llm, getCapturedMessages }, makeAdapterWithPages(), mockAdapter(), noisePages, pages (+1 more)

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (10): askBtn, askSaveBtn, cancelBtn, finalEl, finishedAt, progressCount, resultSection, resultToggle (+2 more)

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (8): adapter, domain, events, llm, updates, VALID_PATCH_JSON, vt, withTypes

### Community 36 - "Community 36"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.2
Nodes (9): DomainEntryResponse, DomainEntrySchema, EntityTypeSchema, EntityTypesDeltaResponse, EntityTypesDeltaSchema, LintChatResponse, LintChatSchema, SeedsResponse (+1 more)

### Community 38 - "Community 38"
Cohesion: 0.32
Nodes (6): bfsExpand(), checkGraphStructure(), graph, pages, result, targets

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): collect(), makeLlm(), mockAdapter(), mockAdapterWithSources()

### Community 45 - "Community 45"
Cohesion: 0.6
Nodes (3): collect(), makeLlm(), mockAdapter()

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (4): format.md (LLM prompt), _format_schema.md (template), _wiki_schema.md (template), wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (4): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, DSPy Prompt Optimizer README, Evaluator Prompt Template

### Community 50 - "Community 50"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (3): ChatMessage, RunRequest, WikiOperation (union type)

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **448 isolated node(s):** `ViewState`, `CallSite`, `ParseWithRetryArgs`, `ParseWithRetryResult`, `META_FILES` (+443 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VaultTools` connect `Community 24` to `Query & Seed Selection`, `Community 33`, `LLM Client & Streaming`, `Settings & Config`, `Community 35`, `Graph & Wiki Cache`, `Stream Parsing`, `Community 44`, `Community 45`, `Community 46`, `Community 15`, `Community 12`, `Community 20`, `Community 22`, `Community 29`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `Community 10` to `Community 22`, `Community 14`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `RunEvent` connect `Query & Seed Selection` to `Settings & Config`, `Agent Runner & Phases`, `View & UI`, `Graph & Wiki Cache`, `Stream Parsing`, `Community 12`, `Community 22`, `Community 28`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **What connects `ViewState`, `CallSite`, `ParseWithRetryArgs` to the rest of the system?**
  _448 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Query & Seed Selection` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `LLM Client & Streaming` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Vault & File Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._