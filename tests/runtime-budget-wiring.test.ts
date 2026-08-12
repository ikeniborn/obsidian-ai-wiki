import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import test from "node:test";

import { DEFAULT_SETTINGS, type LlmCallOptions, type LlmWikiPluginSettings, type RunEvent } from "../src/types";
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

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

const { AgentRunner } = await import("../src/agent-runner");
const { ModelContextStore } = await import("../src/model-context");
const { runWithContextRepack } = await import("../src/prompt-budget");
type ModelContextStore = InstanceType<typeof ModelContextStore>;

function adapter(): VaultAdapter {
  const files = new Map<string, string>();
  return {
    read: async (p) => files.get(p) ?? "",
    write: async (p, c) => { files.set(p, c); },
    append: async (p, c) => { files.set(p, (files.get(p) ?? "") + c); },
    exists: async (p) => files.has(p),
    list: async () => ({ files: [...files.keys()], folders: [] }),
    stat: async () => null,
    mkdir: async () => {},
    remove: async (p) => { files.delete(p); },
    rename: async (from, to) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
  };
}

function nativeSettings(): LlmWikiPluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.backend = "native-agent";
  settings.nativeAgent.baseUrl = "http://host/v1";
  settings.nativeAgent.model = "global-model";
  return settings;
}

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

/** A /models payload that reports a different window for each model. */
function modelsFetch(calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    return json({
      data: [
        { id: "global-model", context_length: 131_072 },
        { id: "per-op-model", context_length: 40_960 },
      ],
    });
  }) as typeof fetch;
}

function storeWith(fetchFn: typeof fetch, written: Array<Record<string, unknown>> = []): ModelContextStore {
  return new ModelContextStore({
    read: async () => ({}),
    write: async (next) => { written.push(next as unknown as Record<string, unknown>); },
    fetchFn,
  });
}

function runner(
  settings: LlmWikiPluginSettings,
  store: ModelContextStore,
): InstanceType<typeof AgentRunner> {
  return new AgentRunner(
    { chat: { completions: { create: async () => { throw new Error("unused"); } } } } as never,
    settings,
    new VaultTools(adapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    store,
  );
}

/** Replaces the operation with one that only reports the options it was handed. */
function captureOperation(
  instance: InstanceType<typeof AgentRunner>,
  body: (opts: LlmCallOptions) => Promise<void> | void = () => {},
): { opts?: LlmCallOptions } {
  const captured: { opts?: LlmCallOptions } = {};
  (instance as unknown as {
    runOperation: (
      req: unknown,
      model: string,
      opts: LlmCallOptions,
    ) => AsyncGenerator<RunEvent>;
  }).runOperation = async function* (_req, _model, opts) {
    captured.opts = opts;
    await body(opts);
    yield { kind: "result", durationMs: 1, text: "ok" };
  };
  return captured;
}

async function drain(generator: AsyncGenerator<RunEvent, void, void>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function runRequest(operation: "query" | "init" = "query"): Parameters<
  InstanceType<typeof AgentRunner>["run"]
>[0] {
  return {
    operation,
    args: [],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  };
}

test("the probe asks for the model the operation will actually use", async () => {
  const settings = nativeSettings();
  settings.nativeAgent.perOperation = true;
  settings.nativeAgent.operations.query = {
    ...settings.nativeAgent.operations.query,
    model: "per-op-model",
    inputBudgetTokens: undefined,
    maxTokens: undefined,
  };
  const store = storeWith(modelsFetch());
  const instance = runner(settings, store);
  captureOperation(instance);

  const events = await drain(instance.run(runRequest()));

  const probe = events.find((event) => event.kind === "context_probe");
  assert.ok(probe && probe.kind === "context_probe");
  assert.equal(probe.model, "per-op-model");
  assert.equal(probe.endpoint, "http://host/v1/models");
  assert.equal(probe.ok, true);
  assert.equal(probe.matchedById, true);
  assert.equal(probe.contextLength, 40_960);

  const resolved = events.find((event) => event.kind === "budget_resolved");
  assert.ok(resolved && resolved.kind === "budget_resolved");
  assert.equal(resolved.model, "per-op-model");
  // 40_960, not the 131_072 the globally configured model reports.
  assert.equal(resolved.contextWindow, 40_960);
  assert.equal(resolved.inputSource, "discovered");
  assert.equal(resolved.inputBudget, 29_491);
  assert.equal(resolved.outputBudget, 8_192);
});

test("options are produced only after the record resolves", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const record = { contextWindow: 40_960, source: "discovered" as const, calibration: 1, samples: 0 };
  const store = {
    get: () => record,
    resolve: async () => { await gate; return record; },
    observeUsage: () => ({ ratio: 1, applied: true, clamped: false }),
    observeContextError: () => {},
  } as unknown as ModelContextStore;
  const instance = runner(nativeSettings(), store);
  const captured = captureOperation(instance);

  const generator = instance.run(runRequest());
  const first = generator.next();
  let settled = false;
  void first.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false, "run must await the record before it emits anything");

  release();
  await first;
  await drain(generator);
  assert.equal(captured.opts?.contextWindowTokens, 40_960);
});

test("a discarded calibration sample is reported as discarded", async () => {
  const store = storeWith(modelsFetch());
  const instance = runner(nativeSettings(), store);
  captureOperation(instance, (opts) => {
    // Ten times the estimate: outside the plausible band, so it is thrown away.
    opts.onUsageObserved?.({ estimated: 100, actual: 1_000, calibration: 1 });
    opts.onUsageObserved?.({ estimated: 100, actual: 120, calibration: 1 });
  });

  const events = await drain(instance.run(runRequest()));
  const samples = events.filter((event) => event.kind === "calibration_sample");
  assert.equal(samples.length, 2);
  // `appliedCalibration` travels with the sample so `agent.jsonl` can be read on its
  // own: without it, reconstructing what the estimate was measured through needs a
  // join back to the run's `budget_resolved` record.
  assert.deepEqual(samples[0], {
    kind: "calibration_sample",
    model: "global-model",
    estimated: 100,
    actual: 1_000,
    appliedCalibration: 1,
    ratio: 10,
    applied: false,
    clamped: true,
  });
  assert.equal(store.get("http://host/v1", "global-model")?.calibration, 1.2);
  assert.equal(samples[1].kind === "calibration_sample" && samples[1].applied, true);
});

test("a provider context rejection inside the repack shrinks the stored window", async () => {
  const store = storeWith(modelsFetch());
  const instance = runner(nativeSettings(), store);
  captureOperation(instance, async (opts) => {
    await assert.rejects(runWithContextRepack({
      callSite: "query.answer",
      configuredInputBudget: 4_000,
      compressionProfile: "balanced",
      onContextError: opts.onContextError,
      build: () => ({ value: null, estimatedInputTokens: 10, contextUnits: 1 }),
      execute: () => {
        throw new Error("This model's maximum context length is 8192 tokens, however you requested 20000 tokens");
      },
      onEvent: () => {},
    }));
  });

  await drain(instance.run(runRequest()));

  const record = store.get("http://host/v1", "global-model");
  assert.equal(record?.contextWindow, 8_192, "the provider's own number replaces the probed window");
  assert.equal(record?.source, "learned");
});

test("a context rejection without a token count leaves the stored window alone", async () => {
  const store = storeWith(modelsFetch());
  const instance = runner(nativeSettings(), store);
  captureOperation(instance, async (opts) => {
    // Classified by error CODE alone, so it carries no numbers: it says the
    // prompt was too big, not how big the window is. runWithContextRepack calls
    // onContextError once per attempt, which is where a guess would compound.
    await assert.rejects(runWithContextRepack({
      callSite: "query.answer",
      configuredInputBudget: 4_000,
      compressionProfile: "balanced",
      onContextError: opts.onContextError,
      build: () => ({ value: null, estimatedInputTokens: 10, contextUnits: 1 }),
      execute: () => {
        throw Object.assign(new Error("context length exceeded"), { code: "context_length_exceeded" });
      },
      onEvent: () => {},
    }));
  });

  await drain(instance.run(runRequest()));

  const record = store.get("http://host/v1", "global-model");
  assert.equal(record?.contextWindow, 131_072);
  assert.equal(record?.source, "discovered");
});

test("a configured context window skips the probe and drives every derived budget", async () => {
  const settings = nativeSettings();
  settings.nativeAgent.contextWindowTokensByModel = { "global-model": 131_072 };
  const calls: string[] = [];
  // The live symptom this setting exists for: /v1/models answers, lists the model,
  // and advertises no window anywhere. Probing it would cache 8192.
  const store = storeWith((async (input: string | URL | Request) => {
    calls.push(String(input));
    return json({ data: [{ id: "global-model", owned_by: "gateway" }] });
  }) as typeof fetch);
  const instance = runner(settings, store);
  const captured = captureOperation(instance);

  const events = await drain(instance.run(runRequest()));

  assert.deepEqual(calls, [], "a user-supplied window is authoritative: nothing is probed");
  assert.equal(events.some((event) => event.kind === "context_probe"), false);

  const resolved = events.find((event) => event.kind === "budget_resolved");
  assert.ok(resolved && resolved.kind === "budget_resolved");
  assert.equal(resolved.contextWindow, 131_072);
  assert.equal(resolved.inputSource, "configured", "the source names the setting, not a phantom probe");
  assert.equal(resolved.inputBudget, 110_592);
  assert.equal(resolved.outputBudget, 8_192);
  // The per-request output ceiling and the bootstrap split both read this.
  assert.equal(captured.opts?.contextWindowTokens, 131_072);
  assert.equal(captured.opts?.inputBudgetTokens, 110_592);
  assert.equal(captured.opts?.maxTokens, 8_192);
  assert.equal(captured.opts?.repairInputBudgetTokens, undefined, "query has no repair budget");
});

test("a context rejection against a configured window is reported, not learned", async () => {
  const settings = nativeSettings();
  settings.nativeAgent.contextWindowTokensByModel = { "global-model": 131_072 };
  const store = storeWith((async () => { throw new Error("must not probe"); }) as typeof fetch);
  const instance = runner(settings, store);
  captureOperation(instance, (opts) => {
    opts.onContextError?.({ promptTokens: 20_000, maxContextTokens: 8_192 });
  });

  const events = await drain(instance.run(runRequest()));

  const conflict = events.find((event) => event.kind === "context_window_conflict");
  assert.ok(conflict && conflict.kind === "context_window_conflict");
  assert.equal(conflict.model, "global-model");
  assert.equal(conflict.contextWindow, 131_072);
  assert.equal(conflict.reportedWindow, 8_192);
  const record = store.get("http://host/v1", "global-model");
  assert.equal(record?.contextWindow, 131_072);
  assert.equal(record?.source, "configured");
});

test("the bootstrap split of an init run follows the configured window", async () => {
  const settings = nativeSettings();
  settings.nativeAgent.contextWindowTokensByModel = { "global-model": 131_072 };
  const store = storeWith((async () => { throw new Error("must not probe"); }) as typeof fetch);
  const instance = runner(settings, store);
  const captured = captureOperation(instance);

  await drain(instance.run(runRequest("init")));

  assert.equal(captured.opts?.contextWindowTokens, 131_072);
  // init keeps a repair budget, clamped by the derived input budget.
  assert.equal(captured.opts?.repairInputBudgetTokens, 110_592);
});

test("a cache write failure does not fail the run", async () => {
  const store = new ModelContextStore({
    read: async () => ({}),
    write: async () => { throw new Error("disk full"); },
    fetchFn: modelsFetch(),
  });
  const instance = runner(nativeSettings(), store);
  const captured = captureOperation(instance);

  const events = await drain(instance.run(runRequest()));

  assert.equal(events.some((event) => event.kind === "error"), false);
  assert.equal(events.at(-1)?.kind, "result");
  assert.equal(captured.opts?.contextWindowTokens, 131_072);
});

test("the probe takes the route a non-streaming completion takes", async () => {
  const { createNativeProbeFetch } = await import("../src/native-openai-client");
  const hostCalls: string[] = [];
  const hostFetch = (async (input: string | URL | Request) => {
    hostCalls.push(String(input));
    return json({ data: [] });
  }) as typeof fetch;
  const probe = createNativeProbeFetch({
    baseURL: "http://host/v1",
    isMobile: false,
    proxyConfig: { enabled: false, url: "" },
    mobileFetch: hostFetch,
    connectionTimeoutMs: 15_000,
  });

  await probe("http://host/v1/models", { method: "GET" });
  await probe("http://host/api/show", { method: "POST", body: JSON.stringify({ model: "m1" }) });

  // Desktop without a proxy answers non-streaming requests through the Obsidian
  // host fetch; a probe that took the direct route instead could fail where the
  // completion succeeds and cache the 8_192 default off the back of it.
  assert.deepEqual(hostCalls, ["http://host/v1/models", "http://host/api/show"]);
});

test("the claude-agent path never consults the model context store", async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.backend = "claude-agent";
  const store = {
    get: () => { throw new Error("claude-agent must not read the store"); },
    resolve: async () => { throw new Error("claude-agent must not probe"); },
    observeUsage: () => { throw new Error("claude-agent must not calibrate"); },
    observeContextError: () => { throw new Error("claude-agent must not learn a window"); },
  } as unknown as ModelContextStore;
  const instance = runner(settings, store);
  const captured = captureOperation(instance);

  const events = await drain(instance.run(runRequest()));

  assert.equal(events.some((event) => event.kind === "budget_resolved"), false);
  assert.equal(events.some((event) => event.kind === "context_probe"), false);
  assert.equal(captured.opts?.inputBudgetTokens, 16_384);
  assert.equal(captured.opts?.contextWindowTokens, undefined);
  assert.equal(captured.opts?.onUsageObserved, undefined);
  assert.equal(captured.opts?.onContextError, undefined);
});

test("a run cancelled during the probe ends quietly and stores nothing", async () => {
  const controller = new AbortController();
  const written: Array<Record<string, unknown>> = [];
  const store = storeWith((async () => {
    controller.abort();
    return json({ data: [{ id: "global-model", context_length: 131_072 }] });
  }) as typeof fetch, written);
  const instance = runner(nativeSettings(), store);
  captureOperation(instance);

  const events = await drain(instance.run({ ...runRequest(), signal: controller.signal }));

  assert.deepEqual(events, []);
  assert.deepEqual(written, [], "an aborted run must not write a record");
});
