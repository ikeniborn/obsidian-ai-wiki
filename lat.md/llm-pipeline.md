# LLM Pipeline

How LLM calls are assembled, executed, and validated. All calls go through `buildChatParams`; structured calls go through `parseWithRetry`.

## Prompt Files

All LLM instruction text lives in `prompts/*.md`, imported as a string via the esbuild `.md` text loader (type declared in [[src/md-modules.d.ts]]) and substituted with [[src/phases/template.ts#render]] (`{{key}}` placeholders). No prompt text is hardcoded in `.ts` source.

Beyond the per-phase prompts (`base.md`, `chat.md`, `query.md`, `ingest.md`, `lint.md`, …), these were extracted from inline string literals:

| File | Used by | Placeholders |
|---|---|---|
| `vision-structure.md` | shared rules for image/pdf | — |
| `vision-image.md` | [[src/phases/attachment-analyzer.ts#imageSystem]] | `structure_rules`, `lang` |
| `vision-pdf.md` | [[src/phases/attachment-analyzer.ts#pdfSystem]] | `structure_rules`, `lang` |
| `vision-excalidraw.md` | [[src/phases/attachment-analyzer.ts#excalidrawSystem]] | `lang` |
| `lint-actualize.md` | `actualizeDomainConfig` in [[src/phases/lint.ts]] | — (static) |
| `query-seeds.md` | seed selection in [[src/phases/query.ts]] | `question`, `annotated`, `unindexed`, `example` |
| `query-fix-links.md` | [[src/phases/query-link-validator.ts#rewriteWithValidLinks]] | `broken`, `available` |
| `repair-json.md` | [[src/phases/parse-with-retry.ts#formatZodFeedback]] | `detail` |
| `format-restore-tokens.md` | token-restore retry in [[src/phases/format.ts]] | `tokens` |
| `ingest-fix-paths.md` | path-correction retry in [[src/phases/ingest.ts]] | `paths` |

The dynamic parts (error bullets, JSON example, language switch via `langInstruction`, token/path lists) stay in code; only the instruction text moved to `.md`. Short user-message scaffolding labels (`Источник: `, `Вопрос: `) remain inline — data framing, not prompts. Contract checks in [[tests/prompts.test.ts]] assert each file's placeholders and that `render` leaves no leftover braces.

## buildChatParams

Assembles the final `messages[]` array for an LLM call. Always prepends `base.md` as the system message via `prependBaseContract`. If `opts.systemPrompt` is set, appends `## Уточнение\n<prompt>` to the system message.

When `opts.outputLanguage` is set, it also appends a `## Язык` directive (from [[src/phases/llm-utils.ts#langInstruction]]) to the system message.

Also applies model params: `temperature`, `maxTokens`, `topP`, `response_format`, `thinkingBudgetTokens`. Thinking mode removes `response_format`, `temperature`, `top_p`. See [[src/phases/llm-utils.ts#buildChatParams]].

## Evaluator Prompt Pattern

Only phase that sends no system message to `buildChatParams`. `prependBaseContract` creates `system = base.md` from scratch. `evaluator.md` renders into user role — unlike all other phases where the phase prompt is the system message.

See `src/phases/evaluator.ts`.

## parseWithRetry

Runs a structured LLM call with Zod validation and automatic retry on failure. On JSON parse failure or Zod schema mismatch, the previous response + error feedback is appended as a new user message.

Retries up to `maxRetries` times. Emits `structural_error` events on each attempt. Throws `StructuredValidationError` when retries are exhausted. See [[src/phases/parse-with-retry.ts#parseWithRetry]].

### Call Sites

Each call site ties a phase to a Zod schema for structured output validation.

| callSite | Phase | Zod Schema |
|---|---|---|
| `ingest.entities` | ingest | `EntitiesOutputSchema` |
| `ingest.pages` | ingest | `WikiPagesOutputSchema` |
| `init.bootstrap` | init | `DomainEntrySchema` |
| `lint.fix` | lint | `LintOutputSchema` |
| `lint.patch` | lint (actualize) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | lint-chat | `LintChatSchema` |
| `query.seeds` | query | `SeedsSchema` |
| `format.output` | format | `FormatOutputSchema` |

See [[src/phases/zod-schemas.ts]], [[src/phases/schemas.ts]].

### WikiPageSchema Constraints

`WikiPageSchema` rejects alias (`[[Page|alias]]`) and path (`[[folder/page]]`) links in the page **body** via `superRefine`. Frontmatter is not checked.

`superRefine` extracts body by finding the closing `---` of the frontmatter; only body content is scanned. Violations produce a Zod error that triggers a retry. `wiki_sources`, `wiki_outgoing_links`, and `wiki_articles` all use bare names (`[[PageName]]`) — no path, no alias.

## WikiLink Validation

Programmatic WikiLink fixer runs after `parseWithRetry` in ingest, format, and lint phases. Fixes format violations without LLM retry.

Violations detected: `alias` (`[[X|Y]]`), `path` (`[[folder/page]]`), `inline-json` (`wiki_outgoing_links: ["..."]` non-empty inline array), `outgoing-desync` (body links ≠ `wiki_outgoing_links` field). Dead links produce warnings only — never block writes.

`extractFmLinks` reads only items under the `wiki_outgoing_links:` YAML key — not from `wiki_sources` or other list fields. The canonical empty form `wiki_outgoing_links: []` is not flagged as `inline-json` (only non-empty inline arrays trigger the violation). `fixOnePass` deduplicates body links before writing to frontmatter, preventing duplicate entries when a page mentions the same target twice.

`knownStems` for dead-link detection is built from **all `.md` files in the vault** (via `vaultTools.listFiles("")`), not just wiki pages. This prevents false-positive warnings for links pointing to source files or notes outside `!Wiki/`.

Warning events (`info_text`) are always emitted **after** all vault writes complete, never before. This ensures warnings appear at the end of the progress stream rather than interrupting write progress.

Lint adds a **bucket repair pass** after `fixWikiLinks` and before `filterStaleWikiLinks`: calls `validateAndRepairWikiPageFrontmatter` on every wiki page, writes corrected content if changed, and yields `info_text` events listing the repairs. This catches wrong-bucket stems that persist after ingest.

Configured via `wikiLinkValidationRetries` (default=3, 0=validate-only). See [[src/wiki-link-validator.ts]].

## wrapWithJsonFallback

Transparent wrapper applied to the LLM client in `AgentRunner`. On 400/422 with "json_object" or "unsupported" in the error body, retries the request without `response_format`.

Allows the same phase code to run against models without structured output support. See [[src/phases/llm-utils.ts#wrapWithJsonFallback]], [[src/agent-runner.ts#AgentRunner]].

## Structural Error Counter

Singleton observable that counts `structural_error` events across all calls. Displayed in the status bar as `schema: failed/total`. Updated by each `parseWithRetry` attempt.

See [[src/structural-error-counter.ts#structuralErrorCounter]].

## LLM Progress Events

Every LLM call in every phase emits a `tool_use` event immediately before the call and a `tool_result` event immediately after. This gives the user a visible waiting indicator (🔧 step in the progress panel) instead of a silent hang.

For `parseWithRetry` calls: `tool_use name: "<descriptive label>"` (e.g. `"Synthesising pages"`, `"Analysing wiki"`, `"Applying fixes"`) with optional `input` fields for context. On success, `tool_result ok: true` with a short preview (e.g. `"12 fixes"`). On failure, `ok: false` with the error message; `parseWithRetry` events (`llm_call_stats`, `structural_error`) are still forwarded after the `tool_result`.

For streaming calls (query, chat, format): same `tool_use` before the stream (e.g. `"Answering"`, `"Responding"`, `"Formatting"`), `tool_result` after the stream completes with `preview: "N chars"`.

The UI renders `tool_use` as a 🔧 step with `liveStatus` showing the call site name. `tool_result` completes the step with duration and starts the ⏳ waiting ticker for the next phase. See [[src/view.ts]].

## Streaming

Free-text operations (query, chat, format reasoning) use streaming. `extractStreamDeltas` extracts `content` and optional `reasoning` deltas per chunk. `isReasoning: true` marks thinking tokens.

`wrapStreamWithStats` wraps any streaming call to measure per-call timing. It tracks TTFT, total duration, and token counts, then builds a `llm_call_stats` event via `buildLlmCallStatsEvent`. The caller emits this event after the stream is consumed.

Mobile backend uses `wrapMobileNoStream` for non-streaming polling instead. Because `wrapMobileNoStream` awaits the full HTTP response before returning the emulated AsyncIterable, all chunks arrive synchronously in <10ms — `wrapStreamWithStats` detects this (`llmDurationMs < 10`) and substitutes `ttftMs` (full round-trip time) as effective duration for tok/s calculation, preventing inflated million-tok/s values. See [[src/phases/llm-utils.ts#extractStreamDeltas]], [[src/phases/llm-utils.ts#wrapStreamWithStats]], [[src/mobile-llm-wrap.ts#wrapMobileNoStream]].

## Format Sentinel

The format phase uses sentinel markers instead of JSON to delimit structured output from the LLM. The LLM is instructed to wrap its response in `<<<REPORT>>>`, `<<<FORMATTED>>>`, and `<<<END>>>` blocks.

`parseSentinelOutput` extracts the three sections from the raw stream text. If `<<<END>>>` is missing, the output is salvaged from the partial response and an `info_text` event with "salvage" in the summary is emitted. When neither the initial call nor a single retry produces a valid `<<<FORMATTED>>>` marker, `runFormat` emits an `error` event. The vision descriptions channel is a separate side-channel inside the sentinel response, not part of the formatted content. See [[src/phases/format-utils.ts#parseSentinelOutput]].

### Query Link Validation

Post-stream step in `runQuery` that validates wiki links against known vault stems. When `validationRetries > 0` and broken links are found, a non-streaming LLM rewrite is attempted; otherwise broken links are annotated with `*(нет в wiki)*`.

The `FixingLinks` tool_use event signals the rewrite pass. If rewrite fails or the signal is aborted, the original answer is annotated as fallback. See [[src/phases/query-link-validator.ts#rewriteWithValidLinks]].
