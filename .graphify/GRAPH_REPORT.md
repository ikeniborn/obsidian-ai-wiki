# Graph Report - .  (2026-05-14)

## Corpus Check
- 16 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 971 nodes · 1498 edges · 105 communities (61 shown, 44 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_WikiController Core|WikiController Core]]
- [[_COMMUNITY_Obsidian Mocks & Test Infra|Obsidian Mocks & Test Infra]]
- [[_COMMUNITY_Claude CLI Client & Stream Tests|Claude CLI Client & Stream Tests]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_Query Phase|Query Phase]]
- [[_COMMUNITY_AgentRunner & Integration Tests|AgentRunner & Integration Tests]]
- [[_COMMUNITY_LlmWikiView UI|LlmWikiView UI]]
- [[_COMMUNITY_DSPy Optimization Scripts|DSPy Optimization Scripts]]
- [[_COMMUNITY_Lint Phase|Lint Phase]]
- [[_COMMUNITY_Ingest Phase|Ingest Phase]]
- [[_COMMUNITY_Init Phase & Tests|Init Phase & Tests]]
- [[_COMMUNITY_Chat Phase & LLM Utils|Chat Phase & LLM Utils]]
- [[_COMMUNITY_DSPy Optimizer & Signatures|DSPy Optimizer & Signatures]]
- [[_COMMUNITY_Claude CLI & Build Config|Claude CLI & Build Config]]
- [[_COMMUNITY_Lint Tests|Lint Tests]]
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
- [[_COMMUNITY_Community 52|Community 52]]
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
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]

## God Nodes (most connected - your core abstractions)
1. `I18n` - 41 edges
2. `VaultTools` - 33 edges
3. `LlmWikiView` - 33 edges
4. `WikiController` - 31 edges
5. `DomainEntry` - 25 edges
6. `LlmClient` - 17 edges
7. `RunEvent` - 15 edges
8. `buildChatParams()` - 12 edges
9. `EditDomainModal` - 11 edges
10. `AgentRunner` - 10 edges

## Surprising Connections (you probably didn't know these)
- `requestUrl()` --calls--> `mobileFetch()`  [INFERRED]
  vitest.mock.ts → src/mobile-fetch.ts
- `query.test` --references--> `runQuery`  [EXTRACTED]
  tests/phases/query.test.ts → src/phases/query.ts
- `query.test` --references--> `bfsExpand`  [INFERRED]
  tests/phases/query.test.ts → src/wiki-graph.ts
- `lint.test` --references--> `runLint`  [EXTRACTED]
  tests/phases/lint.test.ts → src/phases/lint.ts
- `lint.test` --references--> `checkGraphStructure`  [INFERRED]
  tests/phases/lint.test.ts → src/wiki-graph.ts

## Communities (105 total, 44 thin omitted)

### Community 0 - "WikiController Core"
Cohesion: 0.07
Nodes (17): toVaultPath(), WikiController, resolveEffective(), I18n, AddDomainModal, attachFolderDropdown(), EditDomainModal, buildProxyUrl() (+9 more)

### Community 1 - "Obsidian Mocks & Test Infra"
Cohesion: 0.05
Nodes (26): AbstractInputSuggest, activeDocument, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl() (+18 more)

### Community 2 - "Claude CLI Client & Stream Tests"
Cohesion: 0.07
Nodes (30): ClaudeCliClient, ClaudeCliConfig, isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate() (+22 more)

### Community 3 - "Format Phase"
Cohesion: 0.07
Nodes (37): baseParams, lastSlash, messages, missing1, missing2, missingFinal, parsed, parsed2 (+29 more)

### Community 4 - "Query Phase"
Cohesion: 0.07
Nodes (32): allPageIds, buildContextBlock(), contextBlock, entityTypesBlock, files, graph, keywordSeeds(), messages (+24 more)

### Community 5 - "AgentRunner & Integration Tests"
Cohesion: 0.06
Nodes (32): AgentRunner class, agent-runner.integration.test.ts — AgentRunner integration tests, applyDomainEvent function, apply-domain-event.test.ts — applyDomainEvent tests, Backlinks frontmatter (wiki_added, wiki_updated, wiki_articles) written to raw source after ingest, controller-build-fail.test.ts — buildAgentRunner failure notice test, controller-log-adapter.test.ts — vault adapter logEvent tests, detectDomain function (+24 more)

### Community 6 - "LlmWikiView UI"
Cohesion: 0.09
Nodes (6): LlmWikiView, registerLinkHandler(), sanitizeLinks(), summariseInput(), translateSystemEvent(), truncate()

### Community 7 - "DSPy Optimization Scripts"
Cohesion: 0.09
Nodes (20): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+12 more)

### Community 8 - "Lint Phase"
Cohesion: 0.06
Nodes (28): absWiki, allIssues, backlinks, { content }, diffReport, entityTypesBlock, existingArticles, files (+20 more)

### Community 9 - "Ingest Phase"
Cohesion: 0.08
Nodes (25): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), domain, existingArticles, mergedArticles (+17 more)

### Community 10 - "Init Phase & Tests"
Cohesion: 0.13
Nodes (22): runInit (test .js), runInit, runInitWithSources, adapter, collect(), domainCreated, existingDomain, indexCall (+14 more)

### Community 11 - "Chat Phase & LLM Utils"
Cohesion: 0.11
Nodes (17): messages, params, { reasoning, content }, start, systemContent, EvalResult, messages, params (+9 more)

### Community 12 - "DSPy Optimizer & Signatures"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 13 - "Claude CLI & Build Config"
Cohesion: 0.12
Nodes (22): AgentRunner, ClaudeCliClient, esbuild.config.mjs, tests/fixtures/stream-ingest.jsonl, iclaude.sh, LlmWikiView, main.ts, tests/fixtures/mock-iclaude.sh (+14 more)

### Community 14 - "Lint Tests"
Cohesion: 0.1
Nodes (19): adapter, collect(), configJson, createMock, domain, domainA, domainB, ev (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (14): adapter, blocks, callArgs, create, ctrl, history, json, json1 (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (11): EffectiveSettings, DEFAULTS, LocalConfig, ProxyConfig, parseTimeoutString(), DEFAULT_SETTINGS, LlmWikiPluginSettings, eff (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.16
Nodes (10): AgentRunner, adapter, baseSettings, collect(), ctrl, json, makeLlm(), mockAdapter() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (6): AddDomainInput, EntityType, BusyCloseModal, ConfirmModal, DomainModal, QueryModal

### Community 20 - "Community 20"
Cohesion: 0.23
Nodes (13): ChatMessage, ClaudeOperationConfig, LlmCallOptions, NativeOperationConfig, OnFileError, OpKey, OpMap, RunEvent (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (15): appendLog(), dryRun, existing, existingDomain, match, messages, params, { reasoning, content } (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.21
Nodes (16): actualizeDomainConfig, buildFixMessages, checkStructure, runLint, buildContextBlock, keywordSeeds, llmSelectSeeds, runQuery (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (13): adapter, collect(), domain, domainWithoutPath, ev, failEvent, llmResponse, makeLlm() (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.16
Nodes (8): DomainEntry, DomainCorruptError, DomainStore, adapter, calls, sampleDomain, store, stored

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (11): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (8): applyDomainEvent(), DomainPersistEvent, validateDomainId(), consolidateSourcePaths(), base, input, result, start

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.23
Nodes (12): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, Prompt placeholder syntax: {{variable}} for runtime template substitution, DSPy Prompt Optimizer README, Base Prompt Template, Chat Prompt Template, Evaluator Prompt Template, Fix Prompt Template (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (4): FileErrorModal, domain, m, onSave

### Community 32 - "Community 32"
Cohesion: 0.31
Nodes (9): patchWikiFields(), buildWikiFields(), hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), removeWikiFields(), ARTICLES, result (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (9): buildProxyUrl function, createProxyDispatcher function, createProxyFetch function, maskProxyUrl function, Mobile compatibility guard (no top-level node:* imports), no-fs-imports.test.ts — mobile hot path guard, parseNoProxy function, proxy.test.ts — proxy utility function tests (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (8): MIPROv2 prompt optimization pattern, load_examples, optimize.py main(), call_evaluator, restore_placeholders, run_mipro, make_signature, WikiOperation (DSPy Signature)

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 38 - "Community 38"
Cohesion: 0.6
Nodes (5): build(), makeApp(), makeDomainStore(), makeLocalConfigStore(), makePlugin()

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (4): detectDomain(), extractParentSourcePath(), domains, result

### Community 40 - "Community 40"
Cohesion: 0.53
Nodes (6): raw-frontmatter tests, hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), raw-frontmatter utility, upsertRawFrontmatter()

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 42 - "Community 42"
Cohesion: 0.4
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (4): en, es, locales, ru

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (3): migrateDomainWikiFolder(), changed, domains

### Community 45 - "Community 45"
Cohesion: 0.5
Nodes (5): ClaudeCodeLM, dspy.BaseLM, make_lm(), DSPY_BACKEND env var, test_backend (ClaudeCodeLM / make_lm tests)

### Community 46 - "Community 46"
Cohesion: 0.4
Nodes (5): DomainEntry, DomainStore, LocalConfigStore, Local vs Synced Settings Split, runLintChat

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (4): ClaudeCliClient class, claude-cli-client.test.ts — ClaudeCliClient streaming/spawn tests, Large payload file strategy (>256KB uses tmp files), Session resume strategy (--resume flag, skip --system-prompt)

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 49 - "Community 49"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (3): domain.test.ts — validateDomainId tests, domain.test.js — JS duplicate of validateDomainId tests, validateDomainId function

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (3): applyDomainEvent, consolidateSourcePaths, consolidateSourcePaths (test)

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (3): buildProxyUrl, createProxyDispatcher, createProxyFetch

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (3): domainWikiFolder, domainWikiFolder (test), WIKI_ROOT constant (!Wiki)

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (3): historyLimit, settings.ts, tests/settings.test.ts

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **380 isolated node(s):** `activeDocument`, `App`, `Plugin`, `Platform`, `TAbstractFile` (+375 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **44 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainEntry` connect `Community 25` to `Query Phase`, `Community 38`, `Community 39`, `Lint Phase`, `Ingest Phase`, `Init Phase & Tests`, `Chat Phase & LLM Utils`, `Community 44`, `Lint Tests`, `Community 16`, `Community 17`, `Community 19`, `Community 20`, `Community 21`, `Community 24`, `Community 26`, `Community 28`, `Community 31`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `DSPy Optimization Scripts` to `Community 17`, `Community 20`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `main()` connect `DSPy Optimization Scripts` to `Community 27`, `DSPy Optimizer & Signatures`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **What connects `activeDocument`, `App`, `Plugin` to the rest of the system?**
  _380 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `WikiController Core` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Obsidian Mocks & Test Infra` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Claude CLI Client & Stream Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._