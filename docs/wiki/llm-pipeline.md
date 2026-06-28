# LLM Pipeline

## Overview

How LLM calls are assembled, executed, and validated. All calls go through `buildChatParams`; structured calls go through `parseWithRetry`. See [[architecture#AgentRunner]].

## Prompt Files

All LLM instruction text lives in `prompts/*.md`, imported as a string via the esbuild `.md` text loader (type in `src/md-modules.d.ts`) and substituted with `src/phases/template.ts#render` (`{{key}}` placeholders). No prompt text is hardcoded in `.ts` source.

Beyond per-phase prompts (`base.md`, `chat.md`, `query.md`, `ingest.md`, `lint.md`, …), extracted prompts include vision rules (`vision-structure.md`, `vision-image.md`, `vision-pdf.md`, `vision-excalidraw.md`), `lint-actualize.md`, `query-seeds.md`, `query-fix-links.md`, `repair-json.md`, `format-restore-tokens.md`, `ingest-fix-paths.md`. Dynamic parts (error bullets, JSON examples, token/path lists) stay in code.

## buildChatParams

Assembles the final `messages[]` array for an LLM call (`src/phases/llm-utils.ts`). Always prepends `base.md` as the system message via `prependBaseContract`. If `opts.systemPrompt` is set, appends `## Clarification` to the system message.

When `opts.outputLanguage` is set, appends a `## Language` directive (from `langInstruction`, layer C). Always appends a `## Reasoning language` directive (the shared exported `reasoningDirective`, also reused by the vision pre-step) resolved from `opts.reasoningLanguage` and `opts.outputLanguage` (layer B, defaults to English). See [[backends-and-config#Three-Layer Resolution]]. Applies model params: `temperature`, `maxTokens`, `topP`, `response_format`, `thinkingBudgetTokens`. Thinking mode removes `response_format`, `temperature`, `top_p`.

The `base.md` `## Terms` contract governs what survives translation: ALL natural-language content — including sentences, descriptions, notes, and field values quoted/copied from the source (e.g. CJK) — is rendered in the output language. Only atomic items stay verbatim: code and fenced code blocks, file paths, identifiers, commands, product/proper names, abbreviations, and Obsidian embeds. This prevents quoted source prose (e.g. eval-set prompt/expected fields) from leaking the source language onto generated pages.

The page-generation phases (`ingest`, `lint`, `init`) reinforce this in `templates/_wiki_schema.md` (`## Language and style`): table cell values, field values, list items, and quoted sentences copied from the source must also be translated, while `[[wiki-link]]` targets stay verbatim (they are filenames). Compliance is model-dependent — strongly-instruction-following models translate these reliably, but some models still preserve recognizable literal data (e.g. eval `prompt`/`expected` test inputs) regardless; this is a prompt-contract guideline, not a hard post-generation guard.

## Dev-Mode Eval Record

When `devMode.enabled`, `AgentRunner.run` (`src/agent-runner.ts`) assembles one `EvalRecord` per run — for **every** LLM operation (`ingest`, `query`, `lint`, `lint-chat`, `chat`, `init`, `format`, `delete`) whose run yields non-empty result text — and appends it to `<pluginDir>/eval.jsonl` (`src/eval-log.ts#writeEvalRecord`). This replaced the former LLM-judge evaluator: run quality is now human 👍/👎 labels, not a model-assigned score.

Across the run loop, `AgentRunner` accumulates telemetry from internal events the phases emit: `error`/`structural_error` → `llmErrors[]`, `rule_fired` (deterministic fixers — `resolveLink`, `annotateBroken`, `stripSentinelMarkers`, `formatSalvage`, `parseWithRetry`) → `ruleFirings{}`, and `eval_meta` merged into the record. `eval_meta` provenance is per operation: query/chat emit `question`/`answer`/`found_pages`/`retrievalConfig`; ingest emits `source_paths`/`created_pages`/`updated_pages`/`found_pages`; init emits `files_processed`/`domain`; lint/lint-chat emit `articles` (+`instruction`); delete emits `deleted_source`/`rebuilt_pages`; all carry `promptVersion` (and format carries vision fields). Ratings are stored as a `ratings: Record<axisId, Rating>` map (initialised `{}`), replacing the former scalar `rating`/`recognitionRating`. The per-operation axis set comes from one registry, `OPERATION_AXES` (`src/eval-log.ts`) — e.g. query → `answer`+`retrieval`, ingest → `page`+`links`, lint → `fix`, delete → `rebuild`, format → `formatting`+`recognition` (vision-gated). A single shared path, `src/view.ts#renderResultFor`, renders any result — the just-finished run via `finish()` and every **historical** entry reopened from the history list — so rating is no longer last-run-only. It tears down the prior `ratingSection` and rebuilds it bound to the displayed `runId`, loading persisted state via `controller.readRun` → `eval-log.ts#readEvalRecord`; a monotonic `renderSeq` generation guard drops a stale async render so a slow `readRun` can never append one entry's rows over another's. `renderRatingRow` takes the persisted `initial` rating so 👍/👎 reflect the stored label on first paint; a click calls `controller.rateRun(runId, axis)` → `updateEvalRating`, which toggles `ratings[axis]` in place by `runId` and returns the persisted value (re-click flips to `null`, styled by `is-active` in `src/styles.css`). Each result also carries one free-form `comment` per run (`renderCommentBox` → `controller.commentRun` → `eval-log.ts#updateEvalComment`), independent of the 👍/👎 label and persisted to the same `runId` record. `format` keeps its axes in the format preview (vision-gated, preview-bound), so a historical `format` entry shows its report without rating rows. Prompt provenance is a content hash (`src/prompt-version.ts#promptVersionOf`, `visionPromptVersionOf`). See [[operations#Dev-Mode Eval Dataset]] and [[architecture#AgentRunner]].

## parseWithRetry

Runs a structured LLM call with Zod validation and automatic retry (`src/phases/parse-with-retry.ts`). On JSON parse failure or Zod mismatch, the previous response + error feedback is appended as a new user message.

Retries up to `maxRetries`. Emits `structural_error` events per attempt. Throws `StructuredValidationError` when retries exhausted.

## Call Sites

Each call site ties a phase to a Zod schema (`src/phases/zod-schemas.ts`, `src/phases/schemas.ts`).

| callSite | Phase | Zod Schema |
|---|---|---|
| `ingest.entities` | ingest | `EntitiesOutputSchema` |
| `ingest.pages` | ingest | `WikiPagesOutputSchema` |
| `init.bootstrap` | init | `DomainEntrySchema` |
| `lint.fix` | lint | `LintOutputSchema` |
| `lint.patch` | lint (actualize) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | lint-chat | `LintChatSchema` |
| `query.seeds` | query | `SeedsSchema` |
| `query.answer` | query (link repair) | `makeQueryAnswerSchema` |
| `format.output` | format | `FormatOutputSchema` |

## WikiPageSchema Constraints

`WikiPageSchema` rejects alias (`[[Page|alias]]`) and path (`[[folder/page]]`) links in the page body via `superRefine`. Frontmatter is not checked.

`superRefine` extracts body by finding the closing `---` of frontmatter; only body content is scanned. Violations produce a Zod error that triggers retry. `wiki_sources`, `wiki_outgoing_links`, `wiki_articles` all use bare names (`[[PageName]]`).

## WikiLink Validation

Programmatic WikiLink fixer runs after `parseWithRetry` in ingest, format, and lint (`src/wiki-link-validator.ts`). Fixes format violations without LLM retry.

Violations: `alias`, `path`, `inline-json` (non-empty inline `wiki_outgoing_links` array), `outgoing-desync` (body links ≠ field). Dead links produce warnings only. `knownStems` is built from all `.md` files in the vault (not just wiki pages), preventing false positives for links to source files. Warning events emit after all writes. Configured via `wikiLinkValidationRetries` (default 3, 0 = validate-only).

## wrapWithJsonFallback

Transparent wrapper applied to the LLM client in `AgentRunner` (`src/phases/llm-utils.ts`). On 400/422 with "json_object" or "unsupported" in the error body, retries the request without `response_format`.

Allows the same phase code to run against models without structured-output support.

## Structural Error Counter

Singleton observable counting `structural_error` events across all calls (`src/structural-error-counter.ts`). Displayed in the status bar as `schema: failed/total`. Updated by each `parseWithRetry` attempt.

## LLM Progress Events

Every LLM call emits a `tool_use` event immediately before and a `tool_result` after, giving a visible waiting indicator instead of a silent hang.

For `parseWithRetry`: `tool_use name` is a descriptive label (`"Synthesising pages"`, `"Analysing wiki"`) with optional `input` context; on success `tool_result ok: true` with a short preview, on failure `ok: false` with the error. For streaming calls (query, chat, format): same `tool_use` before the stream, `tool_result` after with `preview: "N chars"`. The UI renders `tool_use` as a 🔧 step.

## Streaming

Free-text operations (query, chat, format reasoning) use streaming. `extractStreamDeltas` extracts `content` and optional `reasoning` deltas per chunk; `isReasoning: true` marks thinking tokens (`src/phases/llm-utils.ts`).

`wrapStreamWithStats` measures per-call timing (TTFT, duration, token counts) and builds a `llm_call_stats` event. Mobile uses `wrapMobileNoStream` (`src/mobile-llm-wrap.ts`) for non-streaming polling; because all chunks arrive synchronously (<10ms), `wrapStreamWithStats` substitutes TTFT as effective duration to prevent inflated tok/s.

## Format Sentinel

The format phase uses sentinel markers instead of JSON to delimit structured output (`src/phases/format-utils.ts`). The LLM wraps its response in `<<<REPORT>>>`, `<<<FORMATTED>>>`, `<<<END>>>` blocks.

`parseSentinelOutput` extracts the three sections. If `<<<END>>>` is missing, output is salvaged from the partial response and an `info_text` with "salvage" is emitted. When neither the initial call nor a retry produces a valid `<<<FORMATTED>>>` marker, `runFormat` emits an `error`. Vision descriptions are a separate side-channel inside the sentinel response. See [[operations#Format]].

## Order-robust body slice

The vision branch of `parseSentinelOutput` ends the formatted body at the earliest trailing marker after `<<<FORMATTED>>>` — `Math.min` of the present `<<<VISION_COUNT>>>` / `<<<EMBEDS>>>` / `<<<END>>>` positions — rather than assuming a fixed `FORMATTED < VISION_COUNT` order. This prevents a stray `<<<END>>>` emitted out of order (e.g. before `<<<VISION_COUNT>>>`) from being swallowed into the body. `visionCount` / `embeds` / `truncated` parsing is unchanged.

## Final sweep gate

`stripSentinelMarkers` (`src/phases/format-utils.ts`) is a pure defensive gate that removes any residual `<<<NAME>>>` token (whole marker lines dropped, inline residues spliced, orphaned blank-line runs collapsed, `trimEnd`-ed) and returns `{ clean, removed }`. `runFormat` calls it once at the write choke point — after `restoreSourceFrontmatter`, before `vaultTools.write` — so the base, vision, and token-restore paths all pass through it; when anything is removed it yields an `info_text` warning ("Sentinel markers stripped"). A sentinel marker physically cannot reach the written note. Verified by the out-of-vault eval `docs/superpowers/evals/2026-06-19-format-sentinel-sweep-eval.md`.
