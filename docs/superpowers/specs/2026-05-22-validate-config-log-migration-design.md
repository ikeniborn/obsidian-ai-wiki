---
title: Validate .config log migration — fix + tests
date: 2026-05-22
status: approved
---

## Goal

Verify and harden the migration of `agent.jsonl`, `dev.jsonl`, and `_domain.json` to `!Wiki/.config/`. Two deliverables: fix a failing test caused by stale spy state; add unit tests for `writeDevLog` and `updateDevLogEval` that explicitly assert the new paths.

## Audit Result

All production paths are correct:

| File | Method | Path |
|------|--------|------|
| `src/controller.ts` | `logEvent()` | `!Wiki/.config/_agent.jsonl` |
| `src/agent-runner.ts` | `writeDevLog()` | `!Wiki/.config/_dev.jsonl` |
| `src/agent-runner.ts` | `updateDevLogEval()` | `!Wiki/.config/_dev.jsonl` |
| `src/domain-store.ts` | `save()` | `!Wiki/.config/_domain.json` |
| `src/main.ts` | migration check | `!Wiki/.config/_domain.json` |
| `src/i18n.ts` | `agentLog_desc` (en/ru/es) | `!Wiki/.config/_agent.jsonl` |

No `!Logs` references remain in source code.

## Changes

### Fix: `tests/controller-cache-invalidation.test.ts`

Add `afterEach(() => { vi.restoreAllMocks(); })` inside the `describe` block.

**Why it fails:** `vi.spyOn(graphCache, "invalidate")` in each test does not reset the spy's call history from previous tests. By the time the "query does NOT invalidate" test runs, the spy has accumulated 5 calls from prior tests. `expect(invalidateSpy).not.toHaveBeenCalled()` fails with count=6 (5 prior + 1 from somewhere).

`vi.restoreAllMocks()` in `afterEach` restores the original function and clears call history before each test.

### New: `tests/agent-runner-dev-log.test.ts`

Unit tests for `writeDevLog` and `updateDevLogEval`, run through `AgentRunner.run()` with `devMode.enabled = true`.

**Test 1 — writeDevLog writes to correct path:**
- `devMode.enabled = true`
- Run `ingest` operation
- Assert: `adapter.write` or `adapter.append` called with `"!Wiki/.config/_dev.jsonl"`
- Assert: `adapter.mkdir` called with `"!Wiki/.config"` (safety-net mkdir)

**Test 2 — writeDevLog skips when devMode disabled:**
- `devMode.enabled = false`
- Run `ingest` operation
- Assert: no write/append call to any `_dev.jsonl` path

**Test 3 — updateDevLogEval patches last line:**
- `devMode.enabled = true`; LLM mock returns valid evaluator JSON `{ score: 4, reasoning: "ok" }` for the evaluator call
- Adapter `exists("!Wiki/.config/_dev.jsonl")` returns `true`; `read` returns a single JSONL line `{"ts":"...","eval":null}`
- After run: `adapter.write` called with `"!Wiki/.config/_dev.jsonl"`; written content last line contains `"eval":{"score":4,"reasoning":"ok"}`

## Out of Scope

- No changes to production code
- No migration of old `!Logs` files
- No tests for `logEvent()` in controller (already covered by `controller-log-adapter.test.ts`)
