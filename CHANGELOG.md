# Changelog

## 0.3.3 — 2026-08-20

### Fixes
- fix(build): minify the production bundle. `dist/main.js` drops from 2.93 MB over 71700 lines to 1.53 MB, because the production esbuild call never set `minify` — the plugin has been publishing a development-shaped bundle since the first release. `keepNames` stays on, since zod and the OpenAI SDK branch on constructor and function names; property mangling is off, as esbuild leaves it. The bundle was verified to parse and load after minification, and all 1577 tests, lint, typecheck and release validation pass. This is also the next thing to try against the community-plugin review, which has now failed four times running with "The automated review for this release could not be completed. An administrator will investigate." — a message that names no rule. The `versions.json` hypothesis is spent: 0.3.2 shipped the file and failed identically. Attestation is ruled out, since it predates the last review that completed (0.2.2, at 0.1.102), and so is the `child_process` adapter, which predates it as well. Raw size alone was already argued against in 0.3.1 by comparison against listed plugins shipping larger bundles, so what changes here is the bundle's *shape* — one that a scanner choking on 71700 lines of unminified output would see very differently. No plugin behaviour changes.

---

## 0.3.2 — 2026-08-13

### Fixes
- fix(release): ship `versions.json` so the community-plugin review can resolve app compatibility. The automated review failed for both 0.3.0 and 0.3.1 with a message that names no rule, and 0.3.1 — a byte-identical rebuild — failed identically, so the failure is reproducible rather than transient. Release mechanics were audited and are sound: the published `main.js` is byte-identical by sha256 to a local build, the released manifest matches the repository root at the tag, and every CI step passes. Comparison against the registry isolates the one artifact this repository lacked: of 29 plugins that published a release after 2026-07-15, all 29 ship `versions.json`. It now records the two points where `minAppVersion` actually moved, plus the current release, and the production build keeps it in step with the manifest so a release cannot omit its own entry. No plugin behaviour changes — `main.js` is byte-for-byte the one published as 0.3.1.

---

## 0.3.1 — 2026-08-12

### Other
- chore(release): republish an identical build. The community-plugin automated review of 0.3.0 ended with "The automated review for this release could not be completed. An administrator will investigate." — a failure that names no rule. The 0.3.0 release itself was audited and is correct: the tag matches the manifest, the assets are attached individually, and the plugin id is free. Bundle properties were ruled out as well, by comparison against 141 currently listed community plugins that ship larger bundles, longer lines, more base64 and even embedded WebAssembly. `main.js` is therefore byte-for-byte identical to 0.3.0; only the version numbers move, so that re-running the review distinguishes a transient failure from a rule the dashboard has yet to name.

---

## 0.3.0 — 2026-08-12

### New
- feat(native-agent): derive input and output budgets automatically from the model's context window, discovered once per model, cached, and self-corrected against the provider's reported usage. A stored value still acts as an explicit override; Claude Agent is unaffected.
- feat(settings): ask an existing user once, on upgrade, whether to switch a stored native budget override to automatic — dismissing the prompt keeps the stored values, same as an explicit "keep".
- feat(native-agent): add a "Model context window" setting for backends that never advertise one (aggregating gateways that list the model in `/v1/models` without a context length and have no `/api/show`). There is one field per model — the chat model, each per-operation model, and the vision model — because those models can be genuinely different sizes; two roles naming the same model share one window, because the context record is cached per model. A value there replaces the discovered window for that model, skips the probe entirely, and every derived budget follows from it; clearing one model's window returns it to automatic discovery and leaves the others alone. A provider context rejection no longer shrinks a user-supplied window silently: the disagreement is recorded as a `context_window_conflict` run event instead. Ingest, Query and Lint still repack the rejected request and complete; Init plans its splits from the window up front, so it fails with a bootstrap error — now with the conflict recorded rather than silently.

### Fixes
- fix(vision): size image and PDF analysis from the vision model's own context window instead of the chat model's. Nothing resolved a context record for `vision.model`, so PDF page batches were packed against the text model's budget — on a 128k chat model that is ~21 pages in one call to a possibly 8k-window vision model, which the provider rejects and Format reports as "Vision skipped" with the attachment silently missing from the index. Vision now resolves its own record and receives its own input, output and calibration values; an input or output budget you set on the Format operation still caps the vision call, so only the window it is measured against changes. This applies only when a window for the vision model is actually known — advertised by the backend, or typed into its "Model context window" field. When nothing is known, vision keeps being sized from the Format operation's budget exactly as before, because the 8192-token fallback is not a measurement of the vision model and budgeting from it would leave less room than a single image costs. Vision's own calls do not feed the context store, so a provider rejection of a vision request is recovered inside the run and not remembered; a vision model learns a window only when the same model also serves a chat operation.
- fix(vision): explain a Vision attachment skipped for size. Both size refusals are decided before the request is sent, so the provider's answer explains nothing and the budget telemetry that would is agent-log-only. The "Vision skipped" warning now names the vision model and the setting that changes it, plus — when a window is known — the window it was measured against and whether it was configured, discovered or learned. With no window known it says instead that the backend advertises no window for this model and the request was sized from the Format operation's budget, naming no number. The message is English regardless of the interface language.
- fix(native-agent): judge a calibration sample by the factor it implies (`appliedCalibration × ratio`) rather than by the raw ratio. A record parked near a clamp produces corrective samples whose raw ratio falls outside the plausible band, so the old gate discarded every one of them — a record stuck at 3.0 against a true factor of 1.0 discarded 80 of 80 samples and could never recover.
- fix(llm): measure prompt budgets in tokens instead of serialized bytes, so Init no longer fails with "domain was not created" purely because of source size.
- fix(llm): price prompt characters by class instead of one flat rate for everything but Cyrillic. The flat 4.2 characters-per-token was a prose rate, so a prompt of shell commands, config files, iptables rules and JSON was counted as if it were prose: on a live Linux-notes vault the estimate tracked the provider on 3.5k-token prompts and fell 22% short on a 17.6k-token one, and because the shortfall is a slope, not a constant, no calibration factor — a single multiplier — could remove it. Letters and the spaces that bind them into words, Cyrillic, and digit/symbol runs now carry their own rates, fitted by non-negative least squares against the counts a real tokenizer produces over 973 real texts, then scaled up against the provider's own input counts for 82 recorded live prompts. Across those prompts the size-dependence is gone (correlation with prompt size falls from -0.87 to -0.03) and every one lands inside the 15% band, biased upward. No text can cost more than one token per UTF-8 byte, which the run charge alone could exceed on numeric-dense lines. Chunk boundaries move with the rates — line-window sizing sums the unrounded per-line parts, charges a joined line break what the estimator charges it, and caps once per range, the way the estimator caps once per string — so an existing domain needs `Init --force` to re-chunk.
- fix(init): split oversized bootstrap evidence at evidence-unit granularity and merge the split groups back, instead of failing on source size. A size condition that no split can resolve now reports the model and its context window rather than a configuration error.
- fix(llm): let a generation truncated by the output limit retry with a per-request output ceiling computed from the prompt actually dispatched, instead of retrying with the same limit.
- fix(lint): measure Lint work items and batches in tokens instead of bytes, so Lint packs the requests its budget allows.
- fix(settings): clearing a per-operation native budget now stays cleared across a restart, instead of being refilled from a stored default and silently disabling automatic budgeting.
- fix(settings): the automatic budget placeholders now follow a context window edited in the same session. They were computed once when the tab was drawn, so the derived numbers kept showing the old window until the settings tab was reopened. The dependent controls are repainted in place instead of re-rendering the tab, which would rebuild the field being typed into.
- fix(init): report a provider context rejection during domain bootstrap. Init has no repack loop, so such a rejection used to end the run without ever reaching the model-context store — no learned window, and no diagnostic.
- fix(native-agent): correct the token calibration against the factor that actually produced the estimate. The factor is fixed for a whole run while the stored value moves with every sample, so correcting against the stored value folded the same bias in once per sample: an estimator running 4.7% low settled the factor at 25% high after eight samples, and the next run then oversized every estimate by a fifth and packed a fifth less into each prompt.
- fix(telemetry): the `context_probe` event no longer reports `matchedById: false` for a model the endpoint did list — "no such model" and "model found, no window advertised" are now two separate facts in the log.

### Other
- Chunk boundaries moved with the token-based estimator. Rebuild an existing domain with `Init --force` to re-chunk it; existing domains are not re-indexed automatically.
- chore(telemetry): add an `evidence_split` run event recording how bootstrap evidence was divided, alongside the existing budget, context-probe and calibration telemetry. All of it goes to `agent.jsonl` only.
- chore(telemetry): `calibration_sample` now carries `appliedCalibration`, the factor the estimate was produced with, so the implied factor can be read off one `agent.jsonl` line instead of joining back to that run's `budget_resolved` record.

---

## 0.2.3 — 2026-08-11

### New
- feat: retain and type bootstrap evidence

### Fixes
- fix: reduce terminal run status from outcomes
- fix: scope Init file attempt failures
- fix: bound evidence mapper recovery

### Other
- perf: reuse authoritative bootstrap evidence
- perf: pack evidence ranges by prepared budget

---

## 0.2.2 — 2026-07-29

### New
- feat(ingest): add a testable audit-snippets module for evidence-quality checks and fix prose false positives in evidence audits
- feat(query): reserve a context-budget slot for otherwise-uncovered question facets
- feat(query): support technical units that match a selected article's own title

### Fixes
- fix(ingest): carry over and dedupe evidence across cross-source page rewrites, tolerate shell line continuations
- fix(query): strip trailing sentence period from extracted technical paths
- fix(query): repair Markdown residue (empty emphasis, dangling markers, doubled backticks, empty parens) left after grounding sanitation

---

## 0.2.1 — 2026-07-27

### Fixes
- fix: satisfy Obsidian publication review rules

---

## 0.2.0 — 2026-07-27

### New
- feat(settings): add operation-specific model policies, configurable budgets, separate connection and idle timeouts, and Vision diagnostics
- feat(prompts): add semantic compression profiles for bounded context preparation
- feat(llm): enforce prompt governance and add request-scoped native retry execution
- feat(ingest): add lossless Markdown chunking and guarded section patches
- feat(ingest): add bounded evidence map-reduce synthesis with deterministic context packing
- feat(query): bound answer and chat context
- feat(lint): batch findings within prompt budgets
- feat(format): segment oversized notes safely
- feat(vision): batch recognition records within model limits
- feat(progress): show human-readable model request lifecycle states

### Fixes
- fix(llm): harden prompt budgets, compact repairs, retries, cancellation, desktop transport, and operation-aware generation
- fix(ingest): preserve technical evidence, canonical routing, section structure, and field-framed Markdown boundaries
- fix(query): improve context selection, grounding validation, WikiLink reuse, and response completion
- fix(init): make reinitialization transactional with quarantine, exact rollback, and bounded wipe ownership
- fix(storage): isolate structured index records and preserve index integrity
- fix(progress): preserve reasoning state and close failed, cancelled, and validated operations correctly
- fix(claude): harden stream transport, final reasoning delivery, and temporary prompt cleanup
- fix(audit): correlate requests and retries while bounding telemetry, manifests, and wipe proofs
- fix(settings): validate model policies and scope operation controls correctly
- fix(ui): localize progress states and distinguish local acceptance, repair, and domain rejection
- fix(vision): use a reliable nondegenerate model probe
- fix(log): isolate oversized agent records

---

## 0.1.204 — 2026-07-16

### New
- feat(retrieval): dedupe chunks before rerank in both query paths
- feat(ingest): guarantee incoming sections survive a dedup merge
- feat(view): swap ask buttons — Ask Domain primary, Ask Wiki secondary

---

## 0.1.203 — 2026-07-16

### New
- feat(ingest): add OKF ## Sources body sections with navigable source links
- feat(init,ingest): stream LLM reasoning and token deltas during structured domain creation
- feat(structured-output): add runStructuredStreaming live bridge helper
- feat(structured-output): emit live reasoning/content deltas during streaming calls

### Fixes
- fix(settings): remove the wiki folder when deleting a domain
- fix(init): base resume decisions on entity_types instead of analyzed_sources
- fix(init): preserve metadata.jsonl during force-reinit wipes
- fix(init,ingest): stop recreating !Wiki/_config and enforce per-type page routing
- fix(domain-store): parse tmp metadata before promotion so corrupt tmp files stay intact
- fix(domain-store): recover domains from leftover metadata.jsonl.tmp files on load
- fix(domain-store): write metadata directly, verify persistence, and surface registerDomain save failures

---

## 0.1.202 — 2026-07-15

### New
- Per-model availability Check buttons on the chat, embedding, and reranker model selectors (left of refresh); each reports the real endpoint error on failure
- `effectiveSubfolder` fallback — entity types with an empty `wiki_subfolder` now route to a valid per-type folder everywhere (ingest path, tags, lint/sidebar counts)
- Embedding failures now surface the real reason (`failReason`); the `dimensions` parameter is opt-in

### Fixes
- Embedding and reranker calls no longer fail at runtime with `Failed to resolve module specifier 'obsidian'` — the true cause of `per-entity retrieval failed for all entities`; obsidian's `requestUrl` is now loaded via a local re-export
- Init fails fast on a genuine embedding-endpoint failure (one clear error, stops the run) instead of grinding file-by-file
- Init fails loud when bootstrap can't derive entity types, instead of silently continuing with empty types (which dumped every page into `entities/`)
- Empty-subfolder entity types are counted and tagged correctly (lint, sidebar, tags, ingest)
- `checkDimensions` guards on probe presence, not error truthiness

### Other
- Centralized the wiki page-vs-meta filter on `isWikiPagePath`

---

## 0.1.201 — 2026-07-15

### New
- feat(wiki-path): add sidecar/meta predicates, drop legacy _config whitelist

### Fixes
- fix(phases): use isWikiPagePath so jsonl sidecars are not treated as pages
- fix(page-similarity): allFailed only on genuine embedding failure, not empty index
- fix(storage): remove empty global and per-domain _config folders on load
- fix(wiki-path): keep strict 2-segment article-path rule, reject meta paths

---

## 0.1.200 — 2026-07-14

### Fixes
- fix: remove deleted domain metadata from registry

---

## 0.1.199 — 2026-07-14

### New
- feat(phases): add shared structured output runner
- feat(phases): add framed output parsers
- feat(format): route large output through framed zod
- feat(ingest): use framed zod for markdown outputs
- feat(phases): use framed zod for large text repairs

### Fixes
- fix(output): centralize response-format repair
- fix(format): disable json mode for framed output
- fix(storage): stop runtime per-domain _config creation
- fix(agent-runner): block retry after destructive prelude
- fix(prompts): remove json field wording from lint frames
- fix(ingest): preserve framed path repair retry and report empty path repair retries
- fix(format): enforce frontmatter schema for framed output
- fix(phases): expose structured output fallback diagnostics
- fix(phases): reuse llm utils in structured runner
- fix(phases): emit structured retry recovery event
- fix(phases): anchor framed output markers
- fix(types): expand structured output diagnostics
- fix(reranker): restore capped array typecheck

---

## 0.1.198 — 2026-07-14

### Fixes
- fix(retrieval): remove runtime boilerplate demotion controls

---

## 0.1.197 — 2026-07-13

### New
- feat(settings): move OKF export into per-domain settings and clarify backend endpoint configuration

---

## 0.1.196 — 2026-07-13

### New
- feat: add guarded runtime reranker
- feat(query): enable rank-only boilerplate demotion
- feat(eval): add runtime-equivalent demotion gate
- feat(query): enable runtime boilerplate demotion
- feat(retrieval): add boilerplate demotion scoring
- feat(eval): compare demoted retrieval variants
- feat(eval): add boilerplate demotion helpers
- feat(eval): add BM25 RRF A/B harness
- feat(eval): add pure BM25 ranking helper
- feat(retrieval): use lexical scorer in runtime fallback
- feat(retrieval): add weighted lexical scorer
- feat(storage): connect UI and query to JSONL domain files
- feat(storage): migrate legacy wiki service files to JSONL
- feat(storage): write wiki logs as JSONL
- feat(retrieval): store page and chunk records in index JSONL
- feat(storage): store domains in metadata JSONL
- feat(storage): add JSONL helpers and service paths

### Fixes
- fix(settings): show boilerplate demotion controls
- fix(retrieval): handle demotion edge cases
- fix(types): make domain metadata helper type-safe
- fix(eval): show gold grades and variant deltas
- fix(eval): dedupe BM25 query terms
- fix(storage): preserve JSONL descriptions during OKF migration

---

## 0.1.195 — 2026-07-10

### New
- feat(okf): rename wiki-page primitives to OKF-native field names and emit OKF fields in prompts.
- feat(okf): inject type and description on ingest, with governance for plain resources and body link sections.
- feat(okf): migrate existing pages to OKF-native frontmatter, relocate links to body sections, and backfill descriptions.
- feat(okf): derive overview from frontmatter description and exclude Related/External sections from retrieval.
- feat(okf): add export helpers for link rewriting, tag normalization, and title derivation.
- feat(okf): add desktop OKF export with controller entry point, command, sidebar button, destination modal, and bundle serializer.
- feat(retrieval): build clean section embedding chunks and rank chunks inside article pools.
- feat(retrieval): use selected chunk context for single-domain and cross-domain queries.

### Fixes
- fix(okf): preserve malformed or empty link frontmatter safely during relocation.
- fix(okf): parse flow-style resource fields in deletion, incremental, and vault-walk consumers.
- fix(types): resolve Obsidian typing and Claude backend TypeScript errors.
- fix(retrieval): avoid partial legacy embedding cache upgrades and require a full corpus for legacy cache migration.
- fix(retrieval): use summary vectors for article scoring and section text only for chunk scoring.
- fix(retrieval): harden selected chunk embedding ranking and reject non-finite chunk vectors.
- fix(retrieval): scope query links and single-domain index prompts to selected context.
- fix(retrieval): stop after chunk selection abort.

### Other
- refactor(okf): switch consumers to plain resource fields, remove frontmatter link synchronization, and drop obsolete FieldRule aliases.

---

## 0.1.194 — 2026-07-03

### Новое
- feat(format): resolve domain and inject tag registry block into format context
- feat(ingest): inject domain tag registry, sync entity tags, soft category limit
- feat(tags): domain tag registry module and max_tag_categories config
- feat(tags): normalize near-valid tags before TAG_RE validation

### Исправления
- fix(tags): format-prompt tag-block guard, file dedupe, strict domain path boundary

---

## 0.1.193 — 2026-06-30

### Новое
- feat(retrieval): spread-relative graph floor bar — `bfsMinScoreRatio` now positions the cutoff within the domain's cosine range `[loRef..denseMax]` (robust low reference + range guard) instead of a flat best-seed ratio; steadier graph-expansion pruning across compressed cosine ranges
- feat(retrieval): surface `floorLoRef` / `floorBar` in `graph_stats` telemetry

### Исправления
- fix(log): write the agent log to the plugin dir, not into the wiki tree

---

## 0.1.192 — 2026-06-30

### Новое
- feat(retrieval): relevance floor prunes low-relevance graph-expanded pages by comparing raw dense cosine against the best seed (`bfsMinScoreRatio`, default 0.6, `0` = off); fewer tokens, no quality loss; applies to Ask Domain and Ask Wiki
- feat(view): vector/graph breakdown in the "Selected for LLM" stat (e.g. `7 (5 vector + 2 graph)`)

### Исправления
- fix(view): space the search-stats block below the "Results" heading

---

## 0.1.191 — 2026-06-30

### Новое
- feat(view): Ask Domain / Ask Wiki buttons, remove scope selector
- feat(view): search-stats block above the answer with token fill indicator
- feat(view): resizable comment box with right-aligned Saved confirmation
- feat(query): emit query_stats events (single + cross-domain) before the answer

### Исправления
- fix(query): report capped single-domain context count
- fix(query): honor abort after query_stats event
- fix(view): keep live query stats consistent across history navigation
- fix(view): keep comment save state consistent
- fix(view): keep ask buttons disabled while running

---

## 0.1.190 — 2026-06-29

### Новое
- feat(query): cross-domain query — route '*' domain sentinel to a unified cross-domain search
- feat(query): runCrossDomainQuery orchestrator with eval coverage
- feat(query): mergeCandidates stage-2 fusion across domains with eval coverage
- feat(view): cross-domain scope toggle + lastQueryScope persistence

### Исправления
- fix(query): support cross-domain '*' rerun from history + domain names in label
- fix(view): preserve persisted query scope across domain restore
- fix(query): cross-domain language_notes in entity block + honest bfsFusion telemetry
- fix(query): derive cross-domain finalDomains from domainId, not stem parsing
- fix(query): preserve abort semantics after answerFromContext extraction

### Прочее
- refactor(query): extract retrieveDomainCandidates from runQuery
- refactor(query): extract shared answerFromContext tail
- refactor(query): surface indexContent on DomainCandidates, validate wikiVaultPath

---

## 0.1.189 — 2026-06-28

### Новое
- feat(view): shared renderResultFor + comment box — historical rating without cross-run leak
- feat(eval): comment field + readEvalRecord/updateEvalComment by runId
- feat(controller): readRun/commentRun wrappers (dev-mode gated)
- feat(i18n): comment box labels (en/ru/es)
- feat(eval-report): read per-axis ratings map with scalar fallback + comment count
- feat(dspy/optimizer): primary-axis up signal + comment seed-feedback block
- feat(dspy/loader): primary-axis signal with scalar fallback + comment passthrough

### Исправления
- fix(view): generation guard in renderResultFor — no stale ratingSection on rapid history re-clicks

---

## 0.1.188 — 2026-06-26

### Новое
- feat(eval): ratings map + OPERATION_AXES registry + per-op provenance fields
- feat(view): registry-driven per-op rating rows; clear ratingSection + format preview on reset
- feat(i18n): rating axis labels for retrieval/page/links/coverage/fix/rebuild (en/ru/es)
- feat(ingest): emit eval_meta provenance (sources + created/updated/found pages + promptVersion)
- feat(init): emit eval_meta provenance (files_processed + domain + promptVersion)
- feat(lint): emit eval_meta provenance (articles + promptVersion)
- feat(lint-chat): emit eval_meta provenance (articles + instruction + promptVersion)
- feat(delete): emit eval_meta provenance (deleted_source + rebuilt_pages); isolate inner ingest meta

---

## 0.1.187 — 2026-06-26

### Новое
- feat(styles): add dev-mode rating button selected-state CSS

### Исправления
- fix(view): reflect persisted rating in 👍/👎 buttons; updateEvalRating returns Rating

---

## 0.1.186 — 2026-06-26

### Новое
- feat(lint): delete empty entity types (folder + config) after lint
- feat(modals): default empty entity types to OFF in Lint modal
- feat(view): disable Ingest button on wiki articles
- feat(vault-tools): add rmdir wrapper for removing a specific folder

---

## 0.1.185 — 2026-06-25

### Новое
- feat(dev-eval): rewrite eval as quality + telemetry report over eval.jsonl
- feat(dev-eval): dspy optimizes from 👍/👎 ratings via binary metric, replacing LLM judge
- feat(dev-eval): emit eval_meta + rule_fired telemetry events from query/chat/format (+ visionCount, runId)
- feat(dev-eval): accumulate telemetry and write per-run eval-log record (schema + write/rate helpers)
- feat(dev-eval): render 👍/👎 rating rows on query/chat + format axes
- feat(dev-eval): thread runId + plugin dir; add controller.rateRun
- feat(dev-eval): migrate dev/agent logs from vault to plugin dir on load
- feat(dev-eval): remove evaluator model setting UI; swap evaluator i18n strings for rating strings
- feat(dev-eval): add prompt content-hash util for provenance

### Исправления
- fix(dev-eval): type eval-log adapter as VaultAdapter to match call sites

### Прочее
- refactor(dev-eval): remove retrieval Recall@k/MRR harness
- refactor(dev-eval): remove LLM judge (evaluator phase + prompt)

---

## 0.1.184 — 2026-06-25

### Новое
- feat(incremental): hash-based source change detection
- feat(domain): analyzed_sources map + v3 migration
- feat(incremental): wire analyzed_sources map + hash-at-ingest

---

## 0.1.183 — 2026-06-24

### Новое
- feat(query): deterministic WikiLink resolver for broken links, with zod-validated LLM fallback and valid-stem listing in the answer prompt
- feat(incremental): incremental reinit mode — Full/Incremental selector modal, pure changed-source detection (VaultTools.mtime + VaultAdapter.stat), re-ingest changed sources without wiping the vault
- feat(llm): export and strengthen reasoning/answer language directives
- feat(controller): log consolidated model reasoning to _agent.jsonl
- feat(vision): honor reasoningLanguage in attachment analysis

### Исправления
- fix(incremental): parse wiki_sources wikilinks to bare stems + file sources

### Прочее
- refactor(ingest)!: write source frontmatter before wiki pages (A2 ordering)
- refactor(query): remove orphaned rewriteWithValidLinks, tidy fallback diagnostics

---

## 0.1.182 — 2026-06-23

### Новое
- feat(claude-cli): probe Claude binary via spawn, with out-of-vault eval coverage

### Исправления
- fix(settings): Test connection now uses a spawn probe; dropped fs/promises import
- fix(deps): bump undici ^6.25.0 → ^6.27.0 (GHSA-p88m-4jfj-68fv)

---

## 0.1.181 — 2026-06-22

### Новое
- feat(wiki-links): stripDeadLinks — remove dead `[[links]]` from body + re-sync frontmatter
- feat(ingest): strip dead links + always-index + reconcile index
- feat(lint): strip dead-link bodies + bidirectional index reconciliation
- feat(wiki-index): reconcileIndex — bidirectional `_index.md` ↔ disk diff
- feat(wiki-index): deriveFallbackAnnotation — H1 + first sentence + Type
- feat(wiki-path): add isWikiArticlePath predicate with headless eval

### Исправления
- fix(wiki-hygiene): tidy adjacent-link spacing, CRLF frontmatter, code-fence skip
- fix(wiki-index): replace lookbehind with lookahead (iOS <16.4 compat)
- fix(view): keep Format button active for any non-wiki markdown file

### Прочее
- refactor(source-deletion): reuse isWikiArticlePath in isSourceFile

---

## 0.1.180 — 2026-06-21

### Новое
- feat(rerun): pure resolveRerunDomain helper with headless eval coverage

### Исправления
- fix(rerun): history re-run uses the stored domainId instead of defaulting to domains[0]

---

## 0.1.179 — 2026-06-21

### Новое
- feat(delete): delete a source from the sidebar — Delete button with a confirmation modal (DeleteSourceModal) showing affected page counts and a permanent-deletion warning; Format/Delete gated to source files via isSourceFile
- feat(delete): runDelete phase wipes generated pages, rebuilds the index via runIngest, and conditionally removes the source file; emits a source_path_removed domain event

### Исправления
- fix(delete): keep the source file when deletion is cancelled (F-002) and allow delete on mobile
- fix(delete): disable the Delete button while an operation is running
- fix(delete): suppress inner ingest result events during rebuild
- fix(delete): map the delete op to its ingest config key in buildOptsFor
- fix(delete): stripSourceToken trims whitespace before stripping quotes/brackets

---

## 0.1.178 — 2026-06-20

### Новое
- feat(view): mobile Format button (vision-capable)
- feat(vision): mobile vision via imageOnly path — skips PDF/Excalidraw cleanly
- feat(settings): hide chunking + graph-health on mobile (ingest/lint only)
- feat(retrieval): obsidian-free seed-gate with denseMax/embedFailed diagnostics + retrieval-tag helpers
- feat(view): retrieval tag in compact output + trace progress
- feat(types): expose retrievalMode/denseMax/seedFallbackReason in graph_stats

### Исправления
- fix(query): gate seeds on dense cosine, not RRF-fused score
- fix(modals): exclude !Wiki output from domain source-path suggestions

---

## 0.1.177 — 2026-06-19

### Новое
- feat(lang): add reasoning-language setting with dropdown and reasoning-directive injection
- feat(lang): content auto-language now follows the Obsidian locale (dropped follow-source mode)
- feat(i18n): localized progress groups and view file labels for ingest/lint/init (en/ru/es)
- feat: one-shot on-load migration removing legacy wiki sections
- feat(schema): stop generating related-concepts and change-history sections

### Исправления
- fix(format): strip residual sentinel markers with a final-sweep helper before write
- fix(format): order-robust parseSentinelOutput vision body slice
- fix(lang): resolve wikiSections and evaluator language; correct auto dropdown label
- fix(progress): localize view, ingest, lint and init status strings by output language

### Прочее
- refactor(i18n): rename resolveProgressLang to resolveLang (shared across progress + reasoning)

---

## 0.1.176 — 2026-06-18

### Исправления
- fix(ingest): recover and re-fence broken source frontmatter (dup keys, block-list, stranded body) so wiki_* backlinks are restored
- fix(format): restore broken frontmatter in the preview, not only on apply
- fix(format): progress stream follows outputLanguage (fallback UI locale)

### Прочее
- refactor(format): extract restoreSourceFrontmatter, always normalize on apply

---

## 0.1.175 — 2026-06-17

### Исправления
- fix(prompt): translate source field values (table cells, eval prompt/expected/notes), not just narrative — reinforced in the wiki schema; `[[wiki-link]]` targets, code, and proper names stay verbatim (compliance is model-dependent)

---

## 0.1.174 — 2026-06-17

### Исправления
- fix(ingest): pass vault-relative path, not OS-absolute — fixes Windows path doubling on CJK directory/file names (issue #14)

---

## 0.1.173 — 2026-06-17

### Исправления
- fix(prompt): translate quoted source prose into output language

---

## 0.1.172 — 2026-06-17

### Исправления
- fix(vault-tools): self-healing NFC/NFD read with diagnostics
- fix(vault-tools): write-guard resolves NFC/NFD target to avoid duplicates

---

## 0.1.171 — 2026-06-17

### Новое
- feat: global outputLanguage setting across all operations
- feat(prompt): add term-preservation rule to base contract
- feat(wiki-index): tolerant parseIndexAnnotations + shared pidLineRegex
- feat(wiki-index): upsert emits bracketless '- pid — annotation' lines
- feat(migrate-index-format): content-detecting _index.md format migration
- feat(main): run migrateIndexFormat on plugin load
- i18n(prompts): translate all prompts/templates to English

---

## 0.1.170 — 2026-06-16

### Исправления
- fix(embeddings): persist embedding cache in hybrid retrieval mode (previously only pure-embedding mode persisted, so hybrid re-embedded the corpus on every query or fell back to Jaccard after restart)
- fix(embeddings): send `dimensions` to the /embeddings API when configured (OpenAI MRL) instead of using it as a cache-key label only; add dimension probe plus Check/Default buttons in settings with auto-detect on model select

---

## 0.1.169 — 2026-06-15

### Новое
- feat(settings): localized numeric setting descriptions with examples and recommended ranges (en/ru/es)

---

## 0.1.168 — 2026-06-15

### Новое
- feat(search): multi-vector hybrid index — per-section chunking + max-pool scoring for recall-first retrieval
- feat(search): hybrid retrieval mode fusing dense embeddings with Jaccard via reciprocal rank fusion (RRF)
- feat(query): query-time vector⊕graph fusion (RRF over seeds + BFS union) behind a BFS-fusion toggle
- feat(query): seed similarity threshold with Jaccard→LLM fallback, surfaced in the query trace
- feat(ingest): near-duplicate dedup gate — cosine pre-filter + LLM-merge on ingest
- feat(lint): near-duplicate page report with settings toggles
- feat(settings): new toggles — chunking controls, hybrid retrieval + rrfK, BFS fusion, seed similarity threshold, graph-health flags
- feat(eval): RAG retrieval eval harness — gold-set parser, recall@k/MRR metrics, config matrix, CLI report

### Исправления
- fix(similarity): preserve section vectors for pages ingested without a body (incremental ingest)
- fix(similarity): guard truncated embeddings response
- fix(similarity): strip H1 even with a blank line after frontmatter
- fix(ingest): count and log dedup-merges correctly
- fix(eval): loadWikiPages recurses into wiki subfolders

### Прочее
- refactor(graph): extract shared inDegree helper from checkGraphStructure
- refactor(similarity): drop dead byPath map in hybrid scoring

---

## 0.1.167 — 2026-06-08

### Новое
- feat(vision): per-run VisionTempStore caches each attachment's description and rendered excalidraw PNG under the plugin directory, enabling resume across idle-retries
- feat(format): resume vision descriptions from the temp store with write-through on analyze — each attachment is sent to the LLM at most once per run
- feat(vault-tools): add writeBinary for binary attachment persistence

### Исправления
- fix(agent-runner): reset the idle watchdog on tool_use/tool_result so per-attachment vision progress no longer trips a cumulative-time abort (format on pages with several excalidraw attachments no longer loops)
- fix(vision): guard the VisionTempStore cache against keyFor path collisions

---

## 0.1.166 — 2026-06-07

### Новое
- feat(schema): bundle schemas for release-driven delivery — single source of truth in templates/, runtime no longer reads or writes _wiki_schema.md / _format_schema.md in the vault; stale copies are cleaned up on load (cleanupBundledSchemaCopies), removing bundled↔vault drift and manual-edit overwrite conflicts
- feat(vision): structured, business-level diagram descriptions — read the canvas verbatim as a silent internal step, then emit a logical description of the scheme's meaning (purpose, components, flow) instead of an element-by-element dump; image/PDF additionally recreate structure as mermaid/table, excalidraw stays prose/lists

---

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
