---
review:
  intent_hash: 5e9185b3ddeb5085
  last_run: 2026-07-14
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
---
# Intent: Structured Output Pipeline Resilience

**Date:** 2026-07-14
**Status:** approved

## Objective

Make the whole `parseWithRetry` and structured-output pipeline resilient to empty, hanging, non-JSON, and backend-incompatible LiteLLM/Ollama/DeepSeek responses. Init, ingest, lint, query, and format must not fall into destructive full-operation retries when a single structured LLM call fails; they must retry or fail at the structured-call boundary with clear diagnostics.

## Desired Outcomes

- `init --force` with a hanging or empty bootstrap response does not repeat `WipeDomain` more than once in a single user-started run.
- Every structured call site (`init.bootstrap`, `ingest.entities`, `ingest.pages`, `ingest.merge`, `lint.patch`, `lint.fix`, `lint-chat.fix`, `query.seeds`, `query.answer`, `format.output`) either receives Zod-valid JSON or exhausts retries with a clear diagnostic event and user-visible error.
- Empty stream or empty content is diagnosed separately from malformed JSON.
- `json_schema` can be automatically disabled for backend mismatch or empty-output behavior; the pipeline then retries with `json_object` or without `response_format` and still validates the recovered response through Zod.
- Retry handling first attempts local JSON recovery (`parseStructured` and `jsonrepair` guard), then validates through Zod, then asks the LLM to repair the response with a strict schema-specific prompt before failing.
- Normal successful structured calls keep their current observable output and do not add extra LLM calls on the happy path.

## Health Metrics

- Happy-path structured calls add no more than zero extra LLM calls compared with current behavior.
- Zod contracts must not be weakened; schema violations must not pass silently.
- Query and chat streaming UX must remain unchanged; live text and reasoning behavior stay as-is for non-structured freeform paths.
- Force reinit remains destructive only once after explicit user action; internal retry must not repeat destructive prelude steps such as `WipeDomain`.
- `agent.jsonl` in the plugin folder remains the active run log surface and remains parseable.
- The pipeline must not create or reintroduce legacy `_config` folders inside wiki catalogs.
- Build and lint checks must pass.

## Strategic Context

- Interacts with:
  - `src/phases/parse-with-retry.ts` structured retry orchestration.
  - `src/phases/llm-utils.ts` structured parsing, JSON repair, streaming stats, and `response_format` fallback.
  - `src/agent-runner.ts` idle watchdog and operation-level retry behavior.
  - Structured call sites in init, ingest, lint, lint-chat, query, and format phases.
  - `agent.jsonl` logging in the plugin folder.
  - Wiki catalog path creation logic, especially legacy `_config` paths.
- Priority trade-off: trust > speed > cost. Prefer one repair retry and strong validation over silent bad JSON acceptance or repeated destructive operation retry.

## Constraints

### Steering (behavioral guidance)

- Prefer local JSON recovery before asking the model to repair its output.
- Use strict schema-specific repair prompts when the LLM must be asked for a corrected response.
- Automatically degrade `response_format` from `json_schema` to `json_object` to no `response_format` when evidence shows backend mismatch or empty-output behavior.
- Keep diagnostics specific enough to distinguish empty content, JSON parse failure, Zod schema failure, backend `response_format` fallback, and idle abort.
- Keep changes focused on structured-output calls; freeform chat and normal streaming answer paths are out of scope.

### Hard (architectural enforcement)

- Do not weaken Zod schemas to make invalid output pass.
- Do not silently bypass schema validation.
- Do not repeat destructive prelude steps such as `WipeDomain` during internal retry.
- Do not treat `_agent.jsonl` as the active log contract; the active log surface is `agent.jsonl` in the plugin folder.
- Do not reintroduce or generate legacy `_config` folders inside wiki catalogs.
- Do not add a new external dependency if existing `jsonrepair` and Zod can cover recovery and validation.

## Autonomy Zones

- Full autonomy (reversible, low risk): local JSON-repair guards, structured retry orchestration, telemetry labels, non-destructive retry boundaries, build/lint verification, and focused regression checks.
- Guarded (log + confidence threshold): automatic `json_schema -> json_object -> no response_format` degradation and empty-output fallback when call evidence indicates backend incompatibility.
- Proposal-first (needs approval): changing the `agent.jsonl` event schema in a breaking way, migrating wiki storage paths, adding dependencies, or changing public settings semantics.
- No autonomy (human only): weakening Zod schemas, silently accepting schema-invalid data, repeating destructive wipe during internal retry, or restoring legacy wiki `_config` generation.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the fix requires weakening any Zod schema.
- Halt if: preventing repeated destructive `WipeDomain` would require removing explicit `--force` behavior.
- Escalate if: the backend returns no content even after no-`response_format` repair retry.
- Escalate if: preserving `agent.jsonl` compatibility conflicts with the diagnostic evidence needed for the fix.
- Done when: all structured call sites share resilient recovery and retry behavior; `init --force` does not repeat `WipeDomain` during internal retry; empty responses, parse failures, schema failures, and response-format fallback are separately diagnosed; legacy `_config` generation is checked; and build/lint pass.
