# Changelog

## 0.1.165 — 2026-06-07

### Прочее
- refactor(prompts): move remaining inline LLM prompts (vision, lint-actualize, query seeds/link-rewrite, repair/retry) into prompts/*.md, loaded via the esbuild text loader

---

## 0.1.164 — 2026-06-07

### Новое
- feat(vision): diagram annotations are now exhaustive verbatim descriptions — every node, label, and connection transcribed exactly, not a brief summary
- feat(vision): image diagrams recreate the structure as a mermaid block (flow/architecture) or a markdown table (grid/matrix) after the verbatim description
- feat(vision): PDF diagrams add the same mermaid/table recreation after the verbatim description
- feat(vision): dedicated Excalidraw prompt — always treats the render as a scheme, emits element-by-element verbatim description (no mermaid)

---

## 0.1.163 — 2026-06-07

### Новое
- feat(vision): render Excalidraw diagrams via the host Excalidraw plugin (renderExcalidrawPng) instead of parsing JSON — wired through controller, vision, and vault-tools
- feat(vision): diagram rule emits a prose description followed by a Mermaid recreation; vision blocks keep both description + Mermaid
- feat(prompts): emit rich structured single-line annotations for retrieval
- feat(wiki-index): collapse annotation whitespace to enforce single-line invariant

### Исправления
- fix(vision): insertDescriptions renders multi-line descriptions at top level
- fix(vision): strip data-URI prefix from createPNGBase64 to avoid double prefix

---

## 0.1.162 — 2026-06-05

### Исправления
- fix(security): block path traversal in delete loop and attachment resolve
- fix(lint): add local eslint pipeline mirroring the Obsidian reviewer; resolve release blockers (lazy desktop-guarded node:child_process, this:void scoping, unused imports, window.requestAnimationFrame, unnecessary type assertions)

---

## 0.1.161 — 2026-06-05

### Исправления
- fix(lint): устранены ошибки и предупреждения ревьюера плагинов Obsidian, блокировавшие релиз

---

## 0.1.160 — 2026-06-05

### Fixes
- fix(styles): ask-row space-between layout, remove flex-wrap
- fix(view): swap ask/cancel button DOM order — cancel left, ask right

---

## 0.1.159 — 2026-06-05

### Fixes
- fix(mobile): replace Buffer with btoa/atob, fix settings scroll, fix agent.jsonl folder creation
- fix(mobile): fix Headers serialization in mobileFetch, fix scroll container selector
- fix(mobile): correct tok/s stats for non-streaming emulation

---

## 0.1.158 — 2026-06-05

### New
- feat(ux): show vision confirmation modal before format when vision enabled
- feat(format): replace JSON wrapping with sentinel markers; remove json_object mode; add Zod-feedback retry
- feat(format): harden FormatOutputSchema with FormatBaseSchema/FormatWithVisionSchema and superRefine
- feat(format): add parseSentinelOutput to format-utils
- feat(prompts): replace JSON format instructions with sentinel markers in format.md
- feat(prompts): strengthen query formatting rules — lists, tables, bold for entities
- feat(query): add query-link-validator with post-stream broken link detection, retry, and annotate fallback
- feat(view): handle assistant_replace event — no-op in main view, replace in chat bubble
- feat(types): add assistant_replace event to RunEvent union

### Fixes
- fix(vision): handle .excalidraw.md files — extract embedded JSON for Excalidraw analysis

---

## 0.1.155 — 2026-06-04

### Fixes
- fix(format): restore Obsidian embeds (`![[...]]`) converted by LLM to standard Markdown
- fix(settings): move busy banner under Domains heading with warning icon and indented style
- fix(modal): show article count for all entity types; right-align select-all buttons with gap

---

## 0.1.154 — 2026-06-04

### New
- feat(modal): refactor LintOptionsModal — single domain, reorder UI, select-all, article counts
- feat(view): add updateButtonAvailability, hook domain-select and file-open
- feat(view): render eval_result with MarkdownRenderer for markdown support
- feat(settings): remove Lint UI section from settings panel
- feat(i18n): add lintSelectAll and lintDeselectAll keys to all locales
- feat(styles): add user-select text for query results, add ai-wiki-count-muted

---

## 0.1.153 — 2026-06-04

### New
- feat(agent-runner): add idle watchdog retry loop in run()
- feat(settings): add UI controls for llmIdleTimeoutSec and llmIdleRetries
- feat(i18n): add llmIdleTimeout and llmIdleRetries setting strings (en/ru/es)
- feat(lint): add useLlm/entityTypeFilter params, wire through RunRequest
- feat(lint): use stripInvalidWikiArticles for wiki_articles source cleanup
- feat(ingest): use stripInvalidWikiArticles for wiki_articles, remove non-wiki stem preservation
- feat(raw-frontmatter): add stripInvalidWikiArticles
- feat(modals): add LintOptionsModal with domain, entity filter, and LLM toggle
- feat(ui): replace DomainModal/ConfirmModal with LintOptionsModal for lint entry points
- feat(settings): add lintOptions.useLlm with settings UI and i18n

### Fixes
- fix(agent-runner): detect silent idle abort when phases swallow AbortError

### Other
- refactor(settings): move nativeAgent/claudeAgent/proxy params to data.json

---

## 0.1.151 — 2026-06-03

### Fixes
- fix(lint): exclude wiki page stems from wiki_sources restore and validation
- fix(lint): quote [[...]] in wiki_sources to prevent YAML flow-sequence misparse
- fix(lint): keep path-based wiki_sources entries (e.g. Sources/raw.md) valid

---

## 0.1.150 — 2026-06-03

### Fixes
- fix(settings): hide proxy section when backend is claude-agent

### Other
- refactor(settings): move wikiLinkValidationRetries into LLM section; add Jaccard heading
- refactor(i18n): add h3_jaccard key for all locales

---

## 0.1.149 — 2026-06-03

### New
- feat(wiki-graph): add bfsExpandRanked with embedding/Jaccard ranking and bfsTopK limit
- feat(query): replace bfsExpandWithHops with bfsExpandRanked for similarity-ranked BFS context
- feat(query): add expandedScores to graph_stats; improve query prompt formatting
- feat(lint): add buildTitleMap for Obsidian title-based link resolution
- feat(lint): wire buildTitleMap + validateWikiSources into runLint for title-aware wiki_sources validation
- feat(lint): add originalContent param to validateWikiSources; restore dropped valid entries
- feat(lint): delete wiki pages with empty wiki_sources after per-article loop
- feat(frontmatter): add list-wikilinks-stem-only rule kind; strip forbidden wiki_* fields from SOURCE_RULES
- feat(controller): strip forbidden wiki_* fields after format apply; replace ConfirmModal wiki guard with InfoModal
- feat(modals): add InfoModal — title, body lines, single close button
- feat(i18n): update formatInWiki strings to 'forbidden' framing; add formatInWikiClose key

### Fixes
- fix(settings): move structuredRetries above per-op section; add heading separator; remove duplicate Semantic Search heading
- fix(frontmatter): use context-neutral warning message for remove rule kind
- fix: guard expandedByHop undefined in view.ts; make seed inclusion explicit in bfsExpandRanked
- fix: remove dead formatInWikiNoSources key

### Other
- refactor: replace hubThreshold with bfsTopK, remove hub detection from checkGraphStructure

---

## 0.1.147 — 2026-06-02

### New
- feat(frontmatter): add remove FieldRule kind, strip annotation from wiki pages
- feat(frontmatter): add ensureWikiSources — inject sourceStem when wiki_sources absent
- feat(ingest): inject wiki_sources when absent, strip annotation from frontmatter

---

## 0.1.146 — 2026-06-02

### New
- feat(view): multi-line trace format for seeds and BFS hops in graph stats
- feat(view): render extended graph trace (seeds with scores, BFS hop breakdown) when agentLogEnabled
- feat(view): confirm modal before domain registration — cancel prevents creation
- feat(view): force reinit on source removal in manage sources flow
- feat(query): collect seed scores and BFS-by-hop, emit in graph_stats event
- feat(wiki-graph): add bfsExpandWithHops — tracks expanded pages by BFS depth
- feat(types): extend graph_stats with seedScores and expandedByHop fields
- feat(page-similarity): add selectRelevantScored — returns {path, score}[]
- feat(wiki-seeds): selectSeeds returns scored results {id, score}[]
- feat(llm-utils): computeSpeedText shows token counts alongside tok/s
- feat(lint): add cleanupInvalidPages pass — deletes invalid wiki articles before LLM steps
- feat(lint): add bucket repair pass for wiki_sources / wiki_outgoing_links
- feat(lint): filter stale wiki_outgoing_links and wiki_articles vault-wide
- feat(ingest): validate and auto-repair frontmatter before writing source and wiki pages
- feat(ingest): filter stale wiki_articles and related links after repair
- feat(prompts): forbid source names in outgoing_links and dead wiki links
- feat(validator): add list-wikilinks-wiki-only and list-wikilinks-sources-only FieldRule kinds
- feat(raw-frontmatter): add FieldRule type, validateAndRepairFrontmatter helper, wiki/source page validators
- feat(vault): add rmdir to VaultAdapter and removeSubfolders to VaultTools

### Fixes
- fix(bfs): guard phantom nodes in bfsExpand and bfsExpandWithHops — dangling links no longer enter expanded set
- fix(query): exclude _config/ directory files from BFS graph
- fix(raw-frontmatter): replace regex upsertRawFrontmatter with YAML parse→mutate→serialize
- fix(raw-frontmatter): allow hyphens in tag segments (TAG_RE)
- fix(raw-frontmatter): track modified flag; delete empty lists; fix aliases warning
- fix(ingest): delete wiki pages missing wiki_sources before LLM calls
- fix(ingest): delete unprefixed legacy pages instead of warn-only
- fix(ingest): emit domain_updated after source_path_added
- fix(ingest): skip allFailed halt when wiki is empty
- fix(init): preserve language_notes during reinit
- fix(init): remove subdirectories after files in wipeDomainFolder
- fix(init): use domain wiki path for annotationsCache
- fix(similarity): allFailed=false when no pages exist in embedding path
- fix(lint): remove related field from source stale-link pass — user cross-refs are ingest-only
- fix(prompt): allow entity extraction for unknown concept types; prohibit wikilink alias syntax; show optional type field
- fix(wiki-link-validator): three bugs causing spurious WikiLink warnings
- fix(vault-walk): strip trailing slash before getFolderByPath

### Other
- refactor(raw-frontmatter): use gm flag instead of do-while loop in removeWikiFields

---

## 0.1.142 — 2026-05-26

### New
- feat(ui): add LLM progress steps to all phases; show ingest token count

### Fixes
- fix(lint): move WikiLink warnings yield after write loop
- fix(ui): wikilink warnings after write; lint analysing progress; per-step timing ≥1s; tok/s on in/out
- fix(ingest): include existing pages in knownStems for dead-link detection

---

## 0.1.141 — 2026-05-25

### Новое
- feat(storage-migration): авто-миграция `.config/` → `_config/` при запуске
- feat(lint-chat): чтение `_wiki_schema.md`, передача `schema_block` в промпт
- feat(lint): слияние assess+fix в единый CoT+Structured вызов; прогресс по страницам в UI
- feat(ingest): обогащение лога — СОЗДАНА/ОБНОВЛЕНА, status transitions
- feat(schemas): WikiPageSchema, WikiPagesOutputSchema, LintOutputSchema, FormatOutputSchema
- feat(wiki-index): перезапись в сгруппированный Markdown; путь и wikilink в записях `_index.md`
- feat(view): кнопки Open `_log` / Open `_index` в строке домена
- feat(view): сохранение/восстановление последнего выбранного домена
- feat(view): кнопка повтора запроса в истории
- feat(view): live-status секция; таймлейблы шагов; индикатор ожидания; copy-to-clipboard
- feat(view): auto-collapse секции Progress после завершения операции
- feat(consent): lazy ShellConsentModal + миграция `shellConsentGiven` из `data.json` в `local.json`
- feat(reinit): показ количества файлов вики в диалоге подтверждения
- feat: IngestScopeModal, ManageSourcesModal, addSourceBtn / openManageSources
- feat: ensureDomainConfig — создание `.config/`, миграция legacy index/log
- feat: перемещение `_domain.json`, `agent.jsonl`, `dev.jsonl` в `!Wiki/.config/`
- feat(security): ShellConsentModal и guard операций (F-2c)

### Исправления
- fix(i18n): путь `agent.jsonl` → `_config/` во всех локалях
- fix(vault-tools): fallback `adapter.write` для скрытых директорий; рекурсивный mkdir
- fix(view): таймлейблы шагов с правым выравниванием; capture chatBubble перед async render
- fix(security): validateIclaudePath, fs.access probe, folder-scoped collectMdInPaths
- fix(lint): дедупликация dead-link отчётов по файлу
- fix(ingest): отклонение системных файлов из LLM-вывода
- fix: замена `wiki_keywords` → `tags` в промптах и схемах

### Прочее
- refactor(wiki-path): переименование `.config/` → `_config/`, глобальные константы
- refactor: удаление `query-save` из всех слоёв (agent-runner, controller, view, command)
- refactor: extract vault-walk utilities в `src/utils/vault-walk.ts`
- refactor(consent): ShellConsentModal без прямой зависимости от plugin

---

## 0.1.108 — 2026-05-18

### Новое
- feat(index): parseIndexAnnotations + upsertIndexAnnotation — хранение аннотаций в индексе
- feat(seeds): skip frontmatter, add wiki_keywords + annotation scoring
- feat(prompts): add wiki_keywords + annotation to ingest/lint/init prompts
- feat(query): pass indexAnnotations to selectSeeds, simplify LLM seed prompt
- feat(ingest): upsertIndexAnnotation per page, parseJsonPages includes annotation
- feat(lint): upsertIndexAnnotation per fixed page
- feat(lint-chat): implement runLintFixChat phase — интерактивный чат-режим lint
- feat(types): add lint-chat WikiOperation
- feat(settings): add effort dropdown + thinkingBudgetTokens for claude/native-agent
- feat(settings): add availability check buttons for claude-agent and native-agent
- feat(claude-cli-client): add effort field, pass --effort arg to iclaude.sh
- feat(controller): resolve per-op effort; add lintApplyFromChat dispatch route
- feat(view): route lint chat submissions through lintApplyFromChat

### Исправления
- fix(query): recall-based seeds, strip thinking params for seedLLM, cap context pages
- fix(query): add Read/SelectSeeds progress events and signal checks before blocking ops
- fix(controller): add timeout abort and surface error on silent abort in dispatch
- fix(mobile): AbortSignal via Promise.race in mobileFetch
- fix(lint): return markdown analysis instead of JSON in lint report
- fix(lint-chat): handle possibly-undefined pages from Zod inference
- fix(view): show elapsed time in progress after operation completes
- fix(settings): show agentLog toggle on mobile
- fix(review): normalize chat opKey, static child_process import, expose global effort

### Прочее
- refactor(agent-runner): plumb seedTopK/seedMinScore into runQuery

---
