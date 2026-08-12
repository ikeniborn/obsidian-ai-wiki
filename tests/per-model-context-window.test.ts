import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  type LlmCallOptions,
  type LlmWikiPluginSettings,
  type RunEvent,
} from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import {
  configuredContextWindowFor,
  normalizePersistedModelControls,
  setConfiguredContextWindow,
} from "../src/model-call-policy";
import { batchPdfPages } from "../src/phases/vision-recognition";

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

const { AgentRunner, resolveVisionBudget } = await import("../src/agent-runner");
const { ModelContextStore } = await import("../src/model-context");
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
        { id: "vision-model", context_length: 65_536 },
      ],
    });
  }) as typeof fetch;
}

function storeWith(fetchFn: typeof fetch): ModelContextStore {
  return new ModelContextStore({
    read: async () => ({}),
    write: async () => {},
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

function captureOperation(
  instance: InstanceType<typeof AgentRunner>,
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

test("a configured window drives the model it was set for and leaves the others probing", async () => {
  const settings = nativeSettings();
  settings.nativeAgent.perOperation = true;
  settings.nativeAgent.operations.query = {
    ...settings.nativeAgent.operations.query,
    model: "per-op-model",
  };
  settings.nativeAgent.operations.init = {
    ...settings.nativeAgent.operations.init,
    model: "global-model",
  };
  // Init also builds an ingest runtime, so that model has to be configured too for
  // the run to touch the network not at all.
  settings.nativeAgent.operations.ingest = {
    ...settings.nativeAgent.operations.ingest,
    model: "global-model",
  };
  // One window, for one model. `per-op-model` must not inherit it.
  settings.nativeAgent.contextWindowTokensByModel = { "global-model": 16_384 };

  const calls: string[] = [];
  const store = storeWith(modelsFetch(calls));

  const queryRunner = runner(settings, store);
  captureOperation(queryRunner);
  const queryEvents = await drain(queryRunner.run(runRequest("query")));
  const queryBudget = queryEvents.find((event) => event.kind === "budget_resolved");
  assert.ok(queryBudget && queryBudget.kind === "budget_resolved");
  assert.equal(queryBudget.model, "per-op-model");
  assert.equal(queryBudget.contextWindow, 40_960, "the other model's window is probed, not inherited");
  assert.equal(queryBudget.inputSource, "discovered");
  assert.ok(calls.length > 0, "an unconfigured model is still probed");

  const initRunner = runner(settings, store);
  captureOperation(initRunner);
  const before = calls.length;
  const initEvents = await drain(initRunner.run(runRequest("init")));
  const initBudget = initEvents.find((event) => event.kind === "budget_resolved");
  assert.ok(initBudget && initBudget.kind === "budget_resolved");
  assert.equal(initBudget.model, "global-model");
  assert.equal(initBudget.contextWindow, 16_384, "the configured model uses its own window");
  assert.equal(initBudget.inputSource, "configured");
  assert.equal(calls.length, before, "a configured model is never probed");
});

test("clearing one model's window leaves every other model's window alone", () => {
  const na = structuredClone(DEFAULT_SETTINGS).nativeAgent;
  setConfiguredContextWindow(na, "model-a", 131_072);
  setConfiguredContextWindow(na, "model-b", 8_192);
  assert.equal(configuredContextWindowFor(na, "model-a"), 131_072);
  assert.equal(configuredContextWindowFor(na, "model-b"), 8_192);

  setConfiguredContextWindow(na, "model-a", undefined);
  assert.equal(configuredContextWindowFor(na, "model-a"), undefined, "cleared returns to automatic");
  assert.equal(configuredContextWindowFor(na, "model-b"), 8_192, "the other model is untouched");

  // The last entry going away takes the map with it, so a settings file that has
  // never used the feature stays exactly as it was.
  setConfiguredContextWindow(na, "model-b", undefined);
  assert.equal(na.contextWindowTokensByModel, undefined);
});

test("the legacy single window migrates onto every native chat model it used to cover", () => {
  const settings = nativeSettings();
  settings.nativeAgent.model = "global-model";
  settings.nativeAgent.operations.query.model = "per-op-model";
  settings.vision = { enabled: true, model: "vision-model" };
  (settings.nativeAgent as { contextWindowTokens?: number }).contextWindowTokens = 131_072;

  normalizePersistedModelControls(settings);

  assert.equal(
    (settings.nativeAgent as { contextWindowTokens?: number }).contextWindowTokens,
    undefined,
    "the legacy key is consumed, so the migration runs exactly once",
  );
  assert.equal(configuredContextWindowFor(settings.nativeAgent, "global-model"), 131_072);
  assert.equal(
    configuredContextWindowFor(settings.nativeAgent, "per-op-model"), 131_072,
    "the old setting applied to per-operation models too, so it must survive for them",
  );
  assert.equal(
    configuredContextWindowFor(settings.nativeAgent, "vision-model"), undefined,
    "vision never had a record of its own, so the old number was never its window",
  );

  // Idempotent: a second load must not resurrect anything.
  normalizePersistedModelControls(settings);
  assert.equal(configuredContextWindowFor(settings.nativeAgent, "global-model"), 131_072);

  // An explicit per-model entry always wins over the legacy number.
  const kept = nativeSettings();
  kept.nativeAgent.contextWindowTokensByModel = { "global-model": 40_960 };
  (kept.nativeAgent as { contextWindowTokens?: number }).contextWindowTokens = 131_072;
  normalizePersistedModelControls(kept);
  assert.equal(configuredContextWindowFor(kept.nativeAgent, "global-model"), 40_960);
});

test("a per-model window below the engine's floor is dropped, not displayed", () => {
  const settings = nativeSettings();
  settings.nativeAgent.contextWindowTokensByModel = {
    "global-model": 512,
    "per-op-model": 40_960,
    "": 131_072,
  };
  normalizePersistedModelControls(settings);
  assert.equal(configuredContextWindowFor(settings.nativeAgent, "global-model"), undefined);
  assert.equal(configuredContextWindowFor(settings.nativeAgent, "per-op-model"), 40_960);
  assert.equal(configuredContextWindowFor(settings.nativeAgent, ""), undefined);
});

test("vision resolves a record for its own model and budgets from that window", async () => {
  const settings = nativeSettings();
  settings.vision = { enabled: true, model: "vision-model" };
  const store = storeWith(modelsFetch());

  const resolved = await resolveVisionBudget(store, settings, "vision-model");

  assert.ok(resolved.budget, "vision must get a budget of its own");
  assert.equal(resolved.budget.contextWindow, 65_536, "the vision model's window, not the text model's");
  assert.equal(resolved.budget.outputBudgetTokens, 32_768);
  assert.equal(resolved.budget.inputBudgetTokens, 29_491);
  assert.equal(
    store.get("http://host/v1", "vision-model")?.contextWindow, 65_536,
    "the record is keyed by the vision model",
  );
  assert.ok(
    resolved.events.some((event) => event.kind === "context_probe" && event.model === "vision-model"),
    "the vision probe is reported like every other one",
  );
  assert.ok(
    resolved.events.some((event) => event.kind === "budget_resolved" && event.model === "vision-model"),
  );
});

test("a configured window for the vision model skips its probe too", async () => {
  const settings = nativeSettings();
  settings.vision = { enabled: true, model: "vision-model" };
  settings.nativeAgent.contextWindowTokensByModel = { "vision-model": 8_192 };
  const calls: string[] = [];
  const store = storeWith(modelsFetch(calls));

  const resolved = await resolveVisionBudget(store, settings, "vision-model");

  assert.deepEqual(calls, []);
  assert.equal(resolved.budget?.contextWindow, 8_192);
  assert.equal(resolved.budget?.inputSource, "configured");
});

test("PDF batches follow the vision model's window instead of the text model's", () => {
  // The same eight pages, sized once from a 131_072-token text budget and once from
  // the vision model's own 65_536-token window. The point of the fix: these differ.
  const pages = Array.from({ length: 8 }, (_, index) => ({
    pageId: `p${index + 1}`,
    dataUrl: "data:image/jpeg;base64,x",
  }));
  const fromTextModel = batchPdfPages(pages, {
    inputBudgetTokens: 88_473, // floor((131_072 - 32_768) * 0.9)
    fixedEstimatedTokens: 100,
    mediaReservationTokens: 4_096,
  });
  const fromVisionModel = batchPdfPages(pages, {
    inputBudgetTokens: 29_491, // floor((65_536 - 32_768) * 0.9)
    fixedEstimatedTokens: 100,
    mediaReservationTokens: 4_096,
  });
  assert.equal(fromTextModel.length, 1, "the text budget packs all eight pages into one call");
  assert.equal(fromVisionModel.length, 2, "the vision window splits them");
  assert.equal(fromVisionModel[0].length, 7);
});

test("vision gets no record of its own on the claude-agent path", async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.backend = "claude-agent";
  settings.vision = { enabled: true, model: "vision-model" };
  const store = {
    get: () => { throw new Error("claude-agent must not read the store"); },
    resolve: async () => { throw new Error("claude-agent must not probe"); },
  } as unknown as ModelContextStore;

  const resolved = await resolveVisionBudget(store, settings, "vision-model");

  assert.equal(resolved.budget, undefined);
  assert.deepEqual(resolved.events, []);
});

test("a backend that advertises no vision window leaves the caller's budget alone", async () => {
  // The regression this guards. A `default` record is the 8192-token fallback, not a
  // measurement: budgeting from it leaves floor((8192 - 4096) * 0.9) = 3686 input
  // tokens, while ONE image costs the ~4096-token media reservation plus the system
  // prompt — so `buildChatParams` would refuse every image, Excalidraw and PDF before
  // anything is sent. On a gateway that advertises no window for any model (exactly
  // the setup this feature exists for) that would turn working vision into no vision.
  const settings = nativeSettings();
  settings.vision = { enabled: true, model: "vision-model" };
  const store = storeWith((async () => json({ data: [{ id: "vision-model", owned_by: "gateway" }] })) as typeof fetch);

  const resolved = await resolveVisionBudget(store, settings, "vision-model");

  assert.equal(resolved.budget, undefined, "no budget: the caller's own budget stands");
  assert.equal(resolved.record?.source, "default");
  assert.equal(resolved.record?.contextWindow, 8_192);
  assert.equal(
    resolved.events.some((event) => event.kind === "budget_resolved"), false,
    "nothing was resolved, so nothing claims to have been",
  );
  // The probe is still reported: it is what established that no window is advertised.
  assert.ok(resolved.events.some((event) => event.kind === "context_probe"));
});

test("a learned vision window is still a real fact about the model and is used", async () => {
  const settings = nativeSettings();
  settings.vision = { enabled: true, model: "vision-model" };
  const store = new ModelContextStore({
    read: async () => ({
      "http://host/v1::vision-model": {
        contextWindow: 32_768, source: "learned" as const, calibration: 1, samples: 0,
      },
    }),
    write: async () => {},
    fetchFn: (async () => { throw new Error("must not probe"); }) as typeof fetch,
  });

  const resolved = await resolveVisionBudget(store, settings, "vision-model");
  assert.equal(resolved.budget?.contextWindow, 32_768);
  assert.equal(resolved.budget?.inputBudgetTokens, 14_745);
});

test("vision without a model of its own resolves nothing", async () => {
  const settings = nativeSettings();
  settings.vision = { enabled: false, model: "" };
  const store = {
    get: () => { throw new Error("must not read the store"); },
    resolve: async () => { throw new Error("must not probe"); },
  } as unknown as ModelContextStore;

  const resolved = await resolveVisionBudget(store, settings, "");
  assert.equal(resolved.budget, undefined);
  assert.deepEqual(resolved.events, []);
});
