# Intent: vision pipeline optimization (per-attachment isolation + temp store)

**Date:** 2026-06-07
**Status:** approved

## Objective

The `format` operation's vision pre-step loops infinitely on pages with ≥4-5 attachments. Root cause: the idle-watchdog in [[src/agent-runner.ts#AgentRunner#run]] wraps the **entire** operation and only resets its timer on `assistant_text` / `llm_call_stats` events ([[src/agent-runner.ts]] line ~176). Vision calls in [[src/phases/attachment-analyzer.ts#callVisionLlm]] are `stream: false` and emit **no** such events; an excalidraw render takes ~65-78s each. Five attachments = ~350s of silence > the 300s idle threshold → the combined signal aborts the in-flight call ("Request was aborted") → the operation aborts → the watchdog restarts the whole `runFormat` from scratch → all vision calls are redone → loop never converges.

Why now: structured diagram-description vision shipped in release 0.1.166 (commit 15bab47) and is immediately non-functional on real vaults (FFBI.md with 5 `.excalidraw` embeds).

## Desired Outcomes

- Format of a page with 5 `.excalidraw` attachments completes to a `format_preview` — no "LLM idle … retrying" and no "Request was aborted" in the progress log.
- Each attachment is analyzed by exactly one LLM call per run, its description written to a temporary store keyed by the run.
- On an internal idle-retry, already-analyzed attachments are resumed from the temp store — never re-sent to the LLM.
- All vision descriptions are combined into a single formatting pass (existing `visionBlock` behavior preserved).
- Excalidraw PNG renders live in the plugin directory (`<pluginDir>/.vision-tmp/<runId>/`), never in the vault structure, and are deleted when the run finishes.

## Health Metrics

- Single-file / single-attachment format keeps working exactly as before.
- `--no-vision` path and non-vision format are untouched.
- The idle-watchdog still catches a genuinely hung single LLM call (one call silent past the threshold still aborts + retries).
- Source file is never modified — descriptions go to the `.formatted.md` preview only.
- Mobile / missing host `obsidian-excalidraw-plugin` → graceful skip, as today.
- Green: `tests#Format Sentinel Retry`, `tests#AgentRunner Idle Watchdog`, `tests#Format Sentinel Retry#Vision embed preserved`.

## Strategic Context

- Interacts with: [[src/phases/format.ts#runFormat]] (vision loop + final format call), [[src/phases/attachment-analyzer.ts]] (analyze* + render routing), [[src/agent-runner.ts#AgentRunner#run]] (watchdog + retry loop, runId owner), [[src/controller.ts]] (`renderExcalidrawPng` adapter + plugin tmpDir wiring), [[src/vault-tools.ts]] (adapter surface).
- Priority trade-off: **trust** — correctness/robustness over raw speed. Vision stays sequential (per user decision) to avoid rate-limit risk; the win comes from never redoing work, not from parallelism.

## Constraints

### Steering (behavioral guidance)
- Surgical changes; reuse the existing plugin-tmpDir pattern already in [[src/controller.ts]] (`join(pluginDir, "tmp")`, `getFullPath`, mkdir via adapter).
- Match existing code style; English code + comments.
- runId is generated once per user-initiated `run()` (stable across internal idle-retries), threaded into `runFormat`, temp dir cleaned in a `finally` after the retry loop.

### Hard (architectural enforcement)
- Each attachment = a separate LLM call, processed **sequentially** (req #1).
- Vision results stored in a temporary per-run store under the plugin directory, keyed by `<runId>` (+ attachment path), auto-deleted at run end (req #2).
- Excalidraw PNGs written to the plugin directory, **not** the vault (req #3).
- Idle-watchdog resets on per-attachment progress (heartbeat) so cumulative vision time cannot trip it; AND retry resumes from the temp store (both, per user decision).
- node builtins must stay lazy + desktop-guarded; use the Obsidian vault adapter API, never raw node `fs` on unguarded paths (see [[lint-before-release]]).
- `npm run lint`, the test suite, and `lat check` all green; `lat.md/` updated for the new temp-store + watchdog behavior.

## Autonomy Zones

- Full autonomy (reversible, low risk): temp-store implementation, heartbeat reset wiring, cache-resume in the vision loop, PNG-to-plugin-dir render path, new/updated tests.
- Guarded (log + care): changing the `resetTimer` trigger set in [[src/agent-runner.ts]] — must not weaken hung-call detection; threading runId through `runFormat`'s signature.
- Proposal-first (needs approval): any incompatible change to the `RunRequest` external contract, or changing backend/fallback semantics.
- No autonomy (human only): removing existing graceful-skip / fallback paths; altering source-file-never-modified guarantee.

> These zones OVERRIDE subagent-driven-development's "don't pause" default. RunRequest contract changes are a HUMAN CHECKPOINT.

## Stop Rules

- Halt if: a change breaks existing `AgentRunner Idle Watchdog` or `Format Sentinel Retry` tests.
- Escalate if: resume requires an incompatible change to the external `RunRequest` contract.
- Done when: format of the real FFBI.md (5 `.excalidraw`) reaches `format_preview` with all 5 descriptions present, the progress log shows no "retrying"/"aborted", the plugin temp dir is empty after the run, and `npm run lint` + tests + `lat check` are green.
