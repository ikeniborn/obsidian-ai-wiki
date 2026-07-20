import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";
import { setTimeout as nodeSetTimeout } from "node:timers";
import test from "node:test";
import type OpenAI from "openai";
import { APIError } from "openai";

import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunEvent } from "../src/types";
import * as nativeExecutor from "../src/native-llm-executor";
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
    { kind: "run_config", llmIdleTimeoutMs: 10 },
  );
});

test("desktop idle timers use Electron-compatible synchronous require", () => {
  const source = readFileSync(new URL("../src/agent-runner.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /await\s+import\(["']node:timers["']\)/);
  assert.match(source, /require\(["']node:timers["']\)/);
});

test("desktop idle watchdog falls back to process.getBuiltinModule in Node ESM", async () => {
  const idleSettings = claudeSettings();
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
    claudeSettings(),
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
  const idleSettings = claudeSettings();
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
  const idleSettings = claudeSettings();
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

test("native synthesis 502 retries only the request and keeps Re-init effects exactly once", async () => {
  type CreateNativeClient = (create: (
    params: unknown,
    options: { signal: AbortSignal },
  ) => Promise<OpenAI.Chat.ChatCompletion>) => {
    chat: { completions: { create: (params: unknown, options: unknown) => Promise<OpenAI.Chat.ChatCompletion> } };
  };
  const createNativeClient = (nativeExecutor as unknown as {
    createNativeLlmClient?: CreateNativeClient;
  }).createNativeLlmClient;
  assert.equal(typeof createNativeClient, "function", "native executor client adapter is missing");

  let synthesisAttempts = 0;
  const llm = createNativeClient!(async (_params, _options) => {
    synthesisAttempts++;
    if (synthesisAttempts === 1) {
      throw APIError.generate(502, {}, undefined, new Headers());
    }
    return {
      id: "synthesis-ok",
      object: "chat.completion",
      created: 0,
      model: "mock",
      choices: [{
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content: "ok", refusal: null },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  });
  const runner = new AgentRunner(
    llm as never,
    settings(),
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
  );
  let runOperationCalls = 0;
  let wipeDomain = 0;
  let sourceReads = 0;
  let evidenceApplies = 0;
  let pageApplies = 0;
  let indexApplies = 0;

  (runner as unknown as {
    runOperation: (req: { signal: AbortSignal }) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req) {
    runOperationCalls++;
    wipeDomain++;
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "!Wiki/demo" } };
    sourceReads++;
    evidenceApplies++;
    let current = { id: "synthesis", action: "synthesize_wiki_pages" as const };
    const onEvent = (_event: RunEvent) => {};
    await llm.chat.completions.create({ model: "mock", messages: [], stream: false }, {
      signal: req.signal,
      retry: {
        logicalRequestId: "synthesis",
        callSite: "ingest.synthesize",
        maxRetries: 1,
        idleTimeoutMs: 0,
        signal: req.signal,
        onEvent,
        lifecycle: {
          begin(attempt: number) {
            current = attempt === 0
              ? current
              : { id: `synthesis:retry-${attempt}`, action: "retry_model_request" };
          },
          phase() {},
          close() {},
          current: () => current,
        },
        delay: async () => {},
      },
    });
    pageApplies++;
    indexApplies++;
    yield { kind: "result", durationMs: 1, text: "ok" };
  };

  for await (const _event of runner.run({
    operation: "init",
    args: ["demo", "--force"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) {
    // Drain the simulated full Re-init boundary.
  }

  assert.equal(runOperationCalls, 1);
  assert.equal(wipeDomain, 1);
  assert.equal(sourceReads, 1);
  assert.equal(evidenceApplies, 1);
  assert.equal(pageApplies, 1);
  assert.equal(indexApplies, 1);
  assert.equal(synthesisAttempts, 2);
});

test("silent idle abort after visible assistant text does not replay the operation", async () => {
  const runner = new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    claudeSettings(),
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
    claudeSettings(),
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
  const idleSettings = claudeSettings();
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
  const idleSettings = claudeSettings();
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
