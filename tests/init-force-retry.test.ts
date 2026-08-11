import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { setTimeout as nodeSetTimeout } from "node:timers";
import test from "node:test";

import { DEFAULT_SETTINGS, type LlmCallOptions, type LlmWikiPluginSettings, type RunEvent } from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import { stubModelContextStore } from "./model-context-stub";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") {
    return { url: "node:path", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

(globalThis as typeof globalThis & { require: NodeJS.Require }).require =
  createRequire(import.meta.url);

const { AgentRunner } = await import("../src/agent-runner");

(globalThis as unknown as { window: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> }).window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

function adapter(): VaultAdapter {
  const files = new Map<string, string>();
  return {
    read: async (p) => files.get(p) ?? "",
    write: async (p, v) => { files.set(p, v); },
    append: async (p, v) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async () => ({ files: [], folders: [] }),
    exists: async (p) => files.has(p),
    mkdir: async () => {},
    remove: async (p) => { files.delete(p); },
    rename: async (from, to) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
  };
}

function settings(): LlmWikiPluginSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    backend: "native-agent",
    llmIdleTimeoutSec: 0.01,
    llmIdleRetries: 1,
  };
}

function claudeSettings(): LlmWikiPluginSettings {
  return { ...settings(), backend: "claude-agent" };
}

test("runner emits effective idle timeout as machine-readable run configuration", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation =
    async function* () {};

  const events: RunEvent[] = [];
  for await (const event of runner.run({
    operation: "init",
    args: ["demo"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    events.push(event);
  }

  assert.deepEqual(
    events.find((event) => event.kind === "run_config"),
    {
      kind: "run_config",
      llmConnectionTimeoutMs: 15_000,
      llmIdleTimeoutMs: 10,
    },
  );
});

test("desktop idle timers use platform-neutral runtime timers", () => {
  const source = readFileSync(new URL("../src/agent-runner.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /await\s+import\(["']node:timers["']\)/);
  assert.doesNotMatch(source, /require\(["']node:timers["']\)/);
  assert.match(source, /scheduleRuntimeTimeout/);
  assert.match(source, /cancelRuntimeTimeout/);
});

test("desktop idle watchdog works without window timers or Node require", async () => {
  const idleSettings = claudeSettings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let enteredRunOperation!: () => void;
  const runOperationEntered = new Promise<void>((resolve) => {
    enteredRunOperation = resolve;
  });
  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    enteredRunOperation();
    await new Promise<void>((_, reject) => {
      req.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Request was aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const runtime = globalThis as typeof globalThis & { require?: NodeJS.Require };
  const originalRequire = runtime.require;
  const originalSetTimeout = window.setTimeout;
  delete runtime.require;
  window.setTimeout = (() => 1) as typeof window.setTimeout;
  try {
    const operation = (async () => {
      try {
        for await (const _event of runner.run({
          operation: "init",
          args: ["demo"],
          cwd: "/vault",
          signal: new AbortController().signal,
          timeoutMs: 0,
        })) {
          // Wait for the semantic idle watchdog.
        }
        return "resolved";
      } catch (error) {
        return error instanceof Error ? error.name : "unknown-error";
      }
    })();
    const outcome = await Promise.race([
      operation,
      (async () => {
        await runOperationEntered;
        return new Promise<string>((resolve) => nodeSetTimeout(() => resolve("still-pending"), 250));
      })(),
    ]);

    assert.equal(outcome, "AbortError");
  } finally {
    runtime.require = originalRequire;
    window.setTimeout = originalSetTimeout;
  }
});

test("mobile idle timers do not require Node timers", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    true,
    stubModelContextStore(),
  );
  (runner as unknown as {
    runOperation: () => AsyncGenerator<RunEvent>;
  }).runOperation = async function* () {
    yield { kind: "result", durationMs: 1, text: "ok" };
  };

  const runtime = globalThis as typeof globalThis & { require: NodeJS.Require };
  const originalRequire = runtime.require;
  let requireCalls = 0;
  runtime.require = (() => {
    requireCalls++;
    throw new Error("desktop require evaluated on mobile");
  }) as NodeJS.Require;
  try {
    for await (const _event of runner.run({
      operation: "query",
      args: ["hello"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      // Drain the mobile operation.
    }
  } finally {
    runtime.require = originalRequire;
  }

  assert.equal(requireCalls, 0);
});

test("streaming idle abort does not depend on Electron renderer timers", async () => {
  const idleSettings = claudeSettings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let enteredRunOperation!: () => void;
  const runOperationEntered = new Promise<void>((resolve) => {
    enteredRunOperation = resolve;
  });
  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    enteredRunOperation();
    await new Promise<void>((_, reject) => {
      req.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Request was aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const originalSetTimeout = window.setTimeout;
  window.setTimeout = (() => 1) as typeof window.setTimeout;
  try {
    const operation = (async () => {
      try {
        for await (const _event of runner.run({
          operation: "init",
          args: ["demo"],
          cwd: "/vault",
          signal: new AbortController().signal,
          timeoutMs: 0,
        })) {
          // Wait for the semantic idle watchdog.
        }
        return "resolved";
      } catch (error) {
        return error instanceof Error ? error.name : "unknown-error";
      }
    })();
    await runOperationEntered;
    const outcome = await Promise.race([
      operation,
      new Promise<string>((resolve) => nodeSetTimeout(() => resolve("still-pending"), 250)),
    ]);

    assert.equal(outcome, "AbortError");
  } finally {
    window.setTimeout = originalSetTimeout;
  }
});

test("consumer return clears the active idle timer without aborting later", async () => {
  const idleSettings = claudeSettings();
  idleSettings.llmIdleTimeoutSec = 0.02;
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let operationSignal: AbortSignal | undefined;
  let aborts = 0;
  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    operationSignal = req.signal;
    req.signal.addEventListener("abort", () => { aborts++; }, { once: true });
    yield { kind: "tool_use", name: "ConsumerCloseProbe", input: {} };
  };

  const iterator = runner.run({
    operation: "init",
    args: ["demo"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  });
  while (true) {
    const next = await iterator.next();
    assert.equal(next.done, false);
    if (next.value.kind === "tool_use" && next.value.name === "ConsumerCloseProbe") break;
  }
  await iterator.return(undefined as never);
  await new Promise<void>((resolve) => nodeSetTimeout(resolve, 100));

  assert.equal(operationSignal?.aborted, false);
  assert.equal(aborts, 0);
});

test("operation-level idle retry does not replay WipeDomain after destructive prelude", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [{
      id: "demo",
      name: "Demo",
      wiki_folder: "demo",
      source_paths: ["src"],
      entity_types: [],
      analyzed_sources: {},
    }],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation = async function* () {
    calls++;
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "!Wiki/demo" } };
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  };

  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const ev of runner.run({
      operation: "init",
      args: ["demo", "--force"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      events.push(ev);
    }
  }, /destructive/i);

  assert.equal(calls, 1);
  assert.equal(events.filter((ev) => ev.kind === "tool_use" && ev.name === "WipeDomain").length, 1);
  assert.deepEqual(
    events.find((ev) => ev.kind === "tool_use" && ev.name === "WipeDomain"),
    { kind: "tool_use", name: "WipeDomain", input: { folder: "!Wiki/demo" } },
  );
});

test("caught idle AbortError does not replay WipeDomain after destructive prelude", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [{
      id: "demo",
      name: "Demo",
      wiki_folder: "demo",
      source_paths: ["src"],
      entity_types: [],
      analyzed_sources: {},
    }],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as { runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent> }).runOperation = async function* (req) {
    calls++;
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "!Wiki/demo" } };
    await new Promise<void>((_, reject) => {
      req.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Request was aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const ev of runner.run({
      operation: "init",
      args: ["demo", "--force"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      events.push(ev);
    }
  }, /destructive/i);

  assert.equal(calls, 1);
  assert.equal(events.filter((ev) => ev.kind === "tool_use" && ev.name === "WipeDomain").length, 1);
});

test("Claude operation-level idle retry still replays non-destructive operations", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation = async function* () {
    calls++;
    if (calls === 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      return;
    }
    yield { kind: "result", durationMs: 1, text: "ok" };
  };

  const events: RunEvent[] = [];
  for await (const ev of runner.run({
    operation: "query",
    args: ["hello"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    events.push(ev);
  }

  assert.equal(calls, 2);
  assert.equal(events.some((ev) => ev.kind === "system" && ev.message.includes("retrying")), true);
  assert.equal(events.some((ev) => ev.kind === "result" && ev.text === "ok"), true);
});

test("native operation-level idle exhaustion never continues the outer runOperation loop", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation = async function* () {
    calls++;
    if (calls === 1) {
      throw new DOMException("native request idle timeout exhausted", "AbortError");
    }
    yield { kind: "result", durationMs: 1, text: "must-not-replay" };
  };

  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of runner.run({
      operation: "query",
      args: ["hello"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) events.push(event);
  }, /idle timeout/i);

  assert.equal(calls, 1);
  assert.equal(events.some((event) => event.kind === "result" && event.text === "must-not-replay"), false);
  assert.equal(events.some((event) => event.kind === "system" && event.message.includes("retrying")), false);
});

test("silent idle abort after visible assistant text does not replay the operation", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation = async function* () {
    calls++;
    yield { kind: "assistant_text", delta: `VISIBLE_${calls}` };
    if (calls === 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      return;
    }
    yield { kind: "result", durationMs: 1, text: "replayed" };
  };

  const events: RunEvent[] = [];
  let caught: unknown;
  try {
    for await (const ev of runner.run({
      operation: "query",
      args: ["hello"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      events.push(ev);
    }
  } catch (error) {
    caught = error;
  }

  assert.equal(calls, 1);
  assert.equal((caught as Error | undefined)?.name, "AbortError");
  assert.deepEqual(
    events
      .filter((event) => event.kind === "assistant_text" && !event.isReasoning)
      .map((event) => event.kind === "assistant_text" ? event.delta : ""),
    ["VISIBLE_1"],
  );
  assert.equal(events.some((event) => event.kind === "system" && event.message.includes("retrying")), false);
});

test("thrown idle AbortError after visible assistant text does not replay the operation", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let calls = 0;

  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    calls++;
    yield { kind: "assistant_text", delta: `VISIBLE_${calls}` };
    if (calls === 1) {
      await new Promise<void>((_, reject) => {
        req.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Request was aborted", "AbortError")),
          { once: true },
        );
      });
    }
    yield { kind: "result", durationMs: 1, text: "replayed" };
  };

  const events: RunEvent[] = [];
  let caught: unknown;
  try {
    for await (const ev of runner.run({
      operation: "query",
      args: ["hello"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      events.push(ev);
    }
  } catch (error) {
    caught = error;
  }

  assert.equal(calls, 1);
  assert.equal((caught as Error | undefined)?.name, "AbortError");
  assert.deepEqual(
    events
      .filter((event) => event.kind === "assistant_text" && !event.isReasoning)
      .map((event) => event.kind === "assistant_text" ? event.delta : ""),
    ["VISIBLE_1"],
  );
  assert.equal(events.some((event) => event.kind === "system" && event.message.includes("retrying")), false);
});

test("agent runner keeps non-policy options while applying resolved model policy", async () => {
  const base = settings();
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    base,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  const optsFor = runner as unknown as {
    buildOptsFor(op: "query" | "init"): Promise<{
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
        semanticCompression?: unknown;
        jsonMode?: unknown;
      };
    }>;
  };

  // No stored native budgets: both are derived from the stub's 131_072 window —
  // 8_192 out, floor((131_072 - 8_192) * 0.9) in.
  const queryOpts = (await optsFor.buildOptsFor("query")).opts;
  assert.equal(queryOpts.inputBudgetTokens, 110_592);
  assert.equal(queryOpts.maxTokens, 8192);
  assert.deepEqual(queryOpts.semanticCompression, {
    profile: "balanced",
    operation: "query",
  });
  assert.equal(queryOpts.jsonMode, undefined);

  const perOp = settings();
  perOp.nativeAgent.perOperation = true;
  perOp.nativeAgent.operations.init.inputBudgetTokens = 12_000;
  const perOpRunner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    perOp,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  const perOpOptsFor = perOpRunner as unknown as {
    buildOptsFor(op: "init"): Promise<{
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
        semanticCompression?: unknown;
        jsonMode?: unknown;
      };
    }>;
  };

  const initOpts = (await perOpOptsFor.buildOptsFor("init")).opts;
  assert.equal(initOpts.inputBudgetTokens, 12_000);
  assert.equal(initOpts.maxTokens, 8192);
  assert.deepEqual(initOpts.semanticCompression, {
    profile: "balanced",
    operation: "ingest",
  });
  assert.equal(initOpts.jsonMode, undefined);

  const claude = settings();
  claude.backend = "claude-agent";
  const claudeRunner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claude,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  const claudeOptsFor = claudeRunner as unknown as {
    buildOptsFor(op: "query"): Promise<{
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
      };
    }>;
  };

  const claudeOpts = (await claudeOptsFor.buildOptsFor("query")).opts;
  assert.equal(claudeOpts.inputBudgetTokens, 16_384);
  assert.equal(claudeOpts.maxTokens, undefined);
});

test("agent runner resolves a separate ingest runtime for init child work", async () => {
  const perOp = settings();
  perOp.nativeAgent.perOperation = true;
  perOp.nativeAgent.repairInputBudgetTokens = 65_536;
  perOp.nativeAgent.maxTokens = 65_536;
  perOp.nativeAgent.operations.init = {
    ...perOp.nativeAgent.operations.init,
    model: "init-model",
    inputBudgetTokens: 16_384,
    maxTokens: 4_096,
  };
  perOp.nativeAgent.operations.ingest = {
    ...perOp.nativeAgent.operations.ingest,
    model: "ingest-model",
    inputBudgetTokens: 65_536,
    maxTokens: 16_384,
  };
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    perOp,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let childRuntime: { model: string; opts: LlmCallOptions } | undefined;
  (runner as unknown as {
    runOperation: (...args: unknown[]) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (...args: unknown[]) {
    childRuntime = args[7] as typeof childRuntime;
  };

  for await (const _event of runner.run({
    operation: "init",
    args: ["demo"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    // Drain the operation so the captured dispatch arguments are final.
  }

  assert.equal(childRuntime?.model, "ingest-model");
  assert.equal(childRuntime?.opts.inputBudgetTokens, 65_536);
  assert.equal(childRuntime?.opts.repairInputBudgetTokens, 65_536);
  assert.equal(childRuntime?.opts.maxTokens, 16_384);
});

test("agent runner inherits global runtime for both init stages when per-operation settings are off", async () => {
  const global = settings();
  global.nativeAgent.perOperation = false;
  global.nativeAgent.model = "global-model";
  global.nativeAgent.inputBudgetTokens = 24_000;
  global.nativeAgent.repairInputBudgetTokens = 48_000;
  global.nativeAgent.maxTokens = 12_000;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    global,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let parentModel: unknown;
  let parentOpts: LlmCallOptions | undefined;
  let childRuntime: { model: string; opts: LlmCallOptions } | undefined;
  (runner as unknown as {
    runOperation: (...args: unknown[]) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (...args: unknown[]) {
    parentModel = args[1];
    parentOpts = args[2] as LlmCallOptions;
    childRuntime = args[7] as typeof childRuntime;
  };

  for await (const _event of runner.run({
    operation: "init",
    args: ["demo"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    // Drain the operation so the captured dispatch arguments are final.
  }

  assert.equal(parentModel, "global-model");
  assert.equal(childRuntime?.model, "global-model");
  for (const opts of [parentOpts, childRuntime?.opts]) {
    assert.equal(opts?.inputBudgetTokens, 24_000);
    // A stored repair budget may not exceed the input budget it repairs.
    assert.equal(opts?.repairInputBudgetTokens, 24_000);
    assert.equal(opts?.maxTokens, 12_000);
  }
});

test("llm lifecycle progress does not reset the semantic idle watchdog", async () => {
  const idleSettings = claudeSettings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    for (const phase of ["preparing", "sent", "waiting"] as const) {
      yield {
        kind: "llm_lifecycle",
        id: "hung-bootstrap",
        action: "bootstrap_domain",
        phase,
        atMs: Date.now(),
      };
      await new Promise<void>((resolve) => nodeSetTimeout(resolve, 6));
    }
    req.signal.throwIfAborted();
    await new Promise<void>((_, reject) => {
      req.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Request was aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const outcome = await Promise.race([
    (async () => {
      try {
        for await (const _event of runner.run({
          operation: "init",
          args: ["demo"],
          cwd: "/vault",
          signal: new AbortController().signal,
          timeoutMs: 0,
        })) {
          // Drain until watchdog abort.
        }
        return "resolved";
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
      }
    })(),
    new Promise<string>((resolve) => nodeSetTimeout(() => resolve("still-pending"), 250)),
  ]);
  assert.match(outcome, /^AbortError:/);
});

test("non-empty assistant reasoning resets the semantic idle watchdog", async () => {
  const idleSettings = claudeSettings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  (runner as unknown as {
    runOperation: () => AsyncGenerator<RunEvent>;
  }).runOperation = async function* () {
    for (let index = 0; index < 4; index++) {
      yield { kind: "assistant_text", delta: `reasoning-${index}`, isReasoning: true };
      await new Promise<void>((resolve) => nodeSetTimeout(resolve, 6));
    }
    yield { kind: "result", durationMs: 1, text: "ok" };
  };

  const events: RunEvent[] = [];
  for await (const event of runner.run({
    operation: "query",
    args: ["demo"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    events.push(event);
  }
  assert.equal(events.some((event) => event.kind === "result" && event.text === "ok"), true);
});
