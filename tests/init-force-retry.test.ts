import assert from "node:assert/strict";
import { register } from "node:module";
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
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "demo" } };
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
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "demo" } };
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
