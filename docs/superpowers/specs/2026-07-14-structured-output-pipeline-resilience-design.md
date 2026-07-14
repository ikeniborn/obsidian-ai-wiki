---
review:
  spec_hash: a437b83912681474
  last_run: 2026-07-14
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-14-structured-output-pipeline-resilience-intent.md
---
# Structured Output Pipeline Resilience - Design

Date: 2026-07-14
Status: approved
Intent: `docs/superpowers/intents/2026-07-14-structured-output-pipeline-resilience-intent.md`

## Acceptance From Intent

- `init --force` with a hanging or empty bootstrap response does not repeat `WipeDomain` more than once in a single user-started run.
- Every structured call site (`init.bootstrap`, `ingest.entities`, `ingest.pages`, `ingest.merge`, `lint.patch`, `lint.fix`, `lint-chat.fix`, `query.seeds`, `query.answer`, `format.output`) either receives Zod-valid JSON or exhausts retries with a clear diagnostic event and user-visible error.
- Empty stream or empty content is diagnosed separately from malformed JSON.
- `json_schema` can be automatically disabled for backend mismatch or empty-output behavior; the pipeline then retries with `json_object` or without `response_format` and still validates the recovered response through Zod.
- Retry handling first attempts local JSON recovery (`parseStructured` and `jsonrepair` guard), then validates through Zod, then asks the LLM to repair the response with a strict schema-specific prompt before failing.
- Normal successful structured calls keep their current observable output and do not add extra LLM calls on the happy path.

## Current Failure

The observed `init --force --sources ОС/Unix/` log shows correct prelude behavior until the first structured LLM call:

1. `WipeDomain` succeeds for `os-unix`.
2. `domain_updated` resets `entity_types` and `analyzed_sources`.
3. `Glob` finds 22 source files.
4. `init.bootstrap` starts on the first file.
5. Four structured attempts end with `No JSON object found`, zero output tokens, or an aborted request.
6. `AgentRunner` sees 600 seconds of no externally yielded LLM progress and retries the whole operation.
7. The retry repeats `WipeDomain`, so a structured-call failure replays a destructive prelude.

The root problem is not the source path or glob. It is a mismatch between structured-call retry, backend structured-output behavior, delayed event emission, and operation-level idle retry.

## Chosen Approach

Use a shared structured-output runner with two profiles:

- `json-zod`: small structured objects, preferred mode order `json_schema -> json_object -> no response_format`.
- `sentinel-zod`: large markdown payloads, used by `format.output`, preferred default `no response_format` with strict sentinel markers and Zod validation after parsing.

This keeps schema validation strict without depending on every model and LiteLLM/Ollama backend route to implement OpenAI-style Structured Outputs correctly. JSON remains the default for compact extraction/control objects. Sentinel remains the safer transport for large markdown because it avoids JSON string escaping for full formatted notes.

Rejected:

- Keep only the current `parseWithRetry` shape and treat format separately. This leaves two incompatible recovery and diagnostics paths.
- Convert `format.output` to pure JSON schema. Large markdown inside a JSON string is more likely to suffer escaping errors, truncation, code fence corruption, and token preservation issues.

## Structured Runner Contract

Add a shared runner, for example `runStructuredWithRetry`, that owns:

- fallback mode progression;
- per-attempt LLM call execution;
- empty-output detection;
- local parse/repair;
- Zod validation;
- strict repair prompt construction;
- `llm_call_stats`, `structural_error`, and `rule_fired` emission;
- token/stat aggregation;
- final `StructuredValidationError`.

`parseWithRetry` remains as a compatibility wrapper for existing JSON call sites. It delegates to the shared runner with the `json-zod` profile.

The runner returns:

```ts
{
  value: T;
  outputTokens: number;
  fullText: string;
}
```

The runner must not weaken schemas, silently accept invalid data, or skip validation in fallback modes.

## JSON-Zod Profile

Use this profile for:

- `init.bootstrap`
- `ingest.entities`
- `ingest.pages`
- `ingest.merge`
- `lint.patch`
- `lint.fix`
- `lint-chat.fix`
- `query.seeds`
- `query.answer`

Flow:

1. Build base messages with the task prompt and a compact schema instruction.
2. First attempt uses `response_format=json_schema` when `opts.jsonMode` allows structured JSON.
3. If the backend rejects `response_format`, the stream fails before content, or the call returns empty content, retry as `json_object`.
4. If the same failure class repeats, retry with no `response_format` and schema text in the prompt.
5. Parse locally with `parseStructured`, which already strips thinking blocks, strips fences, and uses `jsonrepair`.
6. Validate with the call-site Zod schema.
7. On parse or schema failure, append a strict repair prompt that includes the schema and says to return only JSON, with no Markdown and no commentary.
8. Exhaustion throws `StructuredValidationError` and emits a final diagnostic.

Happy-path calls must not add extra LLM calls.

## Sentinel-Zod Profile

Use this profile for `format.output`.

Format currently returns a large Markdown payload between sentinel markers:

```text
<<<REPORT>>>
...
<<<FORMATTED>>>
...
<<<END>>>
```

This profile makes that path a first-class structured-output adapter:

1. Build the existing strict sentinel prompt.
2. Do not set `response_format` by default.
3. Stream content and reasoning exactly as today, preserving visible formatting UX.
4. Parse markers through the existing `parseFormatOutput` behavior.
5. Validate the parsed `{ report, formatted }` or vision shape with `FormatOutputSchema` / `FormatWithVisionSchema`.
6. If markers are missing, invalid, or truncated, retry once with a stronger sentinel repair prompt.
7. Preserve existing post-parse format safeguards: token restore, embed restore, WikiLink fix, source frontmatter restore, sentinel marker sweep, temp write, and `format_preview`.
8. On exhaustion, emit a `format.output` structural diagnostic and fail the format operation with the existing visible error pattern.

The sentinel profile must not force the full formatted Markdown into JSON.

## Event And Logging Behavior

Structured runner events must be surfaced live enough that `AgentRunner` idle detection can see actual LLM progress. Call sites must not hide all structured events in local arrays until the call finishes.

Required diagnostics:

- empty output versus malformed JSON;
- JSON parse failure;
- Zod schema failure;
- response-format fallback;
- sentinel parse failure;
- idle abort inside a structured call.

The current `agent.jsonl` file in the plugin folder remains the active log surface. Diagnostics are emitted as compatible event records inside the existing JSONL envelope. `_agent.jsonl` is legacy migration input only, not a new write target.

Call sites that currently use `onEvent: () => {}` must either pass through structured diagnostics or intentionally bridge them to the surrounding operation result. Silent loss of structural diagnostics is not acceptable for this work.

## Idle And Destructive Retry Boundary

Structured-call retry happens inside the structured runner. `AgentRunner` must not retry the entire operation after a structured call has already exhausted its own retries and produced a typed failure.

For `init --force`:

- `WipeDomain` may run once per explicit user-started operation.
- Internal bootstrap retries must not replay `WipeDomain`.
- If operation-level idle retry remains necessary for truly silent non-structured phases, it must not restart after a destructive prelude has run.

The design can implement this by either:

- making destructive operations non-retriable after the first destructive event; or
- moving retry boundaries below destructive preludes where the operation can resume safely.

The implementation plan must pick one and verify it with a focused regression check.

## Legacy `_config` Guard

The current code has legacy helpers and migration paths for `_config`. The active requirement is that normal runtime must not create `!Wiki/<domain>/_config` folders.

Design boundary:

- Migration helpers may read or clean legacy paths.
- Normal runtime paths for init, ingest, lint, query, format, and domain metadata must not create per-domain `_config` folders.
- The active agent log is `<pluginDir>/agent.jsonl`, not `!Wiki/_config/_agent.jsonl`.

Verification must include a static or executable check that flags non-migration runtime creation of `!Wiki/<domain>/_config`.

## Components

### `StructuredOutputProfile`

Defines:

- profile kind: `json-zod` or `sentinel-zod`;
- preferred response-format modes;
- parser function;
- Zod validator;
- repair prompt builder;
- diagnostic mapping.

### `runStructuredWithRetry`

Shared orchestration layer for LLM call attempts, fallback modes, parsing, validation, repair prompting, event emission, and exhaustion errors.

### JSON adapter

Uses `parseStructured`, `jsonrepair`, schema text in prompt, and the call-site Zod schema.

### Sentinel adapter

Uses `parseFormatOutput` semantics and `FormatOutputSchema` / `FormatWithVisionSchema` while preserving format streaming UX.

### `parseWithRetry` wrapper

Keeps existing call sites stable while delegating JSON behavior to the shared runner.

### Format integration

Replaces the hand-rolled initial sentinel parse/retry loop in `format.ts` with the sentinel profile. Post-parse format-specific cleanup remains in `format.ts`.

## Acceptance Criteria

1. `json-zod` fallback works.
   - DoD: simulated calls cover success with `json_schema`, fallback to `json_object`, fallback to no `response_format`, empty output, malformed JSON, and Zod failure.
2. `sentinel-zod` format path works.
   - DoD: simulated format calls cover valid sentinel output, missing markers, truncated salvage, invalid parsed payload, and retry exhaustion.
3. Diagnostics are live and visible.
   - DoD: structured failures emit distinguishable diagnostics and are written through the existing `agent.jsonl` event path without changing the JSONL envelope.
4. Destructive retry is blocked.
   - DoD: simulated `init --force` bootstrap empty output does not emit `WipeDomain` more than once in one user-started run.
5. All structured call sites use the shared contract.
   - DoD: every real `parseWithRetry` caller delegates through the shared runner; `format.output` is integrated through `sentinel-zod`; stale call-site typing is reconciled.
6. Legacy `_config` generation is guarded.
   - DoD: normal runtime code does not create `!Wiki/<domain>/_config`; migration-only legacy code remains isolated.
7. No schema weakening.
   - DoD: Zod schemas are not loosened to make invalid output pass.
8. Verification passes.
   - DoD: `npm run build` and `npm run lint` pass, plus focused executable checks for the scenarios above.

## Risks

- Degrading from `json_schema` to no `response_format` may increase malformed output rate on weak models; Zod validation and repair prompts must remain strict.
- Streaming diagnostics can change event timing; UI must remain compatible with current event handling.
- Format sentinel integration touches a mature path with token preservation and preview behavior; keep post-parse behavior in place.
- Operation-level retry may still be needed for non-LLM deadlocks; avoid disabling it globally without a replacement boundary.

## Out Of Scope

- Recommending a specific model.
- Adding a new external dependency.
- Changing public settings semantics.
- Breaking the `agent.jsonl` envelope.
- Restoring `_agent.jsonl` as an active log.
- Reintroducing per-domain `_config` runtime storage.
