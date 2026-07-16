---
review:
  intent_hash: 991da6d260b128cc
  last_run: 2026-07-16
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---

# Intent: Bounded Ingest and Model Controls

**Date:** 2026-07-16
**Status:** approved

## Objective

Make the LLM context used by Init, Re-init, and Ingest bounded and relevant for domains containing from 1 to 100 wiki pages. The immediate failure is caused by `buildIngestMessages` appending the complete `index.jsonl`, including chunk embedding vectors, to every page-synthesis prompt after the first source is processed. Full retrieved wiki pages are a secondary scaling risk because the union of per-entity top-K results has no global context budget. Fix both context paths without reducing synthesis quality or losing existing knowledge, including sources that cannot fit into one prompt.

Make model resource controls explicit in Settings: separate input and output token budgets with per-operation overrides, operation-aware semantic compression levels for every safely compressible operation, and a real native-backend Vision model availability check. Preserve the current output-limit behavior while replacing the ambiguous `Max tokens` label.

## Desired Outcomes

- A one-page domain and a 100-page domain can complete normal Ingest without a model context-length error when their source input is within the supported budget.
- The current 22-source Init/Re-init scenario completes on a safe vault copy instead of failing every `ingest.pages` call after the first source.
- Every page-synthesis request stays within an explicit context budget and contains no embedding vectors or other machine-only service records.
- Create/update decisions remain stable against focused regression fixtures, and the bounded context does not introduce duplicate pages.
- Updating an existing page preserves its prior facts and untouched sections while incorporating relevant information from the current source.
- Small domains do not lose relevant context or synthesis quality merely because the same bounded pipeline also supports larger domains.
- An oversized source is processed through bounded Markdown chunks and structured evidence reduction instead of failing, being truncated, or losing unprocessed sections.
- Native backend users can configure global input/output token budgets and override both values per operation; Claude Agent users can configure the input budget globally and per operation while output limits remain owned by the external CLI configuration.
- Existing `maxTokens` values retain their output-limit meaning and appear as `Output budget tokens`; no saved value silently changes meaning during migration.
- A global maximum/balanced/minimum semantic compression profile has per-operation overrides when per-operation mode is enabled. Ingest/Init compress evidence representation without dropping facts, Query/Chat/Lint compress prose without dropping findings, and Vision compresses descriptions without changing recognized OCR, objects, or structure. Format is excluded because it must not semantically rewrite content.
- The native Vision model `Check` action sends a real inline-image request through the configured Base URL, API key, and model, then reports a clear success or provider error without mutating settings.

## Health Metrics

- Context-overflow failures: zero across 1-page, 15-page, and 100-page fixtures and the safe 22-source replay.
- Machine-only index records in LLM prompts: zero embedding vectors and zero raw `index.jsonl` chunk records.
- Create/update regression accuracy: all expected decisions in the focused fixture set remain unchanged.
- Duplicate-page regressions: zero new duplicates in the focused fixture set.
- Existing-section preservation: 100% of untouched pre-existing sections remain present after fixture updates.
- Embedding reuse: unchanged chunks trigger zero new embedding requests; only changed or new chunks are embedded.
- Prompt cost: each synthesis prompt stays under the selected context budget; prompt size and included context units are recorded for diagnostics.
- LLM-call count is measured but is not a fixed limit; additional calls are acceptable when they produce a better quality/cost balance.
- Oversized-source coverage: every source chunk has a traceable evidence or explicit no-evidence result before final synthesis.
- Budget settings: global and per-operation input/output values round-trip without drift, and effective-operation resolution selects the expected fallback or override in all fixtures.
- Compression invariants: every profile preserves Ingest evidence coverage, Lint findings, and Vision recognition meaning; Format prompt behavior remains unchanged.
- Vision availability: the probe request contains an `image_url` part and selected Vision model; success and failure fixtures both produce the expected read-only notice.

## Strategic Context

- Interacts with:
  - `src/phases/init.ts`, which runs Ingest once per source during Init and Re-init.
  - `src/phases/ingest.ts`, especially per-entity retrieval, `buildIngestMessages`, page synthesis, and merge/update handling.
  - `src/page-similarity.ts`, which selects per-entity candidates and persists/reuses chunk embeddings.
  - `src/wiki-index-jsonl.ts` and `!Wiki/<domain>/index.jsonl`, which store machine-readable page/chunk records and vectors.
  - `src/agent-runner.ts`, which configures retrieval and supports native OpenAI-compatible and Claude Agent backends.
  - `src/types.ts`, `src/effective-settings.ts`, `src/main.ts`, `src/settings.ts`, and `src/i18n.ts`, which own persisted defaults, migration, effective per-operation values, and Settings UI.
  - `src/phases/attachment-analyzer.ts`, whose native-compatible multimodal request shape is the reference for the Vision availability probe.
  - Structured-output request diagnostics in `agent.jsonl`.
  - Users running Ingest, Init, or destructive Re-init across small and large domains, and users validating native chat/vision model configuration.
- Priority trade-off: trust > cost > speed. Preserve synthesis correctness and existing knowledge first, then minimize prompt cost, then optimize latency.

## Constraints

### Steering (behavioral guidance)

- Apply one global context budget to the complete synthesis request, not independent limits whose union can exceed the model context.
- Prefer the smallest sufficient relevant context units, such as sections or chunks, over the complete wiki corpus.
- Preserve untouched page sections programmatically when a bounded LLM update does not need to rewrite them.
- Split oversized Markdown by stable section and code-fence boundaries, map chunks to structured evidence, group evidence by entity, and perform additional reduction only for entity groups that still exceed budget.
- Keep behavior proportional for domains from 1 to 100 pages; do not penalize a one-page domain with unnecessary retrieval or extra calls.
- Minimize LLM calls and tokens without imposing a fixed call-count limit that would reduce output quality.
- Record prompt size and selected context composition so budget decisions can be diagnosed from `agent.jsonl`.
- Keep numeric input/output budgets separate from maximum/balanced/minimum semantic compression; each compressible operation receives its own policy fragment and preservation rules.
- Store one global compression profile and expose per-operation overrides only when per-operation mode is enabled.
- Mirror global budget controls in native per-operation settings; mirror the input budget in Claude Agent per-operation settings.

### Hard (architectural enforcement)

- Never send raw embedding vectors, raw chunk records, or other machine-only `index.jsonl` service data to an LLM.
- Support both native OpenAI-compatible and Claude Agent execution paths.
- Do not silently truncate or drop source facts, selected existing knowledge, or existing page sections.
- Process an oversized source through bounded chunk/evidence stages; do not reject it merely because the original source exceeds one prompt.
- Create new wiki pages as complete documents and update existing pages through structured section patches applied to the full on-disk page.
- Preserve correct create/update decisions, existing sections, and embedding reuse across the supported 1-to-100-page range.
- Preserve saved `maxTokens` values as native output budgets; do not reinterpret them as input budgets.
- Apply native input/output budgets globally and per operation; apply Claude Agent input budgets globally and per operation without pretending to control the CLI-owned output cap.
- Run the Vision image probe only for the native OpenAI-compatible backend and keep the action read-only.
- Do not let semantic compression drop Ingest facts/anchors, Lint findings, or Vision OCR/object/structure meaning.
- Do not apply semantic compression policy to Format.
- Do not run destructive Init/Re-init against the user's working vault without separate explicit approval.

## Autonomy Zones

- Full autonomy (reversible, low risk): root-cause analysis, focused fixtures, approved context-budget/retrieval/section-patch changes, approved budget and compression Settings controls, native Vision probe, prompt diagnostics, and non-destructive verification.
- Guarded (log + confidence threshold): numeric context budgets, retrieval thresholds, and context-unit selection limits, provided their decisions and measured prompt composition are logged.
- Proposal-first (needs approval): changing the `index.jsonl` schema, adding model controls beyond those named here, controlling Claude Agent output limits from the plugin, supporting Vision Check through Claude CLI, or changing the public page-update contract beyond internal section patches.
- No autonomy (human only): destructive Init/Re-init on the working vault, silent source/context truncation, or any behavior that knowingly permits existing-section loss.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: bounding the prompt requires silent source truncation or can discard existing page sections.
- Halt if: the selected approach cannot exclude machine-only vectors and service records from every synthesis request.
- Halt if: oversized-source reduction cannot account for every source chunk or would silently drop exact technical evidence.
- Escalate if: preserving create/update quality requires an `index.jsonl` schema change or a public page-update contract beyond the approved internal section patches.
- Escalate if: the requested Vision check requires Claude multimodal transport or the requested output budget requires plugin control over Claude CLI output limits.
- Done when: 1-page, 15-page, and 100-page fixtures stay within the selected context budget with no raw vectors; oversized-source evidence covers every input chunk; focused create/update and duplicate checks pass; untouched sections are preserved; unchanged chunk embeddings are reused; the 22-source Init/Re-init scenario completes on a safe vault copy without a context-length failure; global/per-operation budgets and compression profiles resolve correctly; compression preservation invariants pass for Ingest, Lint, and Vision while Format remains unchanged; and the native Vision image probe passes success/failure read-only fixtures.
