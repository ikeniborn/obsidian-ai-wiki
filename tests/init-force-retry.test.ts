import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { setTimeout as nodeSetTimeout } from "node:timers";
import test from "node:test";

import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunEvent } from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

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

test("desktop idle timers use Electron-compatible synchronous require", () => {
  const source = readFileSync(new URL("../src/agent-runner.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /await\s+import\(["']node:timers["']\)/);
  assert.match(source, /require\(["']node:timers["']\)/);
});

test("desktop idle watchdog falls back to process.getBuiltinModule in Node ESM", async () => {
  const idleSettings = settings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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

test("mobile idle timers do not evaluate desktop require", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    true,
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
  const idleSettings = settings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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
  const idleSettings = settings();
  idleSettings.llmIdleTimeoutSec = 0.02;
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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
    settings(),
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
    settings(),
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

test("operation-level idle retry still replays non-destructive operations", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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

test("silent idle abort after visible assistant text does not replay the operation", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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

test("agent runner keeps non-policy options while applying resolved model policy", () => {
  const base = settings();
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    base,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
  );
  const optsFor = runner as unknown as {
    buildOptsFor(op: "query" | "init"): {
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
        semanticCompression?: unknown;
        jsonMode?: unknown;
      };
    };
  };

  const queryOpts = optsFor.buildOptsFor("query").opts;
  assert.equal(queryOpts.inputBudgetTokens, 16_384);
  assert.equal(queryOpts.maxTokens, 4096);
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
  );
  const perOpOptsFor = perOpRunner as unknown as {
    buildOptsFor(op: "init"): {
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
        semanticCompression?: unknown;
        jsonMode?: unknown;
      };
    };
  };

  const initOpts = perOpOptsFor.buildOptsFor("init").opts;
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
  );
  const claudeOptsFor = claudeRunner as unknown as {
    buildOptsFor(op: "query"): {
      opts: {
        inputBudgetTokens?: number;
        maxTokens?: number;
      };
    };
  };

  const claudeOpts = claudeOptsFor.buildOptsFor("query").opts;
  assert.equal(claudeOpts.inputBudgetTokens, 16_384);
  assert.equal(claudeOpts.maxTokens, undefined);
});

test("llm lifecycle progress does not reset the semantic idle watchdog", async () => {
  const idleSettings = settings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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
  const idleSettings = settings();
  idleSettings.llmIdleRetries = 0;
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    idleSettings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
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
