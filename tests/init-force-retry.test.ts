import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
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
    llmIdleTimeoutSec: 0.01,
    llmIdleRetries: 1,
  };
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
  assert.deepEqual(
    events.find((event) => event.kind === "system"),
    {
      kind: "system",
      message: "openai-compatible / llama3.2 / http://localhost:11434/v1",
    },
  );
});

test("AgentRunner does not replay an exhausted OpenAI request", async () => {
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
  (runner as unknown as { runOperation: () => AsyncGenerator<RunEvent> }).runOperation =
    async function* () {
      calls++;
      if (calls === 1) {
        throw new DOMException("OpenAI request idle timeout exhausted", "AbortError");
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

test("agent runner keeps OpenAI retry and policy options", async () => {
  const base = settings();
  base.llmIdleRetries = 4;
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
        nativeRequestRetries?: number;
      };
    }>;
  };

  const queryOpts = (await optsFor.buildOptsFor("query")).opts;
  assert.equal(queryOpts.inputBudgetTokens, 110_592);
  assert.equal(queryOpts.maxTokens, 8192);
  assert.deepEqual(queryOpts.semanticCompression, {
    profile: "balanced",
    operation: "query",
  });
  assert.equal(queryOpts.jsonMode, undefined);
  assert.equal(queryOpts.nativeRequestRetries, 4);

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
    assert.equal(opts?.repairInputBudgetTokens, 24_000);
    assert.equal(opts?.maxTokens, 12_000);
  }
});
