# Graph Report - .  (2026-05-13)

## Corpus Check
- 117 files · ~90,335 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1145 nodes · 2493 edges · 97 communities (62 shown, 35 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Test Suite & Vault Tools|Test Suite & Vault Tools]]
- [[_COMMUNITY_Controller & Proxy|Controller & Proxy]]
- [[_COMMUNITY_Core Domain & LLM Client|Core Domain & LLM Client]]
- [[_COMMUNITY_Mobile & Test Infrastructure|Mobile & Test Infrastructure]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_Lint & Frontmatter|Lint & Frontmatter]]
- [[_COMMUNITY_Query & Wiki Graph|Query & Wiki Graph]]
- [[_COMMUNITY_UI Layer|UI Layer]]
- [[_COMMUNITY_Domain Store & Source Paths|Domain Store & Source Paths]]
- [[_COMMUNITY_Agent Runner|Agent Runner]]
- [[_COMMUNITY_Ingest Phase|Ingest Phase]]
- [[_COMMUNITY_CLI Client Tests|CLI Client Tests]]
- [[_COMMUNITY_Wiki View|Wiki View]]
- [[_COMMUNITY_DSPy Optimization|DSPy Optimization]]
- [[_COMMUNITY_DSPy Optimizer|DSPy Optimizer]]
- [[_COMMUNITY_Integration Tests|Integration Tests]]
- [[_COMMUNITY_Agent Fixtures|Agent Fixtures]]
- [[_COMMUNITY_Fix Phase|Fix Phase]]
- [[_COMMUNITY_Plugin Settings|Plugin Settings]]
- [[_COMMUNITY_Plugin Main|Plugin Main]]
- [[_COMMUNITY_Fix Phase Logic|Fix Phase Logic]]
- [[_COMMUNITY_Init Phase|Init Phase]]
- [[_COMMUNITY_Core Types|Core Types]]
- [[_COMMUNITY_DSPy Backend|DSPy Backend]]
- [[_COMMUNITY_Chat & LLM Utils|Chat & LLM Utils]]
- [[_COMMUNITY_Backlinks & Ingest Utils|Backlinks & Ingest Utils]]
- [[_COMMUNITY_Evaluator & Template|Evaluator & Template]]
- [[_COMMUNITY_Stream Parser|Stream Parser]]
- [[_COMMUNITY_Domain Modals|Domain Modals]]
- [[_COMMUNITY_DSPy Dev Tools|DSPy Dev Tools]]
- [[_COMMUNITY_Domain Event System|Domain Event System]]
- [[_COMMUNITY_Prompts & Concepts|Prompts & Concepts]]
- [[_COMMUNITY_LLM Client Types|LLM Client Types]]
- [[_COMMUNITY_Format Preview & UI|Format Preview & UI]]
- [[_COMMUNITY_Config Store|Config Store]]
- [[_COMMUNITY_Legal & External|Legal & External]]
- [[_COMMUNITY_Settings UI|Settings UI]]
- [[_COMMUNITY_Proxy Utils|Proxy Utils]]
- [[_COMMUNITY_DSPy MIPROv2|DSPy MIPROv2]]
- [[_COMMUNITY_Format Controller Tests|Format Controller Tests]]
- [[_COMMUNITY_i18n|i18n]]
- [[_COMMUNITY_Domain Migration|Domain Migration]]
- [[_COMMUNITY_Domain Event Tests|Domain Event Tests]]
- [[_COMMUNITY_FS Import Guard|FS Import Guard]]
- [[_COMMUNITY_Mobile Command Tests|Mobile Command Tests]]
- [[_COMMUNITY_Evaluator Logic|Evaluator Logic]]
- [[_COMMUNITY_DSPy LM Backend|DSPy LM Backend]]
- [[_COMMUNITY_Vitest Config|Vitest Config]]
- [[_COMMUNITY_Format Migration Tests|Format Migration Tests]]
- [[_COMMUNITY_Init Args Tests|Init Args Tests]]
- [[_COMMUNITY_DSPy Env Config|DSPy Env Config]]
- [[_COMMUNITY_Large Payload Strategy|Large Payload Strategy]]
- [[_COMMUNITY_Obsidian Screenshots|Obsidian Screenshots]]
- [[_COMMUNITY_Wiki Path Utils|Wiki Path Utils]]
- [[_COMMUNITY_Settings Tests|Settings Tests]]
- [[_COMMUNITY_Domain Validation|Domain Validation]]
- [[_COMMUNITY_Plugin Guidelines|Plugin Guidelines]]
- [[_COMMUNITY_Vault Tools Tests|Vault Tools Tests]]
- [[_COMMUNITY_DSPy Writer|DSPy Writer]]
- [[_COMMUNITY_Effective Settings|Effective Settings]]
- [[_COMMUNITY_Mobile Fetch|Mobile Fetch]]
- [[_COMMUNITY_Settings Resolution|Settings Resolution]]
- [[_COMMUNITY_DSPy Loader Test|DSPy Loader Test]]
- [[_COMMUNITY_DSPy Signature Test|DSPy Signature Test]]
- [[_COMMUNITY_Wiki Operation Type|Wiki Operation Type]]
- [[_COMMUNITY_LLM Utils Extract|LLM Utils Extract]]
- [[_COMMUNITY_Agent Runner JS|Agent Runner JS]]
- [[_COMMUNITY_CLI Client Test|CLI Client Test]]
- [[_COMMUNITY_Modals Test|Modals Test]]
- [[_COMMUNITY_Stream Test JS|Stream Test JS]]
- [[_COMMUNITY_Template Render Test|Template Render Test]]
- [[_COMMUNITY_LLM Utils Chat Test|LLM Utils Chat Test]]
- [[_COMMUNITY_Init Args Derive|Init Args Derive]]
- [[_COMMUNITY_Init Args Parse|Init Args Parse]]
- [[_COMMUNITY_Wiki Path Root Test|Wiki Path Root Test]]
- [[_COMMUNITY_Ingest JS|Ingest JS]]
- [[_COMMUNITY_Ingest Source Path JS|Ingest Source Path JS]]
- [[_COMMUNITY_Lint JS|Lint JS]]
- [[_COMMUNITY_Query JS|Query JS]]
- [[_COMMUNITY_Optimizer MIPROv2 Test|Optimizer MIPROv2 Test]]
- [[_COMMUNITY_DSPy CLAUDE|DSPy CLAUDE.md]]
- [[_COMMUNITY_Vitest Mock|Vitest Mock]]
- [[_COMMUNITY_ESBuild Config Build|ESBuild Config Build]]
- [[_COMMUNITY_Domain Store Error|Domain Store Error]]
- [[_COMMUNITY_Wiki Question Modal|Wiki Question Modal]]
- [[_COMMUNITY_DSPy Lib Init 2|DSPy Lib Init 2]]
- [[_COMMUNITY_DSPy Tests Init 2|DSPy Tests Init 2]]

## God Nodes (most connected - your core abstractions)
1. `VaultTools` - 54 edges
2. `DomainEntry` - 52 edges
3. `I18n` - 47 edges
4. `WikiController` - 35 edges
5. `LlmClient` - 34 edges
6. `LlmWikiView` - 34 edges
7. `RunEvent` - 32 edges
8. `buildChatParams()` - 23 edges
9. `LlmCallOptions` - 22 edges
10. `render()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `runFormat()` --references--> `format.md (LLM prompt)`  [INFERRED]
  src/phases/format.ts → prompts/format.md
- `LocalConfigStore` --rationale_for--> `local.json stores machine-specific path (iclaudePath) outside Obsidian settings to avoid sync conflicts`  [EXTRACTED]
  src/local-config.ts → README.md
- `runIngest() phase` --shares_data_with--> `Backlinks frontmatter (wiki_added, wiki_updated, wiki_articles) written to raw source after ingest`  [INFERRED]
  src/phases/ingest.ts → tests/phases/ingest.test.ts
- `runFormat phase` --conceptually_related_to--> `format-migration.test.ts — settings migration for format operation`  [INFERRED]
  src/phases/format.ts → tests/format-migration.test.ts
- `WikiController` --rationale_for--> `wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting`  [EXTRACTED]
  src/controller.ts → templates/_format_schema.md

## Communities (97 total, 35 thin omitted)

### Community 0 - "Test Suite & Vault Tools"
Cohesion: 0.05
Nodes (60): adapter, blocks, callArgs, collect(), create, ctrl, history, json (+52 more)

### Community 1 - "Controller & Proxy"
Cohesion: 0.07
Nodes (18): WikiController, I18n, EditDomainModal, buildProxyUrl(), createProxyDispatcher(), createProxyFetch(), maskProxyUrl(), parseNoProxy() (+10 more)

### Community 2 - "Core Domain & LLM Client"
Cohesion: 0.05
Nodes (58): ClaudeCliClient, ClaudeCliConfig, WikiController, AddDomainInput, applyDomainEvent, DomainEntry, EntityType, DomainStore (+50 more)

### Community 3 - "Mobile & Test Infrastructure"
Cohesion: 0.06
Nodes (30): AbstractInputSuggest, activeDocument, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl() (+22 more)

### Community 4 - "Format Phase"
Cohesion: 0.1
Nodes (39): baseParams, extractImagePaths(), lastSlash, messages, missing, missing1, missing2, missingFinal (+31 more)

### Community 5 - "Lint & Frontmatter"
Cohesion: 0.1
Nodes (39): absWiki, allIssues, backlinks, buildEntityTypesBlock(), buildFixMessages(), computeEntityDiff(), { content }, diffReport (+31 more)

### Community 6 - "Query & Wiki Graph"
Cohesion: 0.1
Nodes (35): allPageIds, buildContextBlock(), buildEntityTypesBlock(), contextBlock, entityTypesBlock, files, graph, keywordSeeds() (+27 more)

### Community 7 - "UI Layer"
Cohesion: 0.1
Nodes (15): EntityType, AddDomainModal, attachFolderDropdown(), BusyCloseModal, ConfirmModal, DomainModal, QueryModal, RunHistoryEntry (+7 more)

### Community 8 - "Domain Store & Source Paths"
Cohesion: 0.12
Nodes (14): toVaultPath(), AddDomainInput, applyDomainEvent(), DomainPersistEvent, DomainCorruptError, DomainStore, validateDomainId(), consolidateSourcePaths() (+6 more)

### Community 9 - "Agent Runner"
Cohesion: 0.1
Nodes (34): AgentRunner, buildOptsFor, runOperation, writeDevLog, i18n, actualizeDomainConfig, buildFixMessages, checkStructure (+26 more)

### Community 10 - "Ingest Phase"
Cohesion: 0.12
Nodes (29): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), buildIngestSummary(), detectDomain(), domain (+21 more)

### Community 11 - "CLI Client Tests"
Cohesion: 0.12
Nodes (22): ClaudeCliClient, cfg, chunks, client, createPromise, ctrl, largeSystem, largeText (+14 more)

### Community 13 - "DSPy Optimization"
Cohesion: 0.14
Nodes (15): _get(), main(), load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, write_optimized(), _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg() (+7 more)

### Community 14 - "DSPy Optimizer"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 15 - "Integration Tests"
Cohesion: 0.16
Nodes (13): AgentRunner, DEFAULT_SETTINGS, adapter, baseSettings, collect(), ctrl, json, makeLlm() (+5 more)

### Community 16 - "Agent Fixtures"
Cohesion: 0.12
Nodes (22): AgentRunner, ClaudeCliClient, esbuild.config.mjs, tests/fixtures/stream-ingest.jsonl, iclaude.sh, LlmWikiView, main.ts, tests/fixtures/mock-iclaude.sh (+14 more)

### Community 17 - "Fix Phase"
Cohesion: 0.12
Nodes (22): AgentRunner class, agent-runner.integration.test.ts — AgentRunner integration tests, buildFixMessages helper, buildFixSummary helper, checkStructure (from lint phase), controller-build-fail.test.ts — buildAgentRunner failure notice test, extractImagePaths helper, extractJsonObject utility (+14 more)

### Community 18 - "Plugin Settings"
Cohesion: 0.23
Nodes (10): EffectiveSettings, resolveEffective(), DEFAULTS, LocalConfig, LocalConfigStore, ProxyConfig, LlmWikiPluginSettings, adapter (+2 more)

### Community 19 - "Plugin Main"
Cohesion: 0.18
Nodes (14): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+6 more)

### Community 20 - "Fix Phase Logic"
Cohesion: 0.2
Nodes (17): absWiki, buildFixMessages(), buildFixSummary(), errors, files, fixedPages, messages, META_FILES (+9 more)

### Community 21 - "Init Phase"
Cohesion: 0.23
Nodes (15): appendLog(), dryRun, ensureRootFiles(), existing, match, messages, params, { reasoning, content } (+7 more)

### Community 22 - "Core Types"
Cohesion: 0.26
Nodes (11): ClaudeCliConfig, ChatMessage, ClaudeOperationConfig, LlmCallOptions, LlmClient, NativeOperationConfig, OnFileError, OpKey (+3 more)

### Community 23 - "DSPy Backend"
Cohesion: 0.21
Nodes (10): ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., test_call_with_messages(), test_call_with_prompt_string(), test_flatten_combines_messages(), test_make_lm_claude_code() (+2 more)

### Community 24 - "Chat & LLM Utils"
Cohesion: 0.26
Nodes (10): messages, params, { reasoning, content }, start, systemContent, actualizeDomainConfig(), buildChatParams(), extractStreamDeltas() (+2 more)

### Community 25 - "Backlinks & Ingest Utils"
Cohesion: 0.2
Nodes (9): Backlinks frontmatter (wiki_added, wiki_updated, wiki_articles) written to raw source after ingest, runIngest() phase, phases/ingest.test.ts, raw-frontmatter tests, hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), raw-frontmatter utility (+1 more)

### Community 26 - "Evaluator & Template"
Cohesion: 0.22
Nodes (6): EvalResult, messages, params, parseEvalResponse(), userContent, render()

### Community 27 - "Stream Parser"
Cohesion: 0.4
Nodes (8): isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate(), RunEvent, loadFixture()

### Community 28 - "Domain Modals"
Cohesion: 0.23
Nodes (7): DomainEntry, FileErrorModal, domain, m, makeFileErrorModal(), makeModal(), onSave

### Community 29 - "DSPy Dev Tools"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 30 - "Domain Event System"
Cohesion: 0.15
Nodes (13): applyDomainEvent function, apply-domain-event.test.ts — applyDomainEvent tests, detectDomain function, DomainCorruptError class, DomainEntry type, domain-store.test.ts — DomainStore load/save tests, EditDomainModal class, extractParentSourcePath function (+5 more)

### Community 31 - "Prompts & Concepts"
Cohesion: 0.23
Nodes (12): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, Prompt placeholder syntax: {{variable}} for runtime template substitution, DSPy Prompt Optimizer README, Base Prompt Template, Chat Prompt Template, Evaluator Prompt Template, Fix Prompt Template (+4 more)

### Community 32 - "LLM Client Types"
Cohesion: 0.27
Nodes (11): ChatMessage, controller-log-adapter.test.ts — vault adapter logEvent tests, format-sample.md (fixture), LlmClient, runFormat(), format-utils (extractJsonObject, significantTokens, missingTokens), runInit(), phases/format.test.ts (+3 more)

### Community 33 - "Format Preview & UI"
Cohesion: 0.24
Nodes (8): Format Preview Flow — temp file in !Temp/, apply/cancel/refine cycle, LlmWikiPlugin (main.ts), Mobile Guard — ingest/lint/init blocked on mobile, query allowed, format.md (LLM prompt), _format_schema.md (template), _wiki_schema.md (template), WikiController, wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting

### Community 34 - "Config Store"
Cohesion: 0.24
Nodes (8): DomainStore class, DomainStore auto-migration of !Wiki/ prefix on load, LocalConfigStore, local.json stores machine-specific path (iclaudePath) outside Obsidian settings to avoid sync conflicts, migrateLegacyData(), migrateToLocalV1(), migrateLegacyData is idempotent — second run must not call saveData again, native-agent backend (OpenAI-compatible / Ollama)

### Community 35 - "Legal & External"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 37 - "Proxy Utils"
Cohesion: 0.25
Nodes (9): buildProxyUrl function, createProxyDispatcher function, createProxyFetch function, maskProxyUrl function, Mobile compatibility guard (no top-level node:* imports), no-fs-imports.test.ts — mobile hot path guard, parseNoProxy function, proxy.test.ts — proxy utility function tests (+1 more)

### Community 38 - "DSPy MIPROv2"
Cohesion: 0.29
Nodes (8): MIPROv2 prompt optimization pattern, load_examples, optimize.py main(), call_evaluator, restore_placeholders, run_mipro, make_signature, WikiOperation (DSPy Signature)

### Community 39 - "Format Controller Tests"
Cohesion: 0.67
Nodes (5): build(), makeApp(), makeDomainStore(), makeLocalConfigStore(), makePlugin()

### Community 40 - "i18n"
Cohesion: 0.53
Nodes (4): en, es, locales, ru

### Community 41 - "Domain Migration"
Cohesion: 0.53
Nodes (4): migrateDomainWikiFolder(), changed, domains, makeDomain()

### Community 42 - "Domain Event Tests"
Cohesion: 0.53
Nodes (4): base, input, result, start

### Community 43 - "FS Import Guard"
Cohesion: 0.53
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 44 - "Mobile Command Tests"
Cohesion: 0.6
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 45 - "Evaluator Logic"
Cohesion: 0.4
Nodes (5): EvalResult, parseEvalResponse, runEvaluator, Non-fatal evaluator: quality scoring that never blocks main flow, tests for parseEvalResponse

### Community 46 - "DSPy LM Backend"
Cohesion: 0.5
Nodes (5): ClaudeCodeLM, dspy.BaseLM, make_lm(), DSPY_BACKEND env var, test_backend (ClaudeCodeLM / make_lm tests)

### Community 50 - "DSPy Env Config"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 51 - "Large Payload Strategy"
Cohesion: 0.5
Nodes (4): ClaudeCliClient class, claude-cli-client.test.ts — ClaudeCliClient streaming/spawn tests, Large payload file strategy (>256KB uses tmp files), Session resume strategy (--resume flag, skip --system-prompt)

### Community 52 - "Obsidian Screenshots"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 53 - "Wiki Path Utils"
Cohesion: 0.67
Nodes (3): domainWikiFolder, domainWikiFolder (test), WIKI_ROOT constant (!Wiki)

### Community 54 - "Settings Tests"
Cohesion: 0.67
Nodes (3): historyLimit, settings.ts, tests/settings.test.ts

### Community 55 - "Domain Validation"
Cohesion: 1.0
Nodes (3): domain.test.ts — validateDomainId tests, domain.test.js — JS duplicate of validateDomainId tests, validateDomainId function

### Community 56 - "Plugin Guidelines"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **143 isolated node(s):** `Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль`, `DSPy-совместимый LM через claude CLI. Не требует API-ключа.`, `Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv().`, `Stream-JSON protocol`, `WIKI_ROOT constant (!Wiki)` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainEntry` connect `Domain Modals` to `Test Suite & Vault Tools`, `Core Domain & LLM Client`, `Lint & Frontmatter`, `Query & Wiki Graph`, `UI Layer`, `Domain Store & Source Paths`, `Domain Migration`, `Ingest Phase`, `Domain Event Tests`, `Format Controller Tests`, `Plugin Settings`, `Plugin Main`, `Fix Phase Logic`, `Init Phase`, `Core Types`, `Chat & LLM Utils`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `Plugin Settings` to `Domain Store & Source Paths`, `DSPy Optimization`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `main()` connect `DSPy Optimization` to `DSPy Optimizer`, `DSPy Backend`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль`, `DSPy-совместимый LM через claude CLI. Не требует API-ключа.`, `Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv().` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Test Suite & Vault Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Controller & Proxy` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Core Domain & LLM Client` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._