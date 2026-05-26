# LLM Pipeline

How LLM calls are assembled, executed, and validated. All calls go through `buildChatParams`; structured calls go through `parseWithRetry`.

## buildChatParams

Assembles the final `messages[]` array for an LLM call. Always prepends `base.md` as the system message via `prependBaseContract`. If `opts.systemPrompt` is set, appends `## Уточнение\n<prompt>` to the system message.

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
| `ingest.pages` | ingest | `WikiPagesOutputSchema` |
| `init.bootstrap` | init | `DomainEntrySchema` |
| `lint.fix` | lint | `LintOutputSchema` |
| `lint.patch` | lint (actualize) | `EntityTypesDeltaSchema` |
| `lint-chat.fix` | lint-chat | `LintChatSchema` |
| `query.seeds` | query | `SeedsSchema` |
| `format.output` | format | `FormatOutputSchema` |

See [[src/phases/zod-schemas.ts]], [[src/phases/schemas.ts]].

### WikiPageSchema Constraints

`WikiPageSchema` rejects malformed wikilinks via `superRefine`. Alias links (`[[Page|alias]]`) and path links (`[[folder/page]]`) are both forbidden. Violations produce a Zod error that `parseWithRetry` treats as a structural failure and retries.

## WikiLink Validation

Programmatic WikiLink fixer runs after `parseWithRetry` in ingest, format, and lint phases. Fixes format violations without LLM retry.

Violations detected: `alias` (`[[X|Y]]`), `path` (`[[folder/page]]`), `inline-json` (`wiki_outgoing_links: [...]`), `outgoing-desync` (body links ≠ frontmatter field). Dead links produce warnings only — never block writes.

Configured via `wikiLinkValidationRetries` (default=3, 0=validate-only). See [[src/wiki-link-validator.ts]].

## wrapWithJsonFallback

Transparent wrapper applied to the LLM client in `AgentRunner`. On 400/422 with "json_object" or "unsupported" in the error body, retries the request without `response_format`.

Allows the same phase code to run against models without structured output support. See [[src/phases/llm-utils.ts#wrapWithJsonFallback]], [[src/agent-runner.ts#AgentRunner]].

## Structural Error Counter

Singleton observable that counts `structural_error` events across all calls. Displayed in the status bar as `schema: failed/total`. Updated by each `parseWithRetry` attempt.

See [[src/structural-error-counter.ts#structuralErrorCounter]].

## Streaming

Free-text operations (query, chat, format reasoning) use streaming. `extractStreamDeltas` extracts `content` and optional `reasoning` deltas per chunk. `isReasoning: true` marks thinking tokens.

`wrapStreamWithStats` wraps any streaming call to measure per-call timing. It tracks TTFT, total duration, and token counts, then builds a `llm_call_stats` event via `buildLlmCallStatsEvent`. The caller emits this event after the stream is consumed.

Mobile backend uses `wrapMobileNoStream` for non-streaming polling instead. See [[src/phases/llm-utils.ts#extractStreamDeltas]], [[src/phases/llm-utils.ts#wrapStreamWithStats]], [[src/mobile-llm-wrap.ts#wrapMobileNoStream]].
