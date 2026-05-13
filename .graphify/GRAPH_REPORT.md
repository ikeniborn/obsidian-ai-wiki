# Graph Report - .  (2026-05-13)

## Corpus Check
- 1125 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1125 nodes · 2460 edges · 88 communities (53 shown, 35 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Agent Runner & CLI Client|Agent Runner & CLI Client]]
- [[_COMMUNITY_Phase Tests & Vault Tools|Phase Tests & Vault Tools]]
- [[_COMMUNITY_Proxy & Controller Config|Proxy & Controller Config]]
- [[_COMMUNITY_Domain Events & Types|Domain Events & Types]]
- [[_COMMUNITY_Mobile & Build Mocks|Mobile & Build Mocks]]
- [[_COMMUNITY_Query Phase & Wiki Graph|Query Phase & Wiki Graph]]
- [[_COMMUNITY_Core Types & Interfaces|Core Types & Interfaces]]
- [[_COMMUNITY_Format Phase|Format Phase]]
- [[_COMMUNITY_DSPy Optimization Scripts|DSPy Optimization Scripts]]
- [[_COMMUNITY_Agent Runner Logic|Agent Runner Logic]]
- [[_COMMUNITY_Lint Phase|Lint Phase]]
- [[_COMMUNITY_Claude CLI Client Tests|Claude CLI Client Tests]]
- [[_COMMUNITY_View Layer (LlmWikiView)|View Layer (LlmWikiView)]]
- [[_COMMUNITY_WikiController Methods|WikiController Methods]]
- [[_COMMUNITY_Modals & Domain UI|Modals & Domain UI]]
- [[_COMMUNITY_Ingest Phase|Ingest Phase]]
- [[_COMMUNITY_DSPy Optimizer & Signature|DSPy Optimizer & Signature]]
- [[_COMMUNITY_Init Phase|Init Phase]]
- [[_COMMUNITY_Settings & Main Entry|Settings & Main Entry]]
- [[_COMMUNITY_CLAUDE.md Documentation|CLAUDE.md Documentation]]
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
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
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
10. `render()` - 20 edges

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
- **All operation prompt templates share placeholder syntax and wiki schema conventions** — prompt_ingest, prompt_query, prompt_lint, prompt_fix, prompt_init, prompt_chat, concept_placeholder_syntax, concept_wiki_schema_conventions [INFERRED 0.85]
- **DSPy MIPROv2 optimization pipeline: dev.jsonl → loader → optimizer → writer** — dspy_dev_jsonl, dspy_load_examples, dspy_run_mipro, dspy_write_optimized, dspy_optimize_py [EXTRACTED 1.00]
- **Backend selection: DSPY_BACKEND env selects between Ollama and ClaudeCodeLM via make_lm** — dspy_dspy_backend_env, dspy_make_lm, dspy_claudecodelm [EXTRACTED 1.00]
- **Placeholder preservation: template syntax + restore_placeholders survive MIPROv2 rewriting** — dspy_placeholder_syntax, dspy_restore_placeholders, dspy_miprov2 [EXTRACTED 1.00]
- **DSPy optimization pipeline: evaluator prompt + operation prompts + dev log form closed feedback loop** — dspy_readme, prompt_evaluator, prompt_ingest, prompt_ingest_optimized, concept_dspy_miprov2 [EXTRACTED 0.95]

## Communities (88 total, 35 thin omitted)

### Community 0 - "Agent Runner & CLI Client"
Cohesion: 0.05
Nodes (59): messages, params, { reasoning, content }, start, systemContent, parseEvalResponse(), appendLog(), dryRun (+51 more)

### Community 1 - "Phase Tests & Vault Tools"
Cohesion: 0.05
Nodes (57): adapter, blocks, callArgs, collect(), create, ctrl, history, json (+49 more)

### Community 2 - "Proxy & Controller Config"
Cohesion: 0.06
Nodes (40): toVaultPath(), AddDomainInput, applyDomainEvent(), DomainPersistEvent, EntityType, DomainCorruptError, DomainStore, validateDomainId() (+32 more)

### Community 3 - "Domain Events & Types"
Cohesion: 0.05
Nodes (49): applyDomainEvent function, apply-domain-event.test.ts — applyDomainEvent tests, Backlinks frontmatter (wiki_added, wiki_updated, wiki_articles) written to raw source after ingest, ChatMessage, controller-log-adapter.test.ts — vault adapter logEvent tests, detectDomain function, DomainCorruptError class, DomainEntry type (+41 more)

### Community 4 - "Mobile & Build Mocks"
Cohesion: 0.07
Nodes (29): AbstractInputSuggest, App, __clearNotices(), __clearRequestUrlCalls(), createMockAdapter(), ItemView, makeEl(), makeElWithText() (+21 more)

### Community 5 - "Query Phase & Wiki Graph"
Cohesion: 0.11
Nodes (34): allPageIds, buildContextBlock(), buildEntityTypesBlock(), contextBlock, entityTypesBlock, files, graph, keywordSeeds() (+26 more)

### Community 6 - "Core Types & Interfaces"
Cohesion: 0.07
Nodes (37): ClaudeCliClient, ClaudeCliConfig, WikiController, AddDomainInput, applyDomainEvent, DomainEntry, EntityType, DomainStore (+29 more)

### Community 7 - "Format Phase"
Cohesion: 0.14
Nodes (30): baseParams, extractImagePaths(), lastSlash, messages, missing, parsed, { reasoning, content }, retryMessages (+22 more)

### Community 8 - "DSPy Optimization Scripts"
Cohesion: 0.11
Nodes (19): _get(), main(), load_examples(), Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль, write_optimized(), LocalConfigStore, adapter, makePlugin() (+11 more)

### Community 9 - "Agent Runner Logic"
Cohesion: 0.1
Nodes (34): AgentRunner, buildOptsFor, runOperation, writeDevLog, i18n, actualizeDomainConfig, buildFixMessages, checkStructure (+26 more)

### Community 10 - "Lint Phase"
Cohesion: 0.12
Nodes (31): absWiki, actualizeDomainConfig(), allIssues, backlinks, buildEntityTypesBlock(), buildFixMessages(), computeEntityDiff(), { content } (+23 more)

### Community 11 - "Claude CLI Client Tests"
Cohesion: 0.12
Nodes (22): ClaudeCliClient, cfg, chunks, client, createPromise, ctrl, largeSystem, largeText (+14 more)

### Community 12 - "View Layer (LlmWikiView)"
Cohesion: 0.09
Nodes (3): LlmWikiView, registerLinkHandler(), sanitizeLinks()

### Community 14 - "Modals & Domain UI"
Cohesion: 0.11
Nodes (6): DomainEntry, AddDomainModal, attachFolderDropdown(), DomainModal, EditDomainModal, QueryModal

### Community 15 - "Ingest Phase"
Cohesion: 0.16
Nodes (24): absWiki, appendLog(), backlinkToday, buildEntityTypesBlock(), buildIngestMessages(), buildIngestSummary(), domain, existingArticles (+16 more)

### Community 16 - "DSPy Optimizer & Signature"
Cohesion: 0.16
Nodes (16): call_evaluator(), restore_placeholders(), run_mipro(), make_signature(), MockLM, test_call_evaluator_clamps_score(), test_call_evaluator_parses_score(), test_call_evaluator_renders_template_vars() (+8 more)

### Community 17 - "Init Phase"
Cohesion: 0.15
Nodes (21): runInit (test .js), runInit, runInitWithSources, adapter, collect(), domainCreated, existingDomain, indexCall (+13 more)

### Community 18 - "Settings & Main Entry"
Cohesion: 0.18
Nodes (11): EffectiveSettings, resolveEffective(), en, es, locales, ru, DEFAULTS, LocalConfig (+3 more)

### Community 19 - "CLAUDE.md Documentation"
Cohesion: 0.12
Nodes (22): AgentRunner, ClaudeCliClient, esbuild.config.mjs, tests/fixtures/stream-ingest.jsonl, iclaude.sh, LlmWikiView, main.ts, tests/fixtures/mock-iclaude.sh (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (22): AgentRunner class, agent-runner.integration.test.ts — AgentRunner integration tests, buildFixMessages helper, buildFixSummary helper, checkStructure (from lint phase), controller-build-fail.test.ts — buildAgentRunner failure notice test, extractImagePaths helper, extractJsonObject utility (+14 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (8): BusyCloseModal, ConfirmModal, RunHistoryEntry, summariseInput(), translateSystemEvent(), truncate(), ViewState, WikiQuestionModal

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (14): LlmWikiPlugin, migrateLegacyData(), migrateToLocalV1(), adapter, dms, existing, lcs, local (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.2
Nodes (17): absWiki, buildFixMessages(), buildFixSummary(), errors, files, fixedPages, messages, META_FILES (+9 more)

### Community 24 - "Community 24"
Cohesion: 0.21
Nodes (10): ClaudeCodeLM, make_lm(), DSPy-совместимый LM через claude CLI. Не требует API-ключа., Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv()., test_call_with_messages(), test_call_with_prompt_string(), test_flatten_combines_messages(), test_make_lm_claude_code() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.38
Nodes (9): patchWikiFields(), buildWikiFields(), hasFrontmatterField(), parseWikiArticlesFromFm(), parseWikiSourcesFromFm(), removeWikiFields(), ARTICLES, result (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (12): dev.jsonl (JSONL dev log), load_examples(), lib/loader.py, make_signature(), MIPROv2, optimize.py (CLI entry point), lib/optimizer.py, {{placeholder}} template syntax (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.23
Nodes (12): ClaudeCodeLM: DSPy-compatible adapter for Claude CLI, DSPy MIPROv2: automated prompt optimization via Optuna, Prompt placeholder syntax: {{variable}} for runtime template substitution, DSPy Prompt Optimizer README, Base Prompt Template, Chat Prompt Template, Evaluator Prompt Template, Fix Prompt Template (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.24
Nodes (11): Dynalist, Inc. (Obsidian), BRAT Plugin (Beta Reviewer's Auto-update Tool), Obsidian Contributor License Agreement, CLA Copyright License Grant, CLA Patent License Grant, community-css-theme.json, Community Plugin Submission Process, community-plugins.json (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (9): buildProxyUrl function, createProxyDispatcher function, createProxyFetch function, maskProxyUrl function, Mobile compatibility guard (no top-level node:* imports), no-fs-imports.test.ts — mobile hot path guard, parseNoProxy function, proxy.test.ts — proxy utility function tests (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.46
Nodes (6): buildSpy, ctrl, makeApp(), makeLocalConfigStore(), makePlugin(), plugin

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (8): MIPROv2 prompt optimization pattern, load_examples, optimize.py main(), call_evaluator, restore_placeholders, run_mipro, make_signature, WikiOperation (DSPy Signature)

### Community 33 - "Community 33"
Cohesion: 0.48
Nodes (5): detectDomain(), extractParentSourcePath(), domains, makeD(), result

### Community 34 - "Community 34"
Cohesion: 0.53
Nodes (4): migrateDomainWikiFolder(), changed, domains, makeDomain()

### Community 35 - "Community 35"
Cohesion: 0.6
Nodes (4): makePlugin(), plugin, { plugin, registered }, setupPlugin()

### Community 36 - "Community 36"
Cohesion: 0.53
Nodes (4): lines, MOBILE_HOT_PATH_FILES, offending, src

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (5): EvalResult, parseEvalResponse, runEvaluator, Non-fatal evaluator: quality scoring that never blocks main flow, tests for parseEvalResponse

### Community 39 - "Community 39"
Cohesion: 0.5
Nodes (5): ClaudeCodeLM, dspy.BaseLM, make_lm(), DSPY_BACKEND env var, test_backend (ClaudeCodeLM / make_lm tests)

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (4): lib/backend.py, ClaudeCodeLM, DSPY_BACKEND env var, make_lm()

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (4): ClaudeCliClient class, claude-cli-client.test.ts — ClaudeCliClient streaming/spawn tests, Large payload file strategy (>256KB uses tmp files), Session resume strategy (--resume flag, skip --system-prompt)

### Community 43 - "Community 43"
Cohesion: 0.83
Nodes (4): Obsidian Graph View, Obsidian October 2021 Event, Obsidian Graph View UI — Dark Theme Screenshot, Obsidian Graph View UI — Light Theme Screenshot

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): domainWikiFolder, domainWikiFolder (test), WIKI_ROOT constant (!Wiki)

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (3): historyLimit, settings.ts, tests/settings.test.ts

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (3): domain.test.ts — validateDomainId tests, domain.test.js — JS duplicate of validateDomainId tests, validateDomainId function

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (3): Obsidian Developer Docs, Plugin Guidelines (docs.obsidian.md), Plugin Review Guidelines

## Knowledge Gaps
- **126 isolated node(s):** `Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль`, `DSPy-совместимый LM через claude CLI. Не требует API-ключа.`, `Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv().`, `Stream-JSON protocol`, `WIKI_ROOT constant (!Wiki)` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainEntry` connect `Modals & Domain UI` to `Agent Runner & CLI Client`, `Community 33`, `Proxy & Controller Config`, `Community 34`, `Phase Tests & Vault Tools`, `Query Phase & Wiki Graph`, `Lint Phase`, `Ingest Phase`, `Init Phase`, `Settings & Main Entry`, `Community 21`, `Community 22`, `Community 23`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `LocalConfigStore` connect `DSPy Optimization Scripts` to `Settings & Main Entry`, `Proxy & Controller Config`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `main()` connect `DSPy Optimization Scripts` to `Community 24`, `DSPy Optimizer & Signature`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `Читает JSONL-лог dev-режима, возвращает dict operation → list[entry].     Отфиль`, `DSPy-совместимый LM через claude CLI. Не требует API-ключа.`, `Создаёт LM-объект по DSPY_BACKEND из env. Вызывается после load_dotenv().` to the rest of the system?**
  _126 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Agent Runner & CLI Client` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Phase Tests & Vault Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Proxy & Controller Config` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._