---
review:
  spec_hash: eee1e2843b670d56
  last_run: 2026-06-24
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Part B — Stronger language directives"
      section_hash: 1736ad1d5e310988
      text: "Terms 'answer language' and 'output language' are used interchangeably; consider fixing one term (directive role vs. the outputLanguage setting name)."
      verdict: open
      verdict_at: null
chain:
  intent: null
---

# Design: Reasoning Logging + Stronger Reasoning/Answer Language Rule

Date: 2026-06-24
Branch: `dev/query-link-resolver` (new work; confirm whether a fresh `dev/*` branch is preferred before implementation)
Status: Approved (design)

## Problem

Two defects reported against the `native-agent` backend:

1. **Model reasoning never reaches `_agent.jsonl`.** `Controller.logEvent` (`src/controller.ts:586`)
   drops *every* `assistant_text` event, including reasoning chunks flagged `isReasoning: true`.
   Reasoning is therefore visible in the progress bar (`src/view.ts:773`) but absent from the
   agent log.

2. **Reasoning language drifts.** With `reasoningLanguage = "en"` the progress bar still mixes
   Russian into the reasoning. Root causes:
   - The injected directive is weak: `## Reasoning language\nThink and reason in English.`
     (`src/phases/llm-utils.ts:200`).
   - The structured `reasoning` field emitted inside JSON output (ingest/lint/eval zod schemas,
     surfaced e.g. at `src/phases/ingest.ts:263`) follows the *answer* language directive, not the
     reasoning directive — so it tracks the source-note language.
   - Vision (`src/phases/attachment-analyzer.ts`) bypasses `buildChatParams` entirely: it builds
     its own request and receives **only** the answer-language directive (`{lang}` template
     placeholder), never the reasoning directive, and `reasoningLanguage` is not even plumbed into
     it.

## Scope

In scope:
- Consolidated reasoning logging to `_agent.jsonl` (one record per LLM call).
- Strengthened reasoning-language and answer-language directives.
- Coverage across **all** native phases that produce reasoning: format, query, lint, ingest,
  evaluator, chat, **and vision** (full parity — plumb `reasoningLanguage` into vision).

Out of scope:
- `claude-agent` backend (it does not receive `reasoningLanguage` today; user is on `native-agent`).
- New UI, settings, or toggles. Logging stays gated by the existing `agentLogEnabled` flag.

## Coverage map (native-agent)

| Phase | LLM call path | Reasoning directive (today) | Answer directive (today) |
|---|---|---|---|
| format, query, lint, ingest, evaluator, chat | `buildChatParams` | `injectReasoningDirective` ✓ | `injectLanguageDirective` ✓ |
| vision (attachment-analyzer) | direct `chat.completions.create` | ❌ none | template `{lang}` = `langInstruction` ✓ |

`langInstruction` is shared by both paths, so strengthening it fixes the answer language
everywhere in one edit. The reasoning directive currently reaches only the `buildChatParams` path;
vision needs explicit plumbing.

## Design

### Part A — Reasoning logging (consolidated per LLM call)

All work is local to `src/controller.ts`. No new `RunEvent` kind, no phase changes.

- Add a buffer field: `private _reasoningBuf = "";`
- In `logEvent`, replace the blanket `if (ev.kind === "assistant_text") return;` with:
  - `assistant_text` **and** `isReasoning` → `this._reasoningBuf += ev.delta; return;` (accumulate,
    do not write per-delta).
  - `assistant_text` **and not** `isReasoning` → `return;` (progress chatter stays dropped; the
    final answer is already captured by the `result` event).
  - **Any other event kind** → if `_reasoningBuf` is non-empty, first write one consolidated line
    and reset the buffer, then proceed to write the current event as today.

- The consolidated line reuses the existing envelope shape and is written as a plain object literal
  (no `RunEvent` typing needed):
  ```jsonc
  {
    "ts": "<iso>",
    "session": "<id>", "op": "<op>", "domainId": "<id|undefined>",
    "backend": "<backend>", "model": "<model>",
    "event": { "kind": "reasoning", "text": "<accumulated reasoning>" },
    "callIndex": <current _llmCallIndex>
  }
  ```
- Reset `this._reasoningBuf = ""` at operation start (in `dispatch`, alongside the existing
  session/state reset) to prevent cross-operation leakage. The final flush happens naturally when
  the terminating `result`/`exit` event arrives (it is a non-`assistant_text` event, so it triggers
  the flush rule above).

**Boundary robustness.** The flush is tied to "the next non-`assistant_text` event", not to a
specific `llm_call_stats`. This is correct for both observed orderings:
- format: reasoning deltas → `llm_call_stats` (flush on stats).
- ingest: `llm_call_stats` (from `parse-with-retry`) → structured reasoning → next structural event
  (flush on that next event, e.g. the `result`).

`callIndex` is stamped with the current `_llmCallIndex`; minor association imprecision across the
stats/reasoning ordering is acceptable for a diagnostic log.

### Part B — Stronger language directives (`src/phases/llm-utils.ts`)

- Extract a shared, exported `reasoningDirective(lang: "ru" | "en" | "es"): string` from the body of
  `injectReasoningDirective`, so vision can reuse the exact same text.
- Rewrite the directive text to be imperative and explicit. It must state:
  - Reason **exclusively** in the configured reasoning language.
  - Do **not** switch the reasoning language to match the source notes, user input, or quoted text,
    even when those are in another language.
  - The rule **also governs the `reasoning` field of any JSON output** (this is the ingest/lint/eval
    drift source).
- Strengthen `langInstruction` (answer directive) with similarly explicit wording
  ("Write the entire response in <Language>. Do not switch to the source language."). Because the
  vision templates render `{lang}` from `langInstruction`, this simultaneously hardens vision output.

### Part C — Vision parity (`src/phases/attachment-analyzer.ts` + `src/phases/format.ts`)

Plumb `reasoningLanguage` through the vision path so vision reasoning honors the same rule:

- Thread a `reasoningLanguage: OutputLanguage` parameter through:
  `analyzeAttachments` → `analyzeSingleAttachment` → `analyzeImage` / `analyzePdf` /
  `analyzeExcalidraw` → the three `*System()` builders.
- Each `*System()` builder appends the shared `reasoningDirective(resolveReasoningLang(
  reasoningLanguage, language))` to the rendered template system prompt (after `{lang}`).
- `callVisionLlm` needs no change — it already forwards the assembled system prompt.
- Caller wiring: `src/phases/format.ts` calls `analyzeSingleAttachment(...)` and already holds
  `opts: LlmCallOptions` (which carries `reasoningLanguage`). Pass `opts.reasoningLanguage` at that
  call site.

`resolveReasoningLang(reasoningLanguage, outputLanguage)` is the existing helper (used in
`buildChatParams`) and preserves the `auto` → answer-language → UI-language fallback.

## Files touched

- `src/controller.ts` — reasoning buffer + consolidation in `logEvent`; buffer reset in `dispatch`.
- `src/phases/llm-utils.ts` — export+strengthen `reasoningDirective`; strengthen `langInstruction`.
- `src/phases/attachment-analyzer.ts` — plumb `reasoningLanguage`; append reasoning directive in the
  `*System()` builders.
- `src/phases/format.ts` — pass `opts.reasoningLanguage` to `analyzeSingleAttachment`.

No changes to `src/types.ts` (reasoning log record is an inline object, not a `RunEvent`).

## Verification

- `npm run build` and lint pass. (No functional test suite in this project — verify via build/lint/run.)
- Run a `native-agent` ingest/query/format with `agentLogEnabled = true`:
  `_agent.jsonl` contains `{"event":{"kind":"reasoning", ...}}` records, **one per LLM call**, not
  hundreds of per-delta lines.
- With `reasoningLanguage = "en"` and Russian source notes: the progress-bar reasoning stays English
  with no Russian fragments, across format, query, lint, ingest, and vision.
- Update `docs/wiki/` via `iwiki:iwiki-ingest` for the changed sources and run `/iwiki-lint`.

## Out-of-scope follow-up (noted, not implemented)

- `claude-agent` does not receive `reasoningLanguage` (`src/agent-runner.ts:45`). Out of scope here;
  worth a separate ticket if that backend later needs the same guarantee.
