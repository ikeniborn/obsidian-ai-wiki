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
  try {
    for await (const e of gen) out.push(e);
  } catch (err) {
    throw err;
  }
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

// Fake runOperation: waits for abort signal, then returns (phases swallow AbortError)
async function* fakeRunOpHang(req: { signal: AbortSignal }): AsyncGenerator<RunEvent, void, void> {
  await new Promise<void>((resolve) => {
    req.signal.addEventListener("abort", () => resolve());
  });
  // Return without yielding — mimics phase behavior (swallow AbortError, exit cleanly)
}

// Fake runOperation: hangs on first call, succeeds on subsequent calls
function makeRunOpHangOnce() {
  let calls = 0;
  return async function* (req: { signal: AbortSignal }): AsyncGenerator<RunEvent, void, void> {
    calls++;
    if (calls === 1) {
      yield* fakeRunOpHang(req);
    } else {
      yield { kind: "result", durationMs: 1, text: "done after retry" };
    }
  };
}

describe("AgentRunner idle watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // @lat: [[tests#AgentRunner Idle Watchdog#Normal run]]
  it("normal run: no retry events emitted when operation completes before idle timeout", async () => {
    const settings = makeSettings({ llmIdleTimeoutSec: 10, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    vi.spyOn(runner as unknown as { runOperation: (...args: unknown[]) => AsyncGenerator<RunEvent, void, void> }, "runOperation")
      .mockImplementation(fakeRunOpSuccess);

    const events = await collect(runner.run(makeRequest()));
    const retryEvents = events.filter(
      (e): e is { kind: "system"; message: string } =>
        e.kind === "system" && (e as { kind: "system"; message: string }).message.includes("retrying"),
    );
    expect(retryEvents).toHaveLength(0);
  });

  // @lat: [[tests#AgentRunner Idle Watchdog#Idle retry success]]
  it("idle → retry → success: emits one system retry event and returns result", async () => {
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    const hangOnce = makeRunOpHangOnce();
    vi.spyOn(runner as unknown as { runOperation: (...args: unknown[]) => AsyncGenerator<RunEvent, void, void> }, "runOperation")
      .mockImplementation(function (req: unknown) {
        return hangOnce(req as { signal: AbortSignal });
      });

    const runPromise = collect(runner.run(makeRequest()));
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

  // @lat: [[tests#AgentRunner Idle Watchdog#Heartbeat on tool events]]
  it("heartbeat: tool_use/tool_result reset the idle timer — no retry, total > timeout", async () => {
    // Scenario: two tool events spaced 3 s apart (total 6 s), idle timeout 5 s.
    // Without heartbeat the idle timer fires at 5 s and triggers a spurious retry.
    // With heartbeat each tool event resets the timer so no retry is emitted.
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: 3 });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    // Gates controlled by fake-timer-driven resolvers so advanceTimersByTimeAsync drives progress.
    let resolveGate1!: () => void;
    let resolveGate2!: () => void;
    const gate1 = new Promise<void>((r) => { resolveGate1 = r; });
    const gate2 = new Promise<void>((r) => { resolveGate2 = r; });

    setTimeout(() => resolveGate1(), 3000);
    setTimeout(() => resolveGate2(), 6000);

    vi.spyOn(runner as unknown as { runOperation: (...a: unknown[]) => AsyncGenerator<RunEvent, void, void> }, "runOperation")
      .mockImplementation(async function* (): AsyncGenerator<RunEvent, void, void> {
        yield { kind: "tool_use", name: "Vision", input: {} };
        await gate1;
        yield { kind: "tool_result", ok: true };
        await gate2;
        yield { kind: "result", durationMs: 1, text: "done" };
      });

    const runPromise = collect(runner.run(makeRequest()));
    await vi.advanceTimersByTimeAsync(3100);  // fires gate1 (3 s) — tool_result should reset timer
    await vi.advanceTimersByTimeAsync(3100);  // fires gate2 (6 s) — result emitted
    const events = await runPromise;

    const retryEvents = events.filter(
      (e): e is { kind: "system"; message: string } =>
        e.kind === "system" && (e as { kind: "system"; message: string }).message.includes("retrying"),
    );
    expect(retryEvents).toHaveLength(0);
    expect(events.filter((e) => e.kind === "result")).toHaveLength(1);
  });

  // @lat: [[tests#AgentRunner Idle Watchdog#Idle exhausted]]
  it("idle exhausted: AbortError propagates after maxRetries attempts", async () => {
    const maxRetries = 2;
    const settings = makeSettings({ llmIdleTimeoutSec: 5, llmIdleRetries: maxRetries });
    const runner = new AgentRunner(noopLlm, settings, new VaultTools(mockAdapter(), "/vault"), "v", []);

    vi.spyOn(runner as unknown as { runOperation: (...args: unknown[]) => AsyncGenerator<RunEvent, void, void> }, "runOperation")
      .mockImplementation(function (req: unknown) {
        return fakeRunOpHang(req as { signal: AbortSignal });
      });

    let caughtError: unknown;
    const runPromise = collect(runner.run(makeRequest())).catch((err) => {
      caughtError = err;
    });

    for (let i = 0; i <= maxRetries; i++) {
      await vi.advanceTimersByTimeAsync(5_100);
    }
    await runPromise;

    expect(caughtError).toBeDefined();
    expect((caughtError as Error).message).toMatch(/idle timeout/i);
  });
});
