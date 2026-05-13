# Graph Report - .  (2026-05-13)

## Corpus Check
- 917 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 917 nodes · 1449 edges · 88 communities (57 shown, 31 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Controller & Vault Tools|Controller & Vault Tools]]
- [[_COMMUNITY_Obsidian API Mocks & Tests|Obsidian API Mocks & Tests]]
- [[_COMMUNITY_BFS Query Phase|BFS Query Phase]]
- [[_COMMUNITY_Plugin Dev Rules|Plugin Dev Rules]]
- [[_COMMUNITY_DSPy Optimization Scripts|DSPy Optimization Scripts]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_Live View UI|Live View UI]]
- [[_COMMUNITY_Lint Phase & Graph Checks|Lint Phase & Graph Checks]]
- [[_COMMUNITY_Claude CLI Client|Claude CLI Client]]
- [[_COMMUNITY_Agent Runner & i18n|Agent Runner & i18n]]
- [[_COMMUNITY_Ingest Phase|Ingest Phase]]
- [[_COMMUNITY_Chat, Evaluator & LLM Utils|Chat, Evaluator & LLM Utils]]
- [[_COMMUNITY_DSPy Optimizer & Signatures|DSPy Optimizer & Signatures]]
- [[_COMMUNITY_Build Config & Fixtures|Build Config & Fixtures]]
- [[_COMMUNITY_Plugin Entry Points & Types|Plugin Entry Points & Types]]
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
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
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

## God Nodes (most connected - your core abstractions)
1. `I18n` - 41 edges
2. `VaultTools` - 32 edges
3. `WikiController` - 31 edges
4. `LlmWikiView` - 31 edges
5. `DomainEntry` - 26 edges
6. `LlmClient` - 17 edges
7. `RunEvent` - 16 edges
8. `obsidian-plugin-dev Skill` - 15 edges
9. `buildChatParams()` - 13 edges
10. `runQuery` - 13 edges

## Surprising Connections (you probably didn't know these)
- `requestUrl()` --calls--> `mobileFetch()`  [INFERRED]
  vitest.mock.ts → src/mobile-fetch.ts
- `Prompt placeholder syntax: {{variable}} for runtime template substitution` --conceptually_related_to--> `DSPy MIPROv2: automated prompt optimization via Optuna`  [EXTRACTED]
  prompts/ingest.md → scripts/dspy/README.md
- `bfsExpand` --references--> `query.test`  [INFERRED]
  src/wiki-graph.ts → tests/phases/query.test.ts
- `checkGraphStructure` --references--> `lint.test`  [INFERRED]
  src/wiki-graph.ts → tests/phases/lint.test.ts
- `runQuery` --references--> `query.test`  [EXTRACTED]
  src/phases/query.ts → tests/phases/query.test.ts

## Communities (88 total, 31 thin omitted)

### Community 0 - "Controller & Vault Tools"
Cohesion: 0.08
Nodes (8): toVaultPath(), WikiController, resolveEffective(), I18n, AddDomainModal, attachFolderDropdown(), EditDomainModal, WikiQuestionModal

### Community 1 - "Obsidian API Mocks & Tests"
Cohesion: 0.05
Nodes (25): AbstractInputSuggest, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl(), makeElWithText() (+17 more)

### Community 2 - "BFS Query Phase"
Cohesion: 0.07
Nodes (31): allPageIds, buildContextBlock(), contextBlock, entityTypesBlock, files, graph, keywordSeeds(), messages (+23 more)

### Community 3 - "Plugin Dev Rules"
Cohesion: 0.06
Nodes (37): Use activeDocument/activeWindow Not Global document, Obsidian API Usage Rules, add*/register* Methods Provide Auto-cleanup on onunload, Automated Security Scan on Every Release, Minimize Bundle Size — No Heavy Deps Without Reason, Command ID and Name Naming Conventions, Commands and UI Rules, community-plugins.json Entry Format (5 keys) (+29 more)

### Community 4 - "DSPy Optimization Scripts"
Cohesion: 0.09
Nodes (20): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+12 more)

### Community 5 - "Format Phase"
Cohesion: 0.09
Nodes (29): baseParams, lastSlash, messages, missing, parsed, { reasoning, content }, retryMessages, retryParams (+21 more)

### Community 6 - "Live View UI"
Cohesion: 0.09
Nodes (5): LlmWikiView, registerLinkHandler(), summariseInput(), translateSystemEvent(), truncate()

### Community 7 - "Lint Phase & Graph Checks"
Cohesion: 0.06
Nodes (27): absWiki, allIssues, backlinks, { content }, diffReport, entityTypesBlock, existingArticles, files (+19 more)

### Community 8 - "Claude CLI Client"
Cohesion: 0.08
Nodes (22): ClaudeCliClient, cfg, chunks, client, createPromise, ctrl, largeSystem, largeText (+14 more)

### Community 9 - "Agent Runner & i18n"
Cohesion: 0.13
Nodes (29): AgentRunner, buildOptsFor, runOperation, writeDevLog, i18n, actualizeDomainConfig, buildFixMessages, checkStructure (+21 more)

### Community 10 - "Ingest Phase"
Cohesion: 0.09
Nodes (23): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), domain, existingArticles, mergedArticles (+15 more)

### Community 11 - "Chat, Evaluator & LLM Utils"
Cohesion: 0.14
Nodes (15): messages, params, { reasoning, content }, start, systemContent, parseEvalResponse(), actualizeDomainConfig(), buildChatParams() (+7 more)

### Community 12 - "DSPy Optimizer & Signatures"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 13 - "Build Config & Fixtures"
Cohesion: 0.12
Nodes (22): AgentRunner, ClaudeCliClient, esbuild.config.mjs, tests/fixtures/stream-ingest.jsonl, iclaude.sh, LlmWikiView, main.ts, tests/fixtures/mock-iclaude.sh (+14 more)

### Community 14 - "Plugin Entry Points & Types"
Cohesion: 0.23
Nodes (15): DomainEntry, ChatMessage, ClaudeOperationConfig, DEFAULT_SETTINGS, LlmWikiPluginSettings, NativeOperationConfig, OnFileError, OpKey (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (9): AddDomainInput, EntityType, en, es, locales, ru, BusyCloseModal, ConfirmModal (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (17): adapter, collect(), configJson, createMock, domain, domainA, domainB, ev (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (15): absWiki, errors, files, fixedPages, messages, META_FILES, params, { reasoning, content } (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (15): adapter, collect(), domainCreated, existingDomain, indexCall, indexWrite, logCall, makeLlm() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (14): appendLog(), dryRun, existing, match, messages, params, { reasoning, content }, sampleFiles (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (13): adapter, collect(), domain, domainWithoutPath, ev, failEvent, llmResponse, makeLlm() (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (11): adapter, blocks, callArgs, create, ctrl, history, json, llm (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.19
Nodes (8): applyDomainEvent(), DomainPersistEvent, validateDomainId(), consolidateSourcePaths(), base, input, result, start

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (7): DomainCorruptError, DomainStore, adapter, calls, sampleDomain, store, stored

### Community 26 - "Community 26"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (10): VaultAdapter, adapter, baseSettings, collect(), ctrl, json, makeLlm(), mockAdapter() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.23
Nodes (7): runIngest() phase, raw-frontmatter tests, hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), raw-frontmatter utility, upsertRawFrontmatter()

### Community 30 - "Community 30"
Cohesion: 0.2
Nodes (10): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+2 more)

### Community 31 - "Community 31"
Cohesion: 0.23
Nodes (12): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, Prompt placeholder syntax: {{variable}} for runtime template substitution, DSPy Prompt Optimizer README, Base Prompt Template, Chat Prompt Template, Evaluator Prompt Template, Fix Prompt Template (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (9): buildProxyUrl(), createProxyDispatcher(), createProxyFetch(), maskProxyUrl(), parseNoProxy(), shouldBypass(), d, f (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (4): FileErrorModal, domain, m, onSave

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (9): build(), { ctrl }, { ctrl, app }, { ctrl, dispatchSpy }, domain, makeApp(), makeDomainStore(), makeLocalConfigStore() (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (8): buildWikiFields(), hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), removeWikiFields(), ARTICLES, result, upsertRawFrontmatter()

### Community 36 - "Community 36"
Cohesion: 0.44
Nodes (7): isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate(), loadFixture()

### Community 37 - "Community 37"
Cohesion: 0.28
Nodes (6): EffectiveSettings, DEFAULTS, LocalConfig, ProxyConfig, eff, proxy

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (8): MIPROv2 prompt optimization pattern, load_examples, optimize.py main(), call_evaluator, restore_placeholders, run_mipro, make_signature, WikiOperation (DSPy Signature)

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (4): detectDomain(), extractParentSourcePath(), domains, result

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (3): migrateDomainWikiFolder(), changed, domains

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 46 - "Community 46"
Cohesion: 0.5
Nodes (5): ClaudeCodeLM, dspy.BaseLM, make_lm(), DSPY_BACKEND env var, test_backend (ClaudeCodeLM / make_lm tests)

### Community 47 - "Community 47"
Cohesion: 0.4
Nodes (5): EvalResult, parseEvalResponse, runEvaluator, Non-fatal evaluator: quality scoring that never blocks main flow, tests for parseEvalResponse

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (4): Stream-JSON protocol, parseStreamLine, loadFixture, parseStreamLine (test)

### Community 50 - "Community 50"
Cohesion: 0.5
Nodes (4): Fact Preservation Invariant (no add/delete/distort facts), Format Schema (правила форматирования не-wiki страниц), Frontmatter Rules, Document Structure Rules (H1, sections, hierarchy)

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (3): domainWikiFolder, domainWikiFolder (test), WIKI_ROOT constant (!Wiki)

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (3): historyLimit, settings.ts, tests/settings.test.ts

## Knowledge Gaps
- **356 isolated node(s):** `App`, `Plugin`, `Platform`, `TAbstractFile`, `TFolder` (+351 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainEntry` connect `Plugin Entry Points & Types` to `Community 33`, `Community 34`, `BFS Query Phase`, `Lint Phase & Graph Checks`, `Community 42`, `Ingest Phase`, `Community 44`, `Chat, Evaluator & LLM Utils`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 23`, `Community 24`, `Community 30`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `DSPy Optimization Scripts` to `Community 37`, `Plugin Entry Points & Types`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `main()` connect `DSPy Optimization Scripts` to `Community 26`, `DSPy Optimizer & Signatures`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `App`, `Plugin`, `Platform` to the rest of the system?**
  _356 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Controller & Vault Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Obsidian API Mocks & Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `BFS Query Phase` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._