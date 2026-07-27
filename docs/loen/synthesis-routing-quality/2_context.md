# Context

## Durable Facts

- Transport is no longer the main blocker for the current failure: recent replay shows HTTP 200 responses and complete body reads for synthesis calls.
- The prior budget failure was architectural: repair prompts were inflated by previous responses. That has already been fixed.
- Current retries are driven by strict domain validation:
  - `unknown entity key: entity-obsidian`
  - `path is not a canonical wiki path: !Wiki/os-unix/methods/wiki_os-unix_chromium-flag.md`
- The model is producing output in the general synthesis shape, but it violates domain contract by inventing entity keys, choosing unsupported folders/types, using `methods` outside canonical routing, and sometimes emitting schema-invalid operations.
- Estimated cause split:
  - 60-70% prompt/contract issue: too much freedom over `entityKey`, `entityType`, and `path`.
  - 20-30% model obedience/quality issue.
  - 10% synthesis batch complexity: many entities per call raises the chance of one invalid decision.

## Replay Evidence

Test vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`

Relevant session: `1784747412210`, source file `ОС/Unix/AltLinux/Настройка прокси.md`, domain `os-unix`.

Observed flow:

- Initial source ingest created 10 pages successfully after split/retry cascade:
  - `!Wiki/os-unix/methods/wiki_os-unix_chromium_flag.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_desktop_file.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_environment_variables.md`
  - `!Wiki/os-unix/applications/wiki_os-unix_obsidian.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_pac_file_method.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_permanent_launch_shortcut.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_profile_file.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_profile_method.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_proxy_pac.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_wrapper_script.md`
- `metadata.jsonl` contains domain entity types:
  - `application` -> `applications`
  - `configuration` -> `configurations`
  - `method` -> `methods`
- Therefore, in this replay `methods` is a configured folder. The concrete invalid examples are mostly wrong canonical stem/path shape, not only unknown folder:
  - `!Wiki/os-unix/methods/wiki_os-unix_chromium-flag.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_environment-variables.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_permanent-launch-shortcut.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_profile-method.md`
  - `!Wiki/os-unix/applications/obsidian.md`
  - `!Wiki/os-unix/configurations/proxy-pac.md`
- First synthesis request for 10 entities had `estimatedInputTokens: 24996` and failed validation with `unknown entity key: entity-obsidian`; next action was `split_batch`.
- Split requests continued failing on path canonicalization until single/smaller batches succeeded.
- The next source file (`ОС/Unix/Ubuntu/Jammy/NFS Server.md`) produced a separate structural/budget failure:
  - `ingest.synthesize` request `estimatedInputTokens: 31802`, output budget `16384`.
  - HTTP 200, body read complete: `bodyBytes: 306`, `bodyChunks: 1`, `sdk_complete`.
  - Structured output was empty, response format fell back from `json_schema` to `json_object`.
  - Repair failed preflight with `Prompt requires 32769 estimated tokens but budget is 32768`.

Replay conclusion: retry cost is dominated by avoidable LLM routing decisions and large batch repair/split churn. The budget failure still appears in this captured vault for a later source, so verification should include a replay-like high-token synthesis case even though the repair prompt inflation was separately fixed.

## Current Code Signals

- `src/phases/ingest-synthesis.ts` validates entity coverage with `validateSynthesisCoverage`; unknown keys fail with `unknown entity key`.
- `src/phases/ingest-synthesis.ts` validates canonical paths with `normalizedPath`; unsupported folders and stems fail as non-canonical wiki paths.
- `normalizeCreateActionPaths` currently repairs some single-entity create paths when the emitted path stem is close to the canonical stem, but it does not remove path choice from batch synthesis.
- `prompts/ingest-synthesis.md` still asks the model to return create actions with `path: "canonical new page path"`, so the LLM is still designing routing.
- `src/phases/entity-routing.ts` already documents deterministic routing after synthesis pages are created, but this happens after model output and cannot prevent semantic retry churn when synthesis output itself violates the path contract.
- `docs/superpowers/evals/obsidian-native-transport-correlation.json` records a complete body read followed by semantic synthesis validation failure for a canonical path issue.

## Wiki Context

iwiki domain `obsidian-ai-wiki` is connected. Relevant page found:

- `architecture/entity-type-routing.md` / `Mechanism`: existing routing architecture says page subfolder should be determined server-side from entity type, not by LLM-selected folders.

`wiki_lint` has existing advisories and stale pages, including stale `architecture/entity-type-routing.md` sourced from `src/phases/ingest-synthesis.ts`. Those are pre-existing and not fixed by this loop-start.

## Assumptions

- Launch mode is `delivery` because user asked for a bounded improvement, not recurring governance.
- Human approval is required before running the LoEn runner.
- Success is measured by stricter prompt/schema/code contract plus tests that simulate current retry causes, not by weakening validation.
