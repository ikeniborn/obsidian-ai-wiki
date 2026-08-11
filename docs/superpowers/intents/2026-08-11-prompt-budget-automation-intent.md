---
review:
  intent_hash: 56cb5d606560c990
  last_run: 2026-08-11
  revision: 2
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: Desired Outcomes
      section_hash: 56d8317900677602
      fragment: "uses substantially more than 4k input tokens"
      text: "Vague quantity with no criterion."
      fix: "State an explicit threshold for the effective input budget."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-002
      phase: clarity
      severity: WARNING
      section: Desired Outcomes
      section_hash: 56d8317900677602
      fragment: "No separate observable outcome is required for the `claude-agent` backend"
      text: "Scope exclusion listed as a desired outcome; it is not observable."
      fix: "Move it to Strategic Context and to a hard constraint."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-003
      phase: clarity
      severity: WARNING
      section: Health Metrics
      section_hash: 4ee2ddb83267090f
      fragment: "The number of LLM calls per Init/Ingest does not grow systematically."
      text: "Not measurable: no baseline and no fixture named."
      fix: "Name the fixtures and the baseline; exempt splits caused by an unreachable payload."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-004
      phase: clarity
      severity: WARNING
      section: Constraints
      section_hash: ace48b06f71f1713
      fragment: "fall back to a conservative per-backend default"
      text: "\"Conservative\" carries no criterion and recurs in the Guarded autonomy zone."
      fix: "Define what conservative means for the fallback constant."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-005
      phase: consistency
      severity: INFO
      section: Health Metrics
      section_hash: 4ee2ddb83267090f
      fragment: "Zero provider context-overflow errors."
      text: "Reads as contradicting the hard constraint that allows a provider rejection after the repack loop is exhausted."
      fix: "Scope the metric to unrecovered overflows surfaced to the user."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-006
      phase: alignment
      severity: INFO
      section: Objective
      section_hash: d75cb02d2ed62cec
      fragment: null
      text: "Objective and Desired Outcomes cover the task described in the conversation, including the output budget and markdown-chunks scope added by the user. No extra objectives. iwiki unavailable, so the wiki check was skipped."
      fix: null
      verdict: accepted
      verdict_at: 2026-08-11
    - id: F-007
      phase: clarity
      severity: WARNING
      section: Constraints
      section_hash: ace48b06f71f1713
      fragment: "keeps a proportionally larger one after the change"
      text: "Revision 2: \"proportionally larger\" carried no criterion, so the format operation's deliberate 32768 output allowance was unverifiable."
      fix: "State the multiple explicitly: format keeps at least 4x the derived base."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-008
      phase: consistency
      severity: INFO
      section: Desired Outcomes
      section_hash: 56d8317900677602
      fragment: "the `data.json` history entry reports `done`, not `error`"
      text: "Revision 2: the previous wording expected `ok`, which RunHistoryEntry.status (types.ts:478) cannot produce; its values are done | error | cancelled."
      fix: "Expect `done`."
      verdict: fixed
      verdict_at: 2026-08-11
---

# Intent: prompt-budget-automation

**Date:** 2026-08-11
**Status:** approved

## Objective

Init, Re-init and Ingest fail with `init: configuration error — fixed bootstrap evidence
prompt exceeds input budget: Bootstrap evidence payload requires 7583 tokens but budget is
5276; domain was not created.` The prompt budget is not measured in tokens. It is measured
in UTF-8 bytes of a double JSON serialization (`estimatePreparedMessages` in
`src/prompt-budget.ts`, `estimateTokens` in `src/markdown-chunks.ts`): the payload is
`JSON.stringify`-ed into a message `content`, then the whole message array is
`JSON.stringify`-ed again for estimation, so every quote is escaped twice.

Measured against the provider's reported `inputTokens` in `agent.jsonl` the estimate
overshoots by a stable factor of 3.6–4.1:

| request | estimated | actual | ratio |
|---|---|---|---|
| `llm-msohmb2c-1` | 14082 | 3767 | 3.74 |
| `llm-msohmzbi-2` | 15911 | 4381 | 3.63 |
| `llm-msohnp3o-3` | 7373 | 1809 | 4.08 |
| `llm-msohnp3o-3:bounded-1` | 7526 | 1851 | 4.07 |

Consequences that compound into a hard failure:

- The default `inputBudgetTokens: 16384` is roughly 4.1k real tokens, while the configured
  model (`ollama-deepseek-v4-pro-cloud`) has a context window of at least 128k. The plugin
  uses about 3% of the available context and still fails.
- The fixed Init system prompt (`base.md` + `init.md` + `templates/_wiki_schema.md` +
  language/reasoning/compression directives) consumes ~11.2k of the 16.4k budget — 68% —
  leaving 5276 for the bootstrap payload (`src/phases/init.ts:237`).
- `boundBootstrapPayload` (`src/phases/ingest-evidence.ts:139`) has an irreducible floor: it
  keeps at least one candidate, one fact and one `exactSource` entry, and it never truncates
  the strings themselves. `exactSource[].text` is the full text of a source line range, so
  its size is unbounded. When that single entry exceeds the payload budget the bounder
  cannot converge.
- `runWithContextRepack` rethrows a preflight budget error without any repack attempt
  (`src/prompt-budget.ts:428`), so the operation ends as a configuration error and the domain
  is not created.

The same log shows an independent output-side defect: `outputTokens` 3982 against
`maxTokens` 4096 and 4446 against 8192 — generation is cut off and the truncated JSON fails
`schema_validate` as a `structural_error`.

The user cannot fix any of this by tuning numbers, because the irreducible floor depends on
the length of one particular chunk in one particular source file, which is not visible in the
UI. Now, because Init of the `os-mac` domain does not complete at all: three consecutive
`status: error` entries in `data.json` history.

Replace user-tuned byte-based input and output budgets with programmatic, token-accurate
budgeting.

## Desired Outcomes

- Init `os-mac --force --sources ОС/Mac/` on the same vault completes successfully and the
  domain is created; the `data.json` history entry reports `done`, not `error`.
- In `agent.jsonl`, `estimatedInputTokens` differs from the provider's reported
  `inputTokens` by no more than ~15% (currently a factor of ~4).
- No Init or Ingest run ends with `configuration error — ... domain was not created` because
  of input size. A long `exactSource[].text` is truncated with an explicit marker or split
  across calls, and the domain is created.
- The main Settings section no longer shows `Input budget tokens`, `Repair input budget` or
  `Output budget tokens` for the native backend. All three live under Advanced and are empty
  by default, meaning automatic. Previously saved values keep working as an explicit override.
- On first load after the upgrade, an installation that still holds budget values is offered
  a single explicit choice — switch to automatic, or keep the saved numbers. Nothing is
  rewritten without that answer, and the choice is asked once.
- When discovery reports a context window, the effective input budget for Init is at least 4×
  the current 16384-byte-derived limit — that is, ≥16k real tokens. When no endpoint reports
  a window, the conservative fallback applies instead and the budget is smaller; that is a
  correct outcome, not a failure. In both cases `agent.jsonl` records which source produced
  the boundary: discovery, a learned value, or the fallback default. It is never the constant
  16384.
- A truncated generation (`finish_reason=length`) triggers a retry with a larger output
  limit instead of a `structural_error / schema_validate` failure.

## Health Metrics

- **Evidence completeness.** `assertCompleteSourceCoverage` and `buildEvidenceCoverage`
  continue to pass: no source chunk is silently lost. Truncation of `exactSource[].text` does
  not count as a coverage loss only when it is marked and recorded in the evidence.
- **Create/update decision accuracy.** The `conflict-regeneration-integration`,
  `ingest-bounded` and `bounded-operations-acceptance` fixtures keep their expected
  decisions; zero new duplicate pages.
- **Existing section preservation.** 100% of untouched pre-existing page sections remain
  present after fixture updates.
- **Zero unrecovered provider context-overflow errors.** A larger budget may not surface
  `context_length_exceeded` to the user: `runWithContextRepack` still catches and shrinks,
  and the operation completes.
- **LLM call count.** On the `bounded-operations-acceptance` and `ingest-bounded` fixtures,
  the number of LLM calls per operation does not exceed the pre-change baseline recorded on
  the same fixtures. Extra calls caused by splitting an unreachable payload are exempt and
  must be recorded in `agent.jsonl`.
- **Total operation cost is explicitly NOT a health metric.** Honest estimation packs more
  evidence per prompt, so total input tokens per operation are expected to grow. This is
  accepted with no ceiling.
- **Persisted settings compatibility.** No persisted value silently changes meaning during
  migration.
- **Claude Agent CLI path.** Transport and behaviour of the `claude-agent` backend are
  unchanged.

## Strategic Context

- Interacts with:
  - `src/prompt-budget.ts` — estimation, context packing, the repack loop, context-error
    classification.
  - `src/model-call-policy.ts` — resolves budgets from settings into `LlmCallOptions`.
  - `src/settings.ts` and `src/i18n.ts` (ru/en/es) — budget field UI and strings.
  - `src/types.ts` and `src/main.ts` — defaults and persisted-settings migrations.
  - `src/phases/init.ts`, `ingest-evidence.ts`, `ingest-context.ts`, `ingest-synthesis.ts`,
    `lint.ts`, `lint-chat.ts`, `query-budget.ts`, `format.ts`, `chat.ts`,
    `structured-output.ts`, `vision-recognition.ts`, `attachment-analyzer.ts`,
    `evidence-type-enrichment.ts` — every budget consumer.
  - `src/markdown-chunks.ts` — `estimateTokens` is the same byte-based defect and is in
    scope; changing it moves chunk boundaries.
  - `src/native-openai-transport.ts`, `src/native-request-retry.ts` — where model context
    discovery and `finish_reason=length` handling will live.
  - External: the OpenAI-compatible provider at `homelab.ikeniborn.ru/v1`, Ollama, and the
    Claude Agent CLI.
  - Roughly 25 test files that encode the current byte-based invariants.
  - The plugin user, who stops being part of the number-tuning loop.
- Out of scope: the `claude-agent` backend has no separate desired outcome. Its behaviour
  stays as it is and it only inherits the honest token estimate; see the matching hard
  constraint.
- Priority trade-off: **trust**. The operation must complete correctly and predictably;
  speed and cost are secondary, and cost has already been removed from the health metrics.

## Constraints

### Steering (behavioral guidance)

- Piecemeal growth: do not build a general token-accounting framework. One honest estimator
  and one source of the starting budget, sized to the calls that exist today.
- Token estimation is approximate and deliberately conservative in the safe direction. Do
  not embed a real tokenizer (tiktoken/BPE): bundle weight, and the target model's BPE is
  not available anyway.
- Context discovery is best-effort. If the provider does not report a context size, fall
  back to a per-backend default; that is not an error. "Conservative" here has one meaning:
  the fallback is a single constant declared in code, chosen so it does not exceed the
  smallest context window among the models that backend is known to serve. The applied value
  and its source are recorded in `agent.jsonl`.
- All technical numbers — the estimate, the learned context size, the source of the budget,
  and the fact that content was truncated — go to `agent.jsonl`, never into sidebar progress
  text (invariant carried over from the 2026-07-16 intent).
- Do not reduce the diagnostics already carried by `prompt_budget` events; extend them.

### Hard (architectural enforcement)

- No operation ends with `configuration error` / `domain was not created` because of input
  size. The only acceptable size-related failure is a provider rejection after the repack
  loop is exhausted.
- Content truncation is always explicit: a marker in the payload and a record in
  `agent.jsonl`. No silent truncation.
- Source coverage completeness (`assertCompleteSourceCoverage`) remains a hard invariant.
- Persisted settings never change meaning silently. A saved `inputBudgetTokens` keeps acting
  as an explicit override; migration does not rewrite user values.
- Existing domains are not re-indexed or re-embedded automatically when chunk boundaries
  change. No auto-migration machinery is built; the user re-runs `Init --force` manually.
- Automatic budgeting applies to the `native-agent` backend only. The `claude-agent` backend
  — its transport, its stored budget defaults, its settings layout, and the external CLI's
  ownership of the output limit — does not change. It inherits the honest token estimate and
  nothing else.
- Output budgets are derived per operation, not from one global constant. An operation whose
  stored default is a multiple of the base output budget today keeps at least that multiple
  after the change: `format` carries 32768 against a base of 8192, so it keeps at least 4×
  whatever the derived base becomes.

## Autonomy Zones

- Full autonomy (reversible, low risk):
  - Per-script token estimation coefficients and their calibration against fixtures.
  - Field layout and contents of `prompt_budget` and any new diagnostic events in
    `agent.jsonl`.
  - Internal structure of the learned-context cache keyed by `(baseUrl, model)`.
  - Rules for growing the output limit on `finish_reason=length` within the context window.
  - Refactoring the tests that encode byte-based invariants onto the new metric.
- Guarded (log + confidence threshold):
  - Conservative per-backend context defaults used when discovery returns nothing.
  - The truncation strategy for `exactSource[].text`: where to cut, which marker, what is
    recorded in the evidence.
  - Choosing between truncating and splitting into several calls when the bounder's floor is
    unreachable.
- Proposal-first (needs approval):
  - The shape of discovery: which endpoints are queried (`/v1/models`, `/api/show`), when,
    with what timeout, and the behaviour when they are unavailable.
  - The final Settings layout: what moves to Advanced, what stays, how "empty means
    automatic" is presented.
  - The persisted-settings migration scheme.
  - Any change to chunk boundaries in `src/markdown-chunks.ts`, because it affects the index.
- No autonomy (human only):
  - Removing or weakening the source-coverage completeness invariant.
  - Changing the behaviour of the `claude-agent` backend.
  - Anything that invalidates the user's existing domains automatically.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: on fixtures the honest estimate underestimates the provider's reported
  `inputTokens` by more than 15%, since underestimation causes real context overflows.
- Halt if: the create/update or source-coverage fixtures break and cannot be fixed without
  weakening an invariant.
- Escalate if: no reachable endpoint reports a context size and the conservative default
  again hits a hard failure on the real vault.
- Escalate if: accurate estimation genuinely requires a full tokenizer because coefficients
  cannot close the gap.
- Done when: `init os-mac --force --sources ОС/Mac/` on the real vault finishes with
  `status: done`; `agent.jsonl` shows the input estimate within 15% of the provider's reported
  value, correlated per request rather than by array position; the main Settings section
  contains no native budget fields; a reproduced oversized-evidence scenario creates the
  domain with the split recorded in the log and no content discarded; and a reproduced
  provider context-overflow is recovered by the repack loop without surfacing to the user.
