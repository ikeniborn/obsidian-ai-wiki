# Graph Report - .  (2026-05-13)

## Corpus Check
- 1025 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1025 nodes · 1652 edges · 97 communities (60 shown, 37 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 126 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_WikiController + Proxy|WikiController + Proxy]]
- [[_COMMUNITY_Controller Tests + Mobile|Controller Tests + Mobile]]
- [[_COMMUNITY_Ingest Phase + Frontmatter|Ingest Phase + Frontmatter]]
- [[_COMMUNITY_Claude CLI Client|Claude CLI Client]]
- [[_COMMUNITY_Query Phase + Wiki Graph|Query Phase + Wiki Graph]]
- [[_COMMUNITY_Core Domain Model|Core Domain Model]]
- [[_COMMUNITY_DSPy Optimizer + Local Config|DSPy Optimizer + Local Config]]
- [[_COMMUNITY_AgentRunner + I18n|AgentRunner + I18n]]
- [[_COMMUNITY_Sidebar View|Sidebar View]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_Lint Phase|Lint Phase]]
- [[_COMMUNITY_Init Phase|Init Phase]]
- [[_COMMUNITY_DSPy Optimizer Core|DSPy Optimizer Core]]
- [[_COMMUNITY_Integration Tests + Fix|Integration Tests + Fix]]
- [[_COMMUNITY_Build Config + Fixtures|Build Config + Fixtures]]
- [[_COMMUNITY_Settings + Main Plugin|Settings + Main Plugin]]
- [[_COMMUNITY_Core Types + Modals|Core Types + Modals]]
- [[_COMMUNITY_Plugin Entry + Migration|Plugin Entry + Migration]]
- [[_COMMUNITY_Lint Phase Tests|Lint Phase Tests]]
- [[_COMMUNITY_Fix Phase|Fix Phase]]
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
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
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
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]

## God Nodes (most connected - your core abstractions)
1. `I18n` - 41 edges
2. `DomainEntry` - 35 edges
3. `VaultTools` - 32 edges
4. `LlmWikiView` - 31 edges
5. `WikiController` - 31 edges
6. `WikiController` - 18 edges
7. `LlmClient` - 17 edges
8. `RunEvent` - 16 edges
9. `runIngest() phase` - 14 edges
10. `runFormat phase` - 14 edges

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

## Hyperedges (group relationships)
- **Parallel JS/TS test duplication across all phases** — phases_ingest_js_runingest, phases_ingest_ts_runingest, phases_init_js_runinit, phases_init_ts_runinit [INFERRED 0.85]
- **DSPy optimization pipeline: loader → optimizer → writer** — loader_load_examples, optimizer_run_mipro, optimize_main [EXTRACTED 1.00]
- **All operation prompt templates share placeholder syntax and wiki schema conventions** — prompt_ingest, prompt_query, prompt_lint, prompt_fix, prompt_init, prompt_chat, concept_placeholder_syntax, concept_wiki_schema_conventions [INFERRED 0.85]
- **DSPy optimization pipeline: evaluator prompt + operation prompts + dev log form closed feedback loop** — dspy_readme, prompt_evaluator, prompt_ingest, prompt_ingest_optimized, concept_dspy_miprov2 [EXTRACTED 0.95]
- **DSPy MIPROv2 optimization pipeline: dev.jsonl → loader → optimizer → writer** — dspy_dev_jsonl, dspy_load_examples, dspy_run_mipro, dspy_write_optimized, dspy_optimize_py [EXTRACTED 1.00]
- **Backend selection: DSPY_BACKEND env selects between Ollama and ClaudeCodeLM via make_lm** — dspy_dspy_backend_env, dspy_make_lm, dspy_claudecodelm [EXTRACTED 1.00]
- **Placeholder preservation: template syntax + restore_placeholders survive MIPROv2 rewriting** — dspy_placeholder_syntax, dspy_restore_placeholders, dspy_miprov2 [EXTRACTED 1.00]
- **Backend Routing to LLM Clients** — controller_wikicontroller, claude_cli_client_claudecliclient, mobile_fetch_mobilefetch, proxy_createproxyfetch [EXTRACTED 1.00]
- **Domain Lifecycle Management** — domain_domainentry, domain_store_domainstore, domain_applydomainevent, controller_wikicontroller [EXTRACTED 1.00]
- **Settings Resolution Chain** — local_config_localconfigstore, effective_settings_resolveeffective, effective_settings_effectivesettings [EXTRACTED 1.00]
- **Domain CRUD Operations — applyDomainEvent, DomainStore, validateDomainId** — apply_domain_event, domain_store, validate_domain_id [INFERRED 0.85]
- **LLM Phase Streaming Pattern — format, fix phases use buildChatParams + extractStreamDeltas** — format_phase, fix_phase, llm_utils [EXTRACTED 1.00]
- **ClaudeCliClient Large Payload Handling — tmpWrite, tmpRemove, large_payload_file_strategy** — claude_cli_client, large_payload_file_strategy, session_resume_strategy [INFERRED 0.85]
- **Format Pipeline: prompt → runFormat → phase_format_utils (token validation)** — prompt_format, phase_format, phase_format_utils [INFERRED 0.85]
- **Phase Common Pattern: VaultTools + LlmClient + AbortSignal async generator** — phase_init, phase_format, phase_ingest [EXTRACTED 1.00]
- **Migration Pipeline: migrateLegacyData + migrateToLocalV1 + LocalConfigStore** — migrate_legacy_data, migrate_to_local_v1, local_config_store [EXTRACTED 1.00]

## Communities (97 total, 37 thin omitted)

### Community 0 - "WikiController + Proxy"
Cohesion: 0.07
Nodes (17): toVaultPath(), WikiController, resolveEffective(), I18n, AddDomainModal, attachFolderDropdown(), EditDomainModal, buildProxyUrl() (+9 more)

### Community 1 - "Controller Tests + Mobile"
Cohesion: 0.05
Nodes (26): AbstractInputSuggest, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl(), makeElWithText() (+18 more)

### Community 2 - "Ingest Phase + Frontmatter"
Cohesion: 0.06
Nodes (37): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), detectDomain(), domain, existingArticles (+29 more)

### Community 3 - "Claude CLI Client"
Cohesion: 0.07
Nodes (29): ClaudeCliClient, isRecord(), mapAssistant(), mapResult(), mapUserToolResult(), parseStreamLine(), truncate(), cfg (+21 more)

### Community 4 - "Query Phase + Wiki Graph"
Cohesion: 0.07
Nodes (31): allPageIds, buildContextBlock(), contextBlock, entityTypesBlock, files, graph, keywordSeeds(), messages (+23 more)

### Community 5 - "Core Domain Model"
Cohesion: 0.07
Nodes (37): ClaudeCliClient, ClaudeCliConfig, WikiController, AddDomainInput, applyDomainEvent, DomainEntry, EntityType, DomainStore (+29 more)

### Community 6 - "DSPy Optimizer + Local Config"
Cohesion: 0.09
Nodes (20): _get(), main(), ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., write_optimized(), LocalConfigStore (+12 more)

### Community 7 - "AgentRunner + I18n"
Cohesion: 0.1
Nodes (34): AgentRunner, buildOptsFor, runOperation, writeDevLog, i18n, actualizeDomainConfig, buildFixMessages, checkStructure (+26 more)

### Community 8 - "Sidebar View"
Cohesion: 0.09
Nodes (5): LlmWikiView, registerLinkHandler(), summariseInput(), translateSystemEvent(), truncate()

### Community 9 - "Format Phase"
Cohesion: 0.09
Nodes (29): baseParams, lastSlash, messages, missing, parsed, { reasoning, content }, retryMessages, retryParams (+21 more)

### Community 10 - "Lint Phase"
Cohesion: 0.06
Nodes (27): absWiki, allIssues, backlinks, { content }, diffReport, entityTypesBlock, existingArticles, files (+19 more)

### Community 11 - "Init Phase"
Cohesion: 0.15
Nodes (21): runInit (test .js), runInit, runInitWithSources, adapter, collect(), domainCreated, existingDomain, indexCall (+13 more)

### Community 12 - "DSPy Optimizer Core"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 13 - "Integration Tests + Fix"
Cohesion: 0.12
Nodes (22): AgentRunner class, agent-runner.integration.test.ts — AgentRunner integration tests, buildFixMessages helper, buildFixSummary helper, checkStructure (from lint phase), controller-build-fail.test.ts — buildAgentRunner failure notice test, extractImagePaths helper, extractJsonObject utility (+14 more)

### Community 14 - "Build Config + Fixtures"
Cohesion: 0.12
Nodes (22): AgentRunner, ClaudeCliClient, esbuild.config.mjs, tests/fixtures/stream-ingest.jsonl, iclaude.sh, LlmWikiView, main.ts, tests/fixtures/mock-iclaude.sh (+14 more)

### Community 15 - "Settings + Main Plugin"
Cohesion: 0.14
Nodes (13): EffectiveSettings, en, es, locales, ru, DEFAULTS, LocalConfig, ProxyConfig (+5 more)

### Community 16 - "Core Types + Modals"
Cohesion: 0.18
Nodes (13): ConfirmModal, ChatMessage, ClaudeOperationConfig, NativeOperationConfig, OnFileError, OpKey, OpMap, RunEvent (+5 more)

### Community 17 - "Plugin Entry + Migration"
Cohesion: 0.12
Nodes (13): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+5 more)

### Community 18 - "Lint Phase Tests"
Cohesion: 0.12
Nodes (17): adapter, collect(), configJson, createMock, domain, domainA, domainB, ev (+9 more)

### Community 19 - "Fix Phase"
Cohesion: 0.11
Nodes (15): absWiki, errors, files, fixedPages, messages, META_FILES, params, { reasoning, content } (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (8): DomainCorruptError, DomainStore, adapter, calls, makeVault(), sampleDomain, store, stored

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (14): appendLog(), dryRun, existing, match, messages, params, { reasoning, content }, sampleFiles (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (3): VaultAdapter, VaultTools, mockAdapter()

### Community 23 - "Community 23"
Cohesion: 0.23
Nodes (6): AddDomainInput, applyDomainEvent(), DomainPersistEvent, EntityType, validateDomainId(), consolidateSourcePaths()

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (13): adapter, collect(), domain, domainWithoutPath, ev, failEvent, llmResponse, makeLlm() (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (11): adapter, blocks, callArgs, create, ctrl, history, json, llm (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.2
Nodes (9): Backlinks frontmatter (wiki_added, wiki_updated, wiki_articles) written to raw source after ingest, runIngest() phase, phases/ingest.test.ts, raw-frontmatter tests, hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), raw-frontmatter utility (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.24
Nodes (9): load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, Modal, _jsonl(), test_excludes_ops_below_min_examples(), test_filters_by_operations_arg(), test_groups_by_operation(), test_skips_missing_required_fields() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.24
Nodes (9): DomainEntry, migrateDomainWikiFolder(), base, input, result, start, changed, domains (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (13): applyDomainEvent function, apply-domain-event.test.ts — applyDomainEvent tests, detectDomain function, DomainCorruptError class, DomainEntry type, domain-store.test.ts — DomainStore load/save tests, EditDomainModal class, extractParentSourcePath function (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.23
Nodes (6): FileErrorModal, domain, m, makeFileErrorModal(), makeModal(), onSave

### Community 32 - "Community 32"
Cohesion: 0.2
Nodes (10): adapter, collect(), createMock, domain, llm, makeLlm(), mockAdapter(), result (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.23
Nodes (12): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, Prompt placeholder syntax: {{variable}} for runtime template substitution, DSPy Prompt Optimizer README, Base Prompt Template, Chat Prompt Template, Evaluator Prompt Template, Fix Prompt Template (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (7): parseEvalResponse(), actualizeDomainConfig(), buildChatParams(), extractStreamDeltas(), injectSystemPrompt(), prependBaseContract(), LlmCallOptions

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (9): adapter, baseSettings, collect(), ctrl, json, makeLlm(), mockAdapter(), runner (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.27
Nodes (11): ChatMessage, controller-log-adapter.test.ts — vault adapter logEvent tests, format-sample.md (fixture), LlmClient, runFormat(), format-utils (extractJsonObject, significantTokens, missingTokens), runInit(), phases/format.test.ts (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.24
Nodes (8): DomainStore class, DomainStore auto-migration of !Wiki/ prefix on load, LocalConfigStore, local.json stores machine-specific path (iclaudePath) outside Obsidian settings to avoid sync conflicts, migrateLegacyData(), migrateToLocalV1(), migrateLegacyData is idempotent — second run must not call saveData again, native-agent backend (OpenAI-compatible / Ollama)

### Community 38 - "Community 38"
Cohesion: 0.24
Nodes (8): Format Preview Flow — temp file in !Temp/, apply/cancel/refine cycle, LlmWikiPlugin (main.ts), Mobile Guard — ingest/lint/init blocked on mobile, query allowed, format.md (LLM prompt), _format_schema.md (template), _wiki_schema.md (template), WikiController, wiki_* frontmatter fields preserved on format apply — programmatically managed, must not be lost during LLM reformatting

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (6): messages, params, { reasoning, content }, start, systemContent, render()

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (9): buildProxyUrl function, createProxyDispatcher function, createProxyFetch function, maskProxyUrl function, Mobile compatibility guard (no top-level node:* imports), no-fs-imports.test.ts — mobile hot path guard, parseNoProxy function, proxy.test.ts — proxy utility function tests (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (8): MIPROv2 prompt optimization pattern, load_examples, optimize.py main(), call_evaluator, restore_placeholders, run_mipro, make_signature, WikiOperation (DSPy Signature)

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (5): buildSpy, ctrl, makeApp(), makePlugin(), plugin

### Community 45 - "Community 45"
Cohesion: 0.6
Nodes (5): build(), makeApp(), makeDomainStore(), makeLocalConfigStore(), makePlugin()

### Community 46 - "Community 46"
Cohesion: 0.53
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (5): EvalResult, parseEvalResponse, runEvaluator, Non-fatal evaluator: quality scoring that never blocks main flow, tests for parseEvalResponse

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (5): ClaudeCodeLM, dspy.BaseLM, make_lm(), DSPY_BACKEND env var, test_backend (ClaudeCodeLM / make_lm tests)

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 54 - "Community 54"
Cohesion: 0.5
Nodes (4): ClaudeCliClient class, claude-cli-client.test.ts — ClaudeCliClient streaming/spawn tests, Large payload file strategy (>256KB uses tmp files), Session resume strategy (--resume flag, skip --system-prompt)

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (3): domainWikiFolder, domainWikiFolder (test), WIKI_ROOT constant (!Wiki)

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (3): historyLimit, settings.ts, tests/settings.test.ts

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (3): domain.test.ts — validateDomainId tests, domain.test.js — JS duplicate of validateDomainId tests, validateDomainId function

## Knowledge Gaps
- **345 isolated node(s):** `App`, `Plugin`, `Platform`, `TAbstractFile`, `TFolder` (+340 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainEntry` connect `Community 28` to `Community 32`, `Ingest Phase + Frontmatter`, `Query Phase + Wiki Graph`, `Community 39`, `Lint Phase`, `Init Phase`, `Community 45`, `Settings + Main Plugin`, `Core Types + Modals`, `Plugin Entry + Migration`, `Lint Phase Tests`, `Fix Phase`, `Community 20`, `Community 21`, `Community 23`, `Community 24`, `Community 31`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `DSPy Optimizer + Local Config` to `Core Types + Modals`, `Settings + Main Plugin`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `mobileFetch()` connect `Controller Tests + Mobile` to `Core Types + Modals`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `I18n` (e.g. with `.onload()` and `.onOpen()`) actually correct?**
  _`I18n` has 35 INFERRED edges - model-reasoned connections that need verification._
- **What connects `App`, `Plugin`, `Platform` to the rest of the system?**
  _345 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `WikiController + Proxy` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Controller Tests + Mobile` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._