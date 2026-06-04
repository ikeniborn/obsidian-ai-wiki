---
review:
  plan_hash: "6b533f3982417f80"
  spec_hash: "d64bcb8962cd09cd"
  last_run: "2026-06-04"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "## Task 2: Refactor `AgentRunner.run()` with idle watchdog retry loop"
      section_hash: "5e206b18338632fe"
      text: "Step 2 contains two contradictory code blocks: first block (with `runDevMode` helper) is abandoned mid-step by a 'Note: Actually...' correction. Implementer may use the wrong block."
      verdict: fixed
      verdict_at: "2026-06-04"
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "## File Structure"
      section_hash: "0a4be9030091d465"
      text: "Spec requires adding 3 tests to existing `tests/agent-runner.test.ts`; plan creates new file `tests/agent-runner-idle-retry.test.ts`. Deviation from spec's Files Changed table."
      verdict: fixed
      verdict_at: "2026-06-04"
    - id: F-003
      phase: dependencies
      severity: WARNING
      section: "## Task 3: Write unit tests for the idle watchdog"
      section_hash: "35d7ccaf5a98f881"
      text: "Step 2 expects tests to FAIL, but Task 2 (implementation) is already complete at this point. Expected outcome contradicts task ordering — tests should PASS, not fail."
      verdict: fixed
      verdict_at: "2026-06-04"
    - id: F-004
      phase: verifiability
      severity: WARNING
      section: "## Task 2: Refactor `AgentRunner.run()` with idle watchdog retry loop"
      section_hash: "5e206b18338632fe"
      text: "Step 1 DoD: 'Confirm lines 133-177 match what was read above' — self-referential, no self-contained check command or expected output."
      verdict: fixed
      verdict_at: "2026-06-04"
chain:
  intent: "docs/superpowers/intents/2026-06-04-init-hang-retry-intent.md"
  spec: "docs/superpowers/specs/2026-06-04-init-hang-retry-design.md"
---
# Init/Ingest/Lint Hang Detection and Auto-Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect LLM idle silence (no `llm_call_stats`/`assistant_text` events) during init/ingest/lint and auto-retry up to N times before propagating AbortError.

**Architecture:** Wrap `AgentRunner.run()` in a retry loop with a per-attempt `AbortController`. An idle timer fires after `llmIdleTimeoutSec` seconds of silence; on abort from the timer (not from user cancellation) the loop retries up to `llmIdleRetries` times, emitting a `kind: "system"` retry event each time. `devMode`/eval logic runs only on the final successful attempt.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin SDK (`Setting`, `i18n`). No new libraries.

---

## File Structure

| File | Change |
|------|--------|
| `src/types.ts` | Add `llmIdleTimeoutSec` + `llmIdleRetries` to `LlmWikiPluginSettings` + `DEFAULT_SETTINGS` |
| `src/agent-runner.ts` | Refactor `run()`: move `devMode`/eval block into helper, wrap `runOperation` in retry loop |
| `src/settings.ts` | Add two `Setting` controls under General settings heading |
| `src/i18n.ts` | Add two keys to `en`, `ru`, `es` |
| `tests/agent-runner.test.ts` | Add 3 unit tests with fake `runOperation` |

---

## Task 1: Add settings fields to `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add fields to `LlmWikiPluginSettings` interface**

In `src/types.ts`, after the `lintOptions` field (line 197), add:

```typescript
  llmIdleTimeoutSec: number;
  llmIdleRetries: number;
```

- [ ] **Step 2: Add defaults to `DEFAULT_SETTINGS`**

In `DEFAULT_SETTINGS` (after `lintOptions`, around line 248), add:

```typescript
  llmIdleTimeoutSec: 300,
  llmIdleRetries: 3,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add llmIdleTimeoutSec and llmIdleRetries settings fields"
```

---

## Task 2: Refactor `AgentRunner.run()` with idle watchdog retry loop

**Files:**
- Modify: `src/agent-runner.ts`

The current `run()` method (lines 133–177) has a single `for await` loop plus `devMode`/eval logic inline. Replace it with a `while(true)` retry loop using idle `AbortController`, keeping `devMode`/eval inline on the final attempt.

- [ ] **Step 1: Read current `run()` method carefully**

```bash
sed -n '133,177p' src/agent-runner.ts
```
Expected: method signature `async *run(req: RunRequest)` at line 133, closing `}` at line 177.

- [ ] **Step 2: Replace `run()` with the retry loop implementation**

Replace the entire `async *run(req: RunRequest)` method (lines 133–177) with:

```typescript
  async *run(req: RunRequest): AsyncGenerator<RunEvent, void, void> {
    const { model, opts } = this.buildOptsFor(req.operation);
    const baseUrlHint = this.settings.backend === "native-agent"
      ? ` @ ${this.settings.nativeAgent.baseUrl}`
      : "";
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}${baseUrlHint}` };

    if (req.signal.aborted) return;

    const vaultRoot = req.cwd ?? "";
    const domains = req.domainId
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;

    const similarity = this.buildSimilarity();
    const startMs = Date.now();

    const idleTimeoutMs = (this.settings.llmIdleTimeoutSec ?? 300) * 1000;
    const maxRetries = this.settings.llmIdleRetries ?? 3;
    let attempt = 0;

    while (true) {
      const idleCtrl = new AbortController();
      const combined = idleTimeoutMs > 0
        ? AbortSignal.any([req.signal, idleCtrl.signal])
        : req.signal;
      let idleTimer: ReturnType<typeof setTimeout> | null =
        idleTimeoutMs > 0 ? setTimeout(() => idleCtrl.abort(), idleTimeoutMs) : null;

      const resetTimer = () => {
        if (!idleTimer) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idleCtrl.abort(), idleTimeoutMs);
      };

      let finalResultText = "";
      try {
        for await (const ev of this.runOperation({ ...req, signal: combined }, model, opts, vaultRoot, domains, similarity)) {
          if (ev.kind === "llm_call_stats" || ev.kind === "assistant_text") resetTimer();
          if (ev.kind === "result") finalResultText = ev.text;
          yield ev;
        }
        if (idleTimer) clearTimeout(idleTimer);
        // devMode/eval runs only on final successful attempt
        if (this.settings.devMode?.enabled && finalResultText) {
          const taskInput = req.args.join(" ") || req.operation;
          await this.writeDevLog(vaultRoot, {
            operation: req.operation,
            model,
            systemPrompt: opts.systemPrompt ?? "",
            userMessage: taskInput,
            result: finalResultText,
            durationMs: Date.now() - startMs,
          });
          if (this.settings.devMode.evaluatorModel) {
            const evalModel = this.settings.devMode.evaluatorModel;
            for await (const ev of runEvaluator(this.llm, evalModel, req.operation, taskInput, finalResultText, req.signal)) {
              yield ev;
              if (ev.kind === "eval_result") {
                await this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
              }
            }
          }
        }
        return;
      } catch (err) {
        if (idleTimer) clearTimeout(idleTimer);
        const isIdleAbort = !req.signal.aborted && (err as Error).name === "AbortError";
        if (isIdleAbort && attempt < maxRetries) {
          attempt++;
          const sec = Math.round(idleTimeoutMs / 1000);
          yield { kind: "system", message: `LLM idle ${sec}s — retrying (${attempt}/${maxRetries})` };
          continue;
        }
        throw err;
      }
    }
  }
```

Note that `runOperation` now receives `{ ...req, signal: combined }` to pass the combined signal. The `RunRequest` type has `signal: AbortSignal`, so spreading `req` with an overridden `signal` works.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
npx vitest run tests/agent-runner-dev-log.test.ts
```
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): add idle watchdog retry loop in run()"
```

---

## Task 3: Write unit tests for the idle watchdog

**Files:**
- Modify: `tests/agent-runner.test.ts`

The tests use a fake `runOperation` injected via constructor subclass or via spy. The cleanest approach is to spy on the private `runOperation` method using `vi.spyOn`.

- [ ] **Step 1: Add tests to `tests/agent-runner.test.ts`**

Append the following `describe` block to `tests/agent-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { RunEvent, LlmWikiPluginSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

function mockAdapter(): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

const noopLlm = {
  chat: { completions: { create: vi.fn() } },
} as unknown as import("../src/types").LlmClient;

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function makeSettings(overrides: Partial<LlmWikiPluginSettings> = {}): LlmWikiPluginSettings {
  return { ...DEFAULT_SETTINGS, backend: "native-agent", ...overrides };
}

function makeRequest(signal?: AbortSignal): Parameters<AgentRunner["run"]>[0] {
  return {
    operation: "init",
    args: [],
    cwd: "/vault",
    signal: signal ?? new AbortController().signal,
    timeoutMs: 30_000,
  };
}

// Fake runOperation: yields a result event immediately (normal completion)
async function* fakeRunOpSuccess(): AsyncGenerator<RunEvent, void, void> {
  yield { kind: "result", durationMs: 1, text: "done" };
}

// Fake runOperation: hangs forever (never yields), so idle timer fires
async function* fakeRunOpHang(signal: AbortSignal): AsyncGenerator<RunEvent, void, void> {
  await new Promise<void>((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

// Fake runOperation: hangs on first call, succeeds on subsequent calls
function makeRunOpHangOnce() {
  let calls = 0;
  return async function* (req: { signal: AbortSignal }): AsyncGenerator<RunEvent, void, void> {
    calls++;
    if (calls === 1) {
      yield* fakeRunOpHang(req.signal);
    } else {
      yield { kind: "result", durationMs: 1, text: "done after retry" };
    }
  };
}

describe("AgentRunner idle watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("normal run: no retry events emitted when operation completes before idle timeout", async () => {
    const settings = makeSettings({ llmIdleTimeoutSec: 10, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    // Spy on private runOperation to return success immediately
    vi.spyOn(runner as unknown as { runOperation: unknown }, "runOperation")
      .mockImplementation(fakeRunOpSuccess);

    const events = await collect(runner.run(makeRequest()));
    const systemEvents = events.filter((e) => e.kind === "system");
    const retryEvents = systemEvents.filter(
      (e) => e.kind === "system" && (e as { kind: "system"; message: string }).message.includes("retrying"),
    );
    expect(retryEvents).toHaveLength(0);
  });

  it("idle → retry → success: emits one system retry event and returns result", async () => {
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    const hangOnce = makeRunOpHangOnce();
    vi.spyOn(runner as unknown as { runOperation: unknown }, "runOperation")
      .mockImplementation(function* (req: { signal: AbortSignal }) {
        yield* hangOnce(req);
      });

    const runPromise = collect(runner.run(makeRequest()));
    // Advance timer past idle timeout to trigger abort
    await vi.advanceTimersByTimeAsync(5_100);
    const events = await runPromise;

    const retryEvents = events.filter(
      (e): e is { kind: "system"; message: string } =>
        e.kind === "system" && e.message.includes("retrying"),
    );
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].message).toMatch(/LLM idle 5s — retrying \(1\/3\)/);

    const resultEvents = events.filter((e) => e.kind === "result");
    expect(resultEvents).toHaveLength(1);
  });

  it("idle exhausted: AbortError propagates after maxRetries attempts, correct retry count in messages", async () => {
    const maxRetries = 2;
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: maxRetries });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    vi.spyOn(runner as unknown as { runOperation: unknown }, "runOperation")
      .mockImplementation(async function* (req: { signal: AbortSignal }) {
        yield* fakeRunOpHang(req.signal);
      });

    const runPromise = collect(runner.run(makeRequest()));
    // Advance past all retry attempts: (maxRetries + 1) timeouts
    for (let i = 0; i <= maxRetries; i++) {
      await vi.advanceTimersByTimeAsync(5_100);
    }

    await expect(runPromise).rejects.toThrow(/AbortError|aborted/i);
  });
});
```

- [ ] **Step 2: Run new tests to confirm they PASS**

```bash
npx vitest run tests/agent-runner.test.ts
```
Expected: all idle watchdog tests PASS (Task 2 implementation already in place)

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
npx vitest run
```
Expected: all tests PASS (no regressions in existing tests)

- [ ] **Step 4: Commit**

```bash
git add tests/agent-runner.test.ts
git commit -m "test(agent-runner): add idle watchdog retry unit tests"
```

---

## Task 4: Add i18n strings for new settings fields

**Files:**
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add English strings**

In `src/i18n.ts`, in the `en.settings` object (after `structuredRetries_desc`, around line 93), add:

```typescript
    llmIdleTimeout_name: "LLM idle timeout (seconds)",
    llmIdleTimeout_desc: "Seconds of LLM silence before aborting the attempt. 0 = disabled.",
    llmIdleRetries_name: "LLM idle retries",
    llmIdleRetries_desc: "Max retry attempts after idle abort (0 = no retry).",
```

- [ ] **Step 2: Add Russian strings**

In `ru.settings` (after `structuredRetries_desc`, around line 323), add:

```typescript
    llmIdleTimeout_name: "Таймаут простоя LLM (секунды)",
    llmIdleTimeout_desc: "Секунд тишины LLM до прерывания попытки. 0 = отключено.",
    llmIdleRetries_name: "Повторы при простое LLM",
    llmIdleRetries_desc: "Макс. число повторов после прерывания по простою (0 = без повторов).",
```

- [ ] **Step 3: Add Spanish strings**

In `es.settings` (after `structuredRetries_desc`, around line 551), add:

```typescript
    llmIdleTimeout_name: "Tiempo de espera de inactividad LLM (segundos)",
    llmIdleTimeout_desc: "Segundos de silencio LLM antes de abortar el intento. 0 = desactivado.",
    llmIdleRetries_name: "Reintentos por inactividad LLM",
    llmIdleRetries_desc: "Máx. reintentos tras aborto por inactividad (0 = sin reintentos).",
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: error — `I18n` type requires new keys in all locales, so all 3 must be added before it passes.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(i18n): add llmIdleTimeout and llmIdleRetries setting strings (en/ru/es)"
```

---

## Task 5: Add UI controls in `src/settings.ts`

**Files:**
- Modify: `src/settings.ts`

New settings fields belong under "General settings" (`h3_general`), after the `timeouts` control (lines 161–173).

- [ ] **Step 1: Add idle timeout Setting**

In `src/settings.ts`, after the timeouts `Setting` block (after line 173, before the `historyLimit` block at line 175), add:

```typescript
    new Setting(containerEl)
      .setName(T.settings.llmIdleTimeout_name)
      .setDesc(T.settings.llmIdleTimeout_desc)
      .addText((t) =>
        t.setPlaceholder("300")
          .setValue(String(s.llmIdleTimeoutSec))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) {
              s.llmIdleTimeoutSec = Math.floor(n);
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.llmIdleRetries_name)
      .setDesc(T.settings.llmIdleRetries_desc)
      .addText((t) =>
        t.setPlaceholder("3")
          .setValue(String(s.llmIdleRetries))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0) {
              s.llmIdleRetries = n;
              await this.plugin.saveSettings();
            }
          }),
      );
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): add UI controls for llmIdleTimeoutSec and llmIdleRetries"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `llmIdleTimeoutSec` / `llmIdleRetries` in interface + DEFAULT_SETTINGS | Task 1 |
| Retry loop with per-attempt `AbortController` | Task 2 |
| `AbortSignal.any([req.signal, idleCtrl.signal])` passed to `runOperation` | Task 2 |
| Idle timer reset on `llm_call_stats` / `assistant_text` | Task 2 |
| `req.signal.aborted` check to distinguish user cancel from idle timeout | Task 2 |
| `kind: "system"` retry event with message format | Task 2 |
| devMode/eval runs only on final successful attempt | Task 2 |
| `idleTimeoutMs = 0` disables watchdog | Task 2 |
| 3 unit tests (normal / retry→success / exhausted) | Task 3 |
| Settings UI | Task 5 |
| i18n strings (en/ru/es) | Task 4 |

**Potential issue — `AbortSignal.any` availability:** `AbortSignal.any()` is available in Node 20+ and modern browsers. Obsidian desktop uses Electron (Chromium), so this is available. If targeting older environments this would need a polyfill, but the spec doesn't flag this as a constraint.

**Potential issue — `runOperation` private method spy:** `vi.spyOn` works on TypeScript private methods at runtime (they're just regular JS properties). The cast `as unknown as { runOperation: unknown }` is the standard pattern for this in the existing codebase (see `agent-runner-dev-log.test.ts`).

**Type consistency check:** `RunRequest.signal` is `AbortSignal`. In Task 2, `{ ...req, signal: combined }` overrides `signal` with the combined `AbortSignal` — valid. The `combined` variable is typed as `AbortSignal` (return type of `AbortSignal.any()`).
