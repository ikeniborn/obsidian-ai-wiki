# LLM Pipeline

How LLM calls are assembled, executed, and validated. All calls go through `buildChatParams`; structured calls go through `parseWithRetry`. See [[architecture#AgentRunner]].

## Prompt Files

All LLM instruction text lives in `prompts/*.md`, imported as a string via the esbuild `.md` text loader (type in `src/md-modules.d.ts`) and substituted with `src/phases/template.ts#render` (`{{key}}` placeholders). No prompt text is hardcoded in `.ts` source.

Beyond per-phase prompts (`base.md`, `chat.md`, `query.md`, `ingest.md`, `lint.md`, …), extracted prompts include vision rules (`vision-structure.md`, `vision-image.md`, `vision-pdf.md`, `vision-excalidraw.md`), `lint-actualize.md`, `query-seeds.md`, `query-fix-links.md`, `repair-json.md`, `format-restore-tokens.md`, `ingest-fix-paths.md`. Dynamic parts (error bullets, JSON examples, token/path lists) stay in code.

## buildChatParams

Assembles the final `messages[]` array for an LLM call (`src/phases/llm-utils.ts`). Always prepends `base.md` as the system message via `prependBaseContract`. If `opts.systemPrompt` is set, appends `## Clarification` to the system message.

When `opts.outputLanguage` is set, appends a `## Language` directive (from `langInstruction`). Applies model params: `temperature`, `maxTokens`, `topP`, `response_format`, `thinkingBudgetTokens`. Thinking mode removes `response_format`, `temperature`, `top_p`.

The `base.md` `## Terms` contract governs what survives translation: ALL natural-language content — including sentences, descriptions, notes, and field values quoted/copied from the source (e.g. CJK) — is rendered in the output language. Only atomic items stay verbatim: code and fenced code blocks, file paths, identifiers, commands, product/proper names, abbreviations, and Obsidian embeds. This prevents quoted source prose (e.g. eval-set prompt/expected fields) from leaking the source language onto generated pages.

The page-generation phases (`ingest`, `lint`, `init`) reinforce this in `templates/_wiki_schema.md` (`## Language and style`): table cell values, field values, list items, and quoted sentences copied from the source must also be translated, while `[[wiki-link]]` targets stay verbatim (they are filenames). Compliance is model-dependent — strongly-instruction-following models translate these reliably, but some models still preserve recognizable literal data (e.g. eval `prompt`/`expected` test inputs) regardless; this is a prompt-contract guideline, not a hard post-generation guard.

## Evaluator Prompt Pattern

Only phase that sends no system message to `buildChatParams` (`src/phases/evaluator.ts`). `prependBaseContract` creates `system = base.md` from scratch; `evaluator.md` renders into the user role — unlike all other phases where the phase prompt is the system message.

## parseWithRetry

Runs a structured LLM call with Zod validation and automatic retry (`src/phases/parse-with-retry.ts`). On JSON parse failure or Zod mismatch, the previous response + error feedback is appended as a new user message.

Retries up to `maxRetries`. Emits `structural_error` events per attempt. Throws `StructuredValidationError` when retries exhausted.

### Call Sites

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
| `format.output` | format | `FormatOutputSchema` |

### WikiPageSchema Constraints

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
