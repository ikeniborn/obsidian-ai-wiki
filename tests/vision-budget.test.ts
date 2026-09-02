import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import {
  DEFAULT_SETTINGS,
  type CompressionProfile,
  type LlmClient,
  type LlmWikiPluginSettings,
  type RunEvent,
} from "../src/types";
import {
  estimatePreparedMessages,
  shrinkInputBudget,
} from "../src/prompt-budget";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import { stubModelContextStore } from "./model-context-stub";
import type { ModelContextRecord, ModelContextStore } from "../src/model-context";
import {
  batchPdfPages,
  mergeRecognitionRecords,
  validateRecognitionCoverage,
  type VisionMediaPage,
  type VisionRecognitionRecord,
} from "../src/phases/vision-recognition";

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

const {
  analyzeAttachments,
  analyzeExcalidraw,
  analyzeImage,
  analyzePdf,
  analyzeSingleAttachment,
} = await import("../src/phases/attachment-analyzer");
const { runFormat } = await import("../src/phases/format");
const { AgentRunner } = await import("../src/agent-runner");

(globalThis as unknown as {
  window: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}).window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

const record = (pageId: string): VisionRecognitionRecord => ({
  pageId,
  ocr: [`text ${pageId}`],
  objects: [`object ${pageId}`],
  relationships: [`relation ${pageId}`],
  layout: [`layout ${pageId}`],
  uncertainty: [`uncertain ${pageId}`],
});

function response(records: VisionRecognitionRecord[]): OpenAI.Chat.ChatCompletion {
  return {
    id: "vision",
    object: "chat.completion",
    created: 0,
    model: "vision-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({ records }),
        refusal: null,
      },
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  } as OpenAI.Chat.ChatCompletion;
}

function pageIdsFromParams(params: Record<string, unknown>): string[] {
  const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const user = messages.find((message) => message.role === "user");
  const content = Array.isArray(user?.content) ? user.content : [];
  const text = content
    .filter((part): part is OpenAI.Chat.ChatCompletionContentPartText => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return [...text.matchAll(/\b(?:p\d+|image|excalidraw)\b/g)].map((match) => match[0]);
}

function contextError(): Error & { code: string; status: number } {
  return Object.assign(
    new Error("prompt size 12000 tokens exceeds maximum context 10000"),
    { code: "context_length_exceeded", status: 400 },
  );
}

function noCountContextError(): Error & { code: string; status: number } {
  return Object.assign(
    new Error("context window exceeded"),
    { code: "context_length_exceeded", status: 400 },
  );
}

function hostileContextError(): Error & { code: string; status: number } {
  return Object.assign(
    new Error(
      "context window exceeded "
      + "Bearer AUTH_SECRET api_key=KEY_SECRET "
      + "prompt=SOURCE_SECRET "
      + "data:image/png;base64,RAW_MEDIA_SECRET "
      + "data:image\\/png;base64,JSON_MEDIA_SECRET",
    ),
    { code: "context_length_exceeded", status: 400 },
  );
}

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "format-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "format-model",
    choices: [],
    usage: { prompt_tokens: 77, completion_tokens: 11, total_tokens: 88 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function formatFrame(source: string, withVision: boolean): string {
  return [
    "<<<REPORT>>>",
    "formatted",
    "<<<FORMATTED>>>",
    source,
    ...(withVision
      ? ["<<<VISION_COUNT>>>", "1", "<<<EMBEDS>>>", "image.png"]
      : []),
    "<<<END>>>",
  ].join("\n");
}

function memoryVault(
  source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]",
  attachmentPath = "image.png",
): { adapter: VaultAdapter; vaultTools: VaultTools } {
  const files = new Map<string, string>([
    ["notes/source.md", source],
  ]);
  const adapter: VaultAdapter = {
    read: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT ${path}`);
      return value;
    },
    write: async (path, value) => { files.set(path, value); },
    append: async (path, value) => { files.set(path, `${files.get(path) ?? ""}${value}`); },
    list: async () => ({ files: [...files.keys()], folders: [] }),
    exists: async (path) => files.has(path) || path === "notes",
    mkdir: async () => {},
    readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
    resolveLink: (link) => link === attachmentPath ? attachmentPath : null,
  };
  return { adapter, vaultTools: new VaultTools(adapter, "/vault") };
}

function formatSettings(
  profile: CompressionProfile,
  perOperation: boolean,
): LlmWikiPluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.vision.enabled = true;
  settings.vision.model = "vision-model";
  settings.nativeAgent.model = "format-model";
  settings.nativeAgent.compressionProfile = perOperation ? "maximum" : profile;
  settings.nativeAgent.perOperation = perOperation;
  settings.nativeAgent.operations.format.compressionProfile =
    perOperation ? profile : undefined;
  settings.llmIdleTimeoutSec = 0;
  return settings;
}

test("PDF pages batch by fixed media reservation", () => {
  const batches = batchPdfPages(
    Array.from({ length: 7 }, (_, index) => ({
      pageId: `p${index + 1}`,
      dataUrl: `data:${index}`,
    })),
    {
      inputBudgetTokens: 10_000,
      fixedEstimatedTokens: 1000,
      mediaReservationTokens: 4096,
    },
  );
  assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 2, 1]);
  assert.deepEqual(batches.flat().map((page) => page.pageId), [
    "p1", "p2", "p3", "p4", "p5", "p6", "p7",
  ]);
});

test("record merge covers every page and governed field without compression profiles", () => {
  const records = [record("p1"), record("p2")];
  const merged = mergeRecognitionRecords(records);
  assert.doesNotMatch(merged, /semantic compression|maximum|balanced|minimum/i);
  for (const page of records) {
    assert.match(merged, new RegExp(page.pageId));
    for (const value of [
      ...page.ocr,
      ...page.objects,
      ...page.relationships,
      ...page.layout,
      ...page.uncertainty,
    ]) {
      assert.match(merged, new RegExp(value));
    }
  }
});

test("AgentRunner keeps Chat compression out of Vision analysis messages", async () => {
  const cases: Array<{
    profile: CompressionProfile;
    perOperation: boolean;
  }> = [
    { profile: "maximum", perOperation: false },
    { profile: "balanced", perOperation: true },
    { profile: "minimum", perOperation: true },
  ];
  const formatSystems: string[] = [];

  for (const item of cases) {
    const { vaultTools } = memoryVault();
    const seen: Record<string, unknown>[] = [];
    const llm = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            seen.push(params);
            if (params.stream === false) return response([record("image")]);
            return (async function* () {
              yield chunk(formatFrame(
                "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]",
                true,
              ));
              yield usageChunk();
            })();
          },
        },
      },
    } as unknown as LlmClient;
    const runner = new AgentRunner(
      llm,
      formatSettings(item.profile, item.perOperation),
      vaultTools,
      "Vault",
      [],
      undefined,
      false,
      stubModelContextStore(),
    );

    for await (const _event of runner.run({
      operation: "format",
      args: ["notes/source.md"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) {
      // Drain the real runtime path.
    }

    const visionParams = seen.find((params) => params.stream === false);
    const formatParams = seen.find((params) => params.stream === true);
    assert.ok(visionParams);
    assert.ok(formatParams);
    assert.doesNotMatch(JSON.stringify(visionParams.messages), /semantic compression/i);
    const formatSystem = (
      formatParams.messages as OpenAI.Chat.ChatCompletionMessageParam[]
    ).find((message) => message.role === "system")?.content;
    assert.equal(typeof formatSystem, "string");
    assert.doesNotMatch(String(formatSystem), /semantic compression/i);
    formatSystems.push(String(formatSystem));
  }

  assert.equal(new Set(formatSystems).size, 1);
});

/** A store that answers with a different record per model, and never probes. */
function perModelStore(records: Record<string, ModelContextRecord>): ModelContextStore {
  const store: Pick<ModelContextStore, "get" | "resolve" | "observeUsage" | "observeContextError"> = {
    get: (_baseUrl: string, model: string) => records[model],
    resolve: async (_baseUrl: string, model: string) => {
      const found = records[model];
      if (!found) throw new Error(`unexpected model resolved: ${model}`);
      return found;
    },
    observeUsage: () => ({ ratio: 1, applied: true, clamped: false }),
    observeContextError: () => ({ applied: false, reason: "unknown-model" }),
  };
  return store as ModelContextStore;
}

/** Drives the real `AgentRunner` -> `runFormat` path over one embedded image. */
async function runFormatThroughRunner(
  settings: LlmWikiPluginSettings,
  store: ModelContextStore,
): Promise<{ params: Record<string, unknown>[]; events: RunEvent[] }> {
  const { vaultTools } = memoryVault();
  const params: Record<string, unknown>[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (sent: Record<string, unknown>) => {
          params.push(sent);
          if (sent.stream === false) return response([record("image")]);
          return (async function* () {
            yield chunk(formatFrame(
              "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]",
              true,
            ));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
  const runner = new AgentRunner(
    llm, settings, vaultTools, "Vault", [], undefined, false, store,
  );
  const events: RunEvent[] = [];
  for await (const event of runner.run({
    operation: "format",
    args: ["notes/source.md"],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
  })) events.push(event);
  return { params, events };
}

const discoveredRecord = (contextWindow: number): ModelContextRecord =>
  ({ contextWindow, source: "discovered", calibration: 1, samples: 0 });

test("AgentRunner sizes the vision call from the vision window while an explicit Format cap still binds", async () => {
  const settings = formatSettings("balanced", false);
  // What a user sets to cap cost. It is not a window: it must survive the switch to
  // the vision model's own window, which is the only thing that changes here.
  settings.nativeAgent.maxTokens = 2_000;
  settings.nativeAgent.inputBudgetTokens = 5_000;

  const { params, events } = await runFormatThroughRunner(settings, perModelStore({
    "format-model": discoveredRecord(131_072),
    "vision-model": discoveredRecord(65_536),
  }));

  const vision = params.find((sent) => sent.stream === false);
  const format = params.find((sent) => sent.stream === true);
  assert.ok(vision && format);
  assert.equal(format.max_completion_tokens, 2_000, "the cap binds the operation itself");
  assert.equal(vision.max_completion_tokens, 2_000, "and the vision call it runs");

  const budget = events.find((event) =>
    event.kind === "budget_resolved" && event.model === "vision-model");
  assert.ok(budget && budget.kind === "budget_resolved");
  assert.equal(budget.contextWindow, 65_536, "the window is still the vision model's own");
  assert.equal(budget.outputBudget, 2_000);
  assert.equal(budget.inputBudget, 5_000);
  assert.equal(budget.inputSource, "override");
});

test("a vision call reports its usage to the observer it was given", async () => {
  // The vision model only ever learns from its own calls. Before this observer was
  // threaded through, `onUsageObserved` existed solely on the operation's chat
  // model, so a vision model's calibration stayed 1 for the life of the vault.
  const samples: Array<{ estimated: number; actual?: number; calibration: number }> = [];
  const llm = {
    chat: {
      completions: {
        create: async () => response([{
          pageId: "image",
          ocr: ["Gateway"],
          objects: ["diagram node labeled Gateway"],
          relationships: ["Gateway routes to API"],
          layout: ["Gateway is left of API"],
          uncertainty: [],
        }]),
      },
    },
  } as unknown as LlmClient;

  await analyzeImage(
    new Uint8Array([1, 2, 3]).buffer,
    "image/png",
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      maxTokens: 321,
      tokenCalibration: 1.25,
      onUsageObserved: (sample) => samples.push(sample),
    },
  );

  assert.equal(samples.length, 1, "the vision call must report exactly one usage sample");
  // The provider's own prompt_tokens from `response`, not an estimate of it.
  assert.equal(samples[0].actual, 123);
  assert.ok(samples[0].estimated > 0);
  // The factor that sized THIS request, so the correction is valid against it.
  assert.equal(samples[0].calibration, 1.25);
});

test("a vision context rejection is reported, not only recovered in the run", async () => {
  // A single image has no smaller shape to fall back to, so the rejection is
  // terminal here. What matters is that it is still recorded on the way out: before
  // this, the window the provider refused was known only inside the failed call.
  const rejections: Array<{ maxContextTokens?: number }> = [];
  const llm = {
    chat: {
      completions: { create: async () => { throw contextError(); } },
    },
  } as unknown as LlmClient;

  await assert.rejects(() => analyzeImage(
    new Uint8Array([1, 2, 3]).buffer,
    "image/png",
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      maxTokens: 321,
      onContextError: (details) => rejections.push(details),
    },
  ));

  assert.equal(rejections.length, 1, "the rejection must reach the store, not only the caller");
  assert.equal(rejections[0].maxContextTokens, 10_000, "with the window the provider named");
});

test("AgentRunner leaves vision on the Format budget when only the 8192 fallback is known", async () => {
  const settings = formatSettings("balanced", false);

  const { params, events } = await runFormatThroughRunner(settings, perModelStore({
    "format-model": discoveredRecord(131_072),
    // What a gateway that advertises no window produces for the vision model.
    "vision-model": {
      contextWindow: 8_192, source: "default", calibration: 1, samples: 0,
      expiresAt: Date.now() + 86_400_000,
    },
  }));

  const vision = params.find((sent) => sent.stream === false);
  assert.ok(vision);
  // Format's own output budget: min(8192 * 4, 131_072 / 2). Budgeting from the
  // fallback instead would cap the reply at 4096 and the prompt at 3686 — less than
  // one image costs.
  assert.equal(vision.max_completion_tokens, 32_768);
  assert.ok(
    !events.some((event) => event.kind === "budget_resolved" && event.model === "vision-model"),
    "the fallback is not a measurement of the vision model, so no budget is derived from it",
  );
});

test("recognition coverage rejects missing pages, duplicate pages, and missing fields", () => {
  assert.throws(
    () => validateRecognitionCoverage([record("p1")], ["p1", "p2"]),
    /missing.*p2/i,
  );
  assert.throws(
    () => validateRecognitionCoverage([record("p1"), record("p1")], ["p1"]),
    /duplicate.*p1/i,
  );
  assert.throws(
    () => validateRecognitionCoverage(
      [{ ...record("p1"), layout: undefined } as unknown as VisionRecognitionRecord],
      ["p1"],
    ),
    /layout/i,
  );
});

test("native raster Vision uses bounded prepared structured messages and rejects an incomplete record", async () => {
  const seen: Record<string, unknown>[] = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return response([{
            pageId: "image",
            ocr: ["visible text"],
            objects: ["box"],
            relationships: ["box contains text"],
            layout: [],
            uncertainty: undefined,
          } as unknown as VisionRecognitionRecord]);
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzeImage(
      new Uint8Array([1, 2, 3]).buffer,
      "image/png",
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      {
        inputBudgetTokens: 20_000,
        maxTokens: 321,
        onEvent: (event) => events.push(event),
      },
    ),
    /uncertainty/i,
  );

  assert.equal(seen.length, 2);
  assert.equal(seen[0].stream, false);
  assert.equal(seen[0].max_completion_tokens, 321);
  assert.ok(seen[0].response_format);
  assert.ok(
    estimatePreparedMessages(
      seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[],
    ) <= 20_000,
  );
  assert.doesNotMatch(JSON.stringify(seen[0].messages), /semantic compression/i);
  const budgetEvent = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budgetEvent);
  if (budgetEvent?.kind === "prompt_budget") {
    assert.equal(budgetEvent.callSite, "vision.analysis");
    assert.equal(budgetEvent.outputBudget, 321);
    assert.equal(Object.hasOwn(budgetEvent, "compressionProfile"), false);
    assert.equal(budgetEvent.actualInputTokens, 123);
  }
  assert.doesNotMatch(JSON.stringify(events), /AQID|visible text|box contains text/);
});

test("Vision retries object-valued recognition fields without lossy string coercion", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          if (seen.length === 1) {
            return response([{
              pageId: "image",
              ocr: ["Gateway"],
              objects: [{ type: "diagram node", label: "Gateway" }],
              relationships: [{ source: "Gateway", target: "API", kind: "routes to" }],
              layout: ["Gateway is left of API"],
              uncertainty: [],
            } as unknown as VisionRecognitionRecord]);
          }
          return response([{
            pageId: "image",
            ocr: ["Gateway"],
            objects: ["diagram node labeled Gateway"],
            relationships: ["Gateway routes to API"],
            layout: ["Gateway is left of API"],
            uncertainty: [],
          }]);
        },
      },
    },
  } as unknown as LlmClient;

  const description = await analyzeImage(
    new Uint8Array([1, 2, 3]).buffer,
    "image/png",
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
  );

  assert.equal(seen.length, 2);
  const retryMessages = seen[1].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  assert.match(JSON.stringify(retryMessages), /objects.*relationships.*strings.*never objects/i);
  assert.match(description, /diagram node labeled Gateway/);
  assert.match(description, /Gateway routes to API/);
  assert.doesNotMatch(description, /\[object Object\]/);
});

test("seven PDF pages stay bounded, retain every record, and resize only the failing page once", async () => {
  const seen: Record<string, unknown>[] = [];
  const renderCalls: Array<{ pageId: string; scale: number; quality: number }> = [];
  const events: RunEvent[] = [];
  let p3SingletonFailures = 0;

  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          const ids = pageIdsFromParams(params);
          if (ids.includes("p3") && ids.length > 1) throw contextError();
          if (ids.length === 1 && ids[0] === "p3" && p3SingletonFailures++ === 0) {
            throw contextError();
          }
          return response(ids.map(record));
        },
      },
    },
  } as unknown as LlmClient;

  const description = await analyzePdf(
    new ArrayBuffer(0),
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 10_000,
      maxTokens: 222,
      onEvent: (event) => events.push(event),
    },
    {
      loadPdf: async () => ({
        numPages: 7,
        renderPage: async (pageNumber, options): Promise<VisionMediaPage> => {
          const pageId = `p${pageNumber}`;
          renderCalls.push({ pageId, ...options });
          return {
            pageId,
            dataUrl: `data:image/jpeg;base64,${pageId}-${options.scale}-${options.quality}`,
          };
        },
      }),
    },
  );

  for (let pageNumber = 1; pageNumber <= 7; pageNumber++) {
    const page = record(`p${pageNumber}`);
    assert.equal(description.match(new RegExp(page.pageId, "g"))?.length, 6);
    for (const value of [
      ...page.ocr,
      ...page.objects,
      ...page.relationships,
      ...page.layout,
      ...page.uncertainty,
    ]) {
      assert.match(description, new RegExp(value));
    }
  }
  assert.deepEqual(
    renderCalls.filter((call) => call.pageId === "p3").map(({ scale, quality }) => ({ scale, quality })),
    [
      { scale: 1.5, quality: 0.85 },
      { scale: 1, quality: 0.65 },
    ],
  );
  assert.ok(renderCalls.filter((call) => call.pageId !== "p3").every((call) =>
    call.scale === 1.5 && call.quality === 0.85));
  assert.ok(seen.every((params) =>
    estimatePreparedMessages(
      params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
    ) <= 10_000));
  assert.ok(seen.every((params) => params.max_completion_tokens === 222));
  assert.ok(seen.every((params) => !/semantic compression/i.test(JSON.stringify(params.messages))));
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget"
    && event.callSite === "vision.analysis"
    && event.retryReason === "provider_context_error"));
});

test("provider-count PDF recovery shrinks the effective budget and deterministically repacks", async () => {
  const seen: Array<{ ids: string[]; estimate: number }> = [];
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          const ids = pageIdsFromParams(params);
          seen.push({
            ids,
            estimate: estimatePreparedMessages(
              params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
            ),
          });
          if (calls++ === 0) throw contextError();
          return response(ids.map(record));
        },
      },
    },
  } as unknown as LlmClient;

  const description = await analyzePdf(
    new ArrayBuffer(0),
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      onEvent: (event) => events.push(event),
    },
    {
      loadPdf: async () => ({
        numPages: 4,
        renderPage: async (pageNumber, options) => ({
          pageId: `p${pageNumber}`,
          dataUrl: `data:image/jpeg;base64,p${pageNumber}-${options.scale}`,
        }),
      }),
    },
  );

  const expectedShrunk = shrinkInputBudget(20_000, {
    promptTokens: 12_000,
    maxContextTokens: 10_000,
  });
  assert.equal(seen[0].ids.length, 4);
  assert.ok(seen.slice(1).every((call) => call.ids.length < seen[0].ids.length));
  assert.ok(seen.slice(1).every((call) => call.estimate <= expectedShrunk));
  assert.equal(seen.length, 3);
  assert.match(description, /Page p4/);
  const budgetEvents = events.filter((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  assert.deepEqual(
    budgetEvents.map((event) =>
      event.kind === "prompt_budget" ? event.effectiveInputBudget : -1),
    [20_000, expectedShrunk, expectedShrunk],
  );
});

test("no-count singleton recovery uses 75 percent budget and one lower render", async () => {
  const events: RunEvent[] = [];
  const renders: Array<{ scale: number; quality: number }> = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          calls += 1;
          if (calls === 1) throw noCountContextError();
          return response(pageIdsFromParams(params).map(record));
        },
      },
    },
  } as unknown as LlmClient;

  await analyzePdf(
    new ArrayBuffer(0),
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 12_000,
      onEvent: (event) => events.push(event),
    },
    {
      loadPdf: async () => ({
        numPages: 1,
        renderPage: async (_pageNumber, options) => {
          renders.push(options);
          return { pageId: "p1", dataUrl: `data:image/jpeg;base64,${options.scale}` };
        },
      }),
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(renders, [
    { scale: 1.5, quality: 0.85 },
    { scale: 1, quality: 0.65 },
  ]);
  const budgets = events
    .filter((event) => event.kind === "prompt_budget")
    .map((event) => event.kind === "prompt_budget" ? event.effectiveInputBudget : -1);
  assert.deepEqual(budgets, [12_000, 9_000]);
});

test("a second context failure after one lower-quality render returns no PDF description", async () => {
  const renderCalls: Array<{ scale: number; quality: number }> = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          throw contextError();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      {
        inputBudgetTokens: 10_000,
        maxTokens: 222,
      },
      {
        loadPdf: async () => ({
          numPages: 1,
          renderPage: async (_pageNumber, options): Promise<VisionMediaPage> => {
            renderCalls.push(options);
            return { pageId: "p1", dataUrl: `data:image/jpeg;base64,${options.scale}` };
          },
        }),
      },
    ),
    /vision\.analysis.*configuredInputBudget=10000.*finalEffectiveInputBudget=7500.*provider context limit.*promptTokens=12000.*maxContextTokens=10000/i,
  );

  assert.deepEqual(renderCalls, [
    { scale: 1.5, quality: 0.85 },
    { scale: 1, quality: 0.65 },
  ]);
  assert.ok(calls <= 3);
});

test("PDF context recovery exhausts bounded repacks with unique dispatched requests", async () => {
  const seen: Array<{ signature: string; estimate: number }> = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          const ids = pageIdsFromParams(params);
          const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
          seen.push({
            signature: ids.join(","),
            estimate: estimatePreparedMessages(messages),
          });
          throw contextError();
        },
      },
    },
  } as unknown as LlmClient;

  // Rescaled from a byte-era configured budget of 20_000 for the token
  // estimator (task-3 prompt-budget-automation): the fixed system-prompt
  // overhead now costs fewer estimated tokens, so 20_000 left enough room
  // for a third dispatch after two shrinks. 12_000 keeps the same two-
  // dispatch-then-preflight-exhausted shape (12_000 -> 6_750 shrunk budget,
  // both from shrinkInputBudget's fixed 12000/10000 ratio in the mocked
  // provider error, unrelated to content size).
  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      {
        inputBudgetTokens: 12_000,
        onEvent: (event) => events.push(event),
      },
      {
        loadPdf: async () => ({
          numPages: 4,
          renderPage: async (pageNumber, options) => ({
            pageId: `p${pageNumber}`,
            dataUrl: `data:image/jpeg;base64,p${pageNumber}-${options.scale}`,
          }),
        }),
      },
    ),
    /vision\.analysis.*configuredInputBudget=12000.*finalEffectiveInputBudget=6750.*provider context limit.*promptTokens=12000.*maxContextTokens=10000/i,
  );

  const budgets = events
    .filter((event) => event.kind === "prompt_budget")
    .map((event) => event.kind === "prompt_budget" ? event.effectiveInputBudget : -1);
  assert.equal(seen.length, 2);
  assert.equal(new Set(seen.map((call) => call.signature)).size, 2);
  assert.deepEqual(budgets, [12_000, 6_750]);
  assert.ok(seen.every((call, index) =>
    call.estimate <= budgets[index]));
});

test("PDF context exhaustion never echoes hostile provider prompt, auth, or media content", async () => {
  const llm = {
    chat: {
      completions: {
        create: async () => {
          throw hostileContextError();
        },
      },
    },
  } as unknown as LlmClient;
  let message = "";

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      { inputBudgetTokens: 12_000 },
      {
        loadPdf: async () => ({
          numPages: 1,
          renderPage: async (_pageNumber, options) => ({
            pageId: "p1",
            dataUrl: `data:image/jpeg;base64,${options.scale}`,
          }),
        }),
      },
    ),
    (error) => {
      message = (error as Error).message;
      return /vision\.analysis.*configuredInputBudget=12000.*finalEffectiveInputBudget=9000.*provider context limit/i.test(message);
    },
  );

  assert.doesNotMatch(
    message,
    /AUTH_SECRET|KEY_SECRET|SOURCE_SECRET|RAW_MEDIA_SECRET|JSON_MEDIA_SECRET|Bearer|api_key|data:image|data:image\\\/png/i,
  );
});

test("PDF reservation preflight failure emits no request telemetry before transport", async () => {
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return response([record("p1")]);
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      {
        inputBudgetTokens: 100,
        onEvent: (event) => events.push(event),
      },
      {
        loadPdf: async () => ({
          numPages: 1,
          renderPage: async () => ({
            pageId: "p1",
            dataUrl: "data:image/jpeg;base64,p1",
          }),
        }),
      },
    ),
    /budget/i,
  );

  assert.equal(calls, 0);
  assert.equal(events.some((event) => event.kind === "prompt_budget"), false);
  assert.equal(events.some((event) => event.kind === "llm_lifecycle"), false);
});

test("attachment collection never silently drops a failed attachment", async () => {
  const providerFailure = new Error("vision provider unavailable");
  const llm = {
    chat: {
      completions: {
        create: async () => {
          throw providerFailure;
        },
      },
    },
  } as unknown as LlmClient;
  const vaultTools = {
    resolveLink: () => "image.png",
    readBinary: async () => new Uint8Array([1]).buffer,
  };

  await assert.rejects(
    analyzeAttachments(
      ["image.png"],
      vaultTools as never,
      llm,
      "vision-model",
      new AbortController().signal,
    ),
    providerFailure,
  );
});

test("PDF abort before load performs no render or transport", async () => {
  const controller = new AbortController();
  controller.abort();
  let loads = 0;
  let calls = 0;
  const llm = {
    chat: { completions: { create: async () => {
      calls += 1;
      return response([record("p1")]);
    } } },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      controller.signal,
      "en",
      "en",
      undefined,
      {
        loadPdf: async () => {
          loads += 1;
          return {
            numPages: 1,
            renderPage: async () => ({ pageId: "p1", dataUrl: "data:p1" }),
          };
        },
      },
    ),
    (error: unknown) => (error as Error).name === "AbortError",
  );
  assert.equal(loads, 0);
  assert.equal(calls, 0);
});

test("PDF abort after load or render stops all remaining work with no description", async () => {
  for (const abortAt of ["load", "render"] as const) {
    const controller = new AbortController();
    let renders = 0;
    let calls = 0;
    const llm = {
      chat: { completions: { create: async () => {
        calls += 1;
        return response([record("p1")]);
      } } },
    } as unknown as LlmClient;

    await assert.rejects(
      analyzePdf(
        new ArrayBuffer(0),
        llm,
        "vision-model",
        controller.signal,
        "en",
        "en",
        undefined,
        {
          loadPdf: async () => {
            if (abortAt === "load") controller.abort();
            return {
              numPages: 3,
              renderPage: async (pageNumber) => {
                renders += 1;
                if (abortAt === "render") controller.abort();
                return { pageId: `p${pageNumber}`, dataUrl: `data:p${pageNumber}` };
              },
            };
          },
        },
      ),
      (error: unknown) => (error as Error).name === "AbortError",
    );
    assert.equal(renders, abortAt === "load" ? 0 : 1);
    assert.equal(calls, 0);
  }
});

test("PDF abort after a batch response prevents every remaining request and description", async () => {
  const controller = new AbortController();
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          calls += 1;
          controller.abort();
          return response(pageIdsFromParams(params).map(record));
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      controller.signal,
      "en",
      "en",
      {
        inputBudgetTokens: 10_000,
        onEvent: (event) => events.push(event),
      },
      {
        loadPdf: async () => ({
          numPages: 3,
          renderPage: async (pageNumber) => ({
            pageId: `p${pageNumber}`,
            dataUrl: `data:p${pageNumber}`,
          }),
        }),
      },
    ),
    (error: unknown) => (error as Error).name === "AbortError",
  );
  assert.equal(calls, 1);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  const budgets = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0].actualInputTokens, 123);
  assert.equal(
    lifecycle.find((event) => event.phase === "cancelled")?.id,
    budgets[0].requestId,
  );
  assert.ok(lifecycle.every((event) =>
    event.diagnostics?.callSite === "vision.analysis"
    && event.diagnostics.transport === "non-stream"
    && event.diagnostics.attempt === 0));
});

test("PDF abort during lower render prevents the resize transport retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  let renders = 0;
  const llm = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          throw noCountContextError();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      controller.signal,
      "en",
      "en",
      { inputBudgetTokens: 12_000 },
      {
        loadPdf: async () => ({
          numPages: 1,
          renderPage: async (_pageNumber, options) => {
            renders += 1;
            if (options.scale === 1) controller.abort();
            return { pageId: "p1", dataUrl: `data:${options.scale}` };
          },
        }),
      },
    ),
    (error: unknown) => (error as Error).name === "AbortError",
  );
  assert.equal(renders, 2);
  assert.equal(calls, 1);
});

test("analyzeAttachments forwards bounded Vision options to every native call", async () => {
  const seen: Record<string, unknown>[] = [];
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return response([record("image")]);
        },
      },
    },
  } as unknown as LlmClient;
  const vaultTools = {
    resolveLink: () => "image.png",
    readBinary: async () => new Uint8Array([1]).buffer,
  };

  await analyzeAttachments(
    ["image.png"],
    vaultTools as never,
    llm,
    "vision-model",
    new AbortController().signal,
    "",
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      maxTokens: 456,
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(seen[0].max_completion_tokens, 456);
  assert.equal(seen[0].stream, false);
  assert.doesNotMatch(JSON.stringify(seen[0].messages), /semantic compression/i);
  assert.equal(events.some((event) => event.kind === "prompt_budget"), true);
  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? [event.action, event.phase] : []),
    [
      ["analyze_attachments", "preparing"],
      ["analyze_attachments", "sent"],
      ["analyze_attachments", "waiting"],
      ["analyze_attachments", "producing"],
      ["analyze_attachments", "validating"],
      ["analyze_attachments", "applying"],
      ["analyze_attachments", "completed"],
    ],
  );
});

test("Vision synchronous invocation failure emits waiting before failed", async () => {
  const events: RunEvent[] = [];
  const error = new Error("vision sync create failed");
  const llm = {
    chat: {
      completions: {
        create: () => {
          throw error;
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(analyzeAttachments(
    ["image.png"],
    {
      resolveLink: () => "image.png",
      readBinary: async () => new Uint8Array([1]).buffer,
    } as never,
    llm,
    "vision-model",
    new AbortController().signal,
    "",
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      onEvent: (event) => events.push(event),
    },
  ), error);

  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? event.phase : ""),
    ["preparing", "sent", "waiting", "failed"],
  );
});

test("Excalidraw uses one media unit and output cap without compression prompt", async () => {
  const seen: Record<string, unknown>[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seen.push(params);
          return response([record("excalidraw")]);
        },
      },
    },
  } as unknown as LlmClient;

  await analyzeExcalidraw(
    "png-payload",
    llm,
    "vision-model",
    new AbortController().signal,
    "en",
    "en",
    {
      inputBudgetTokens: 20_000,
      maxTokens: 654,
    },
  );

  const messages = seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const mediaParts = messages.flatMap((message): { type: string }[] =>
    Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === "image_url");
  assert.equal(mediaParts.length, 1);
  assert.equal(seen[0].max_completion_tokens, 654);
  assert.doesNotMatch(JSON.stringify(messages), /semantic compression/i);
});

test("mobile mode skips PDF and Excalidraw before reads, renders, or calls", async () => {
  for (const path of ["document.pdf", "diagram.excalidraw"] as const) {
    let reads = 0;
    let renders = 0;
    let calls = 0;
    const vaultTools = {
      resolveLink: () => path,
      readBinary: async () => {
        reads += 1;
        return new ArrayBuffer(0);
      },
      renderExcalidrawPng: async () => {
        renders += 1;
        return "png";
      },
    };
    const llm = {
      chat: { completions: { create: async () => {
        calls += 1;
        return response([]);
      } } },
    } as unknown as LlmClient;

    const result = await analyzeSingleAttachment(
      path,
      vaultTools as never,
      llm,
      "vision-model",
      new AbortController().signal,
      "",
      "en",
      "en",
      undefined,
      true,
    );
    assert.equal(result, null);
    assert.equal(reads, 0);
    assert.equal(renders, 0);
    assert.equal(calls, 0);
  }
});

test("Format propagates Vision budget telemetry and a visible warning on attachment failure", async () => {
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]";
  const { vaultTools } = memoryVault(source);
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          calls += 1;
          if (params.stream === false) throw noCountContextError();
          return (async function* () {
            yield chunk(formatFrame(source, false));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 20_000, maxTokens: 777 },
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
    },
  )) {
    events.push(event);
  }

  assert.equal(calls, 2);
  const budgetIndex = events.findIndex((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  const warningIndex = events.findIndex((event) =>
    event.kind === "info_text" && event.summary === "Vision skipped");
  assert.ok(budgetIndex >= 0);
  assert.ok(warningIndex > budgetIndex);
});

test("Vision sizes its own call from the vision model's budget, not the text model's", async () => {
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]";
  const { vaultTools } = memoryVault(source);
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          if (params.stream === false) return response([record("image")]);
          return (async function* () {
            yield chunk(formatFrame(source, false));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    // The text model's budget: what vision used to be sized from.
    { inputBudgetTokens: 88_473, maxTokens: 32_768 },
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
      // The vision model's own record, resolved for `vision.model`.
      inputBudgetTokens: 29_491,
      maxTokens: 4_096,
      tokenCalibration: 2,
    },
  )) {
    events.push(event);
  }

  const vision = events.find((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  assert.ok(vision && vision.kind === "prompt_budget");
  assert.equal(vision.configuredInputBudget, 29_491, "vision packs against its own window");
  assert.equal(vision.outputBudget, 4_096, "and answers within its own output budget");

  // The calibration the vision record carries is applied to the vision estimate:
  // the same messages estimated at factor 1 are half the reported number.
  const uncalibrated: RunEvent[] = [];
  for await (const event of runFormat(
    ["notes/source.md"],
    memoryVault(source).vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 88_473, maxTokens: 32_768 },
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
      inputBudgetTokens: 29_491,
      maxTokens: 4_096,
      tokenCalibration: 1,
    },
  )) {
    uncalibrated.push(event);
  }
  const plain = uncalibrated.find((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  assert.ok(plain && plain.kind === "prompt_budget");
  assert.equal(
    vision.estimatedInputTokens, plain.estimatedInputTokens * 2,
    "the vision call estimate carries the vision model's calibration factor",
  );
});

test("Vision falls back to the caller's budget when no vision budget is supplied", async () => {
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]";
  const { vaultTools } = memoryVault(source);
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          if (params.stream === false) return response([record("image")]);
          return (async function* () {
            yield chunk(formatFrame(source, false));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 20_000, maxTokens: 777 },
    undefined,
    3,
    { enabled: true, model: "vision-model", language: "en" },
  )) {
    events.push(event);
  }

  const vision = events.find((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  assert.ok(vision && vision.kind === "prompt_budget");
  assert.equal(vision.configuredInputBudget, 20_000);
  assert.equal(vision.outputBudget, 777);
});

test("Vision keeps working on a backend that advertises no window for the vision model", async () => {
  // The live configuration this whole feature exists for: an aggregating gateway that
  // reports no context length for anything. The chat model's window is the user's own
  // 131072, so Format's budget is 88473/32768 — and vision must go on being sized from
  // it, because the 8192-token fallback is not a measurement of the vision model.
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]";
  const { vaultTools } = memoryVault(source);
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          if (params.stream === false) return response([record("image")]);
          return (async function* () {
            yield chunk(formatFrame(source, false));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 88_473, maxTokens: 32_768 },
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
      // Resolved, reported, and deliberately NOT turned into a budget.
      contextWindow: 8_192,
      contextWindowSource: "default",
    },
  )) {
    events.push(event);
  }

  const vision = events.find((event) =>
    event.kind === "prompt_budget" && event.callSite === "vision.analysis");
  assert.ok(vision && vision.kind === "prompt_budget");
  assert.equal(vision.configuredInputBudget, 88_473, "the operation's budget still sizes vision");
  assert.equal(
    events.some((event) => event.kind === "info_text" && event.summary === "Vision skipped"),
    false,
    "an unadvertised vision window must not disable vision",
  );
  assert.ok(events.some((event) => event.kind === "tool_result" && event.ok === true));
});

test("a Vision size refusal names the model, its window and where to change it", async () => {
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[image.png]]";
  const { vaultTools } = memoryVault(source);
  const events: RunEvent[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          if (params.stream === false) throw new Error("vision must be refused before dispatch");
          return (async function* () {
            yield chunk(formatFrame(source, false));
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;

  for await (const event of runFormat(
    ["notes/source.md"],
    vaultTools,
    llm,
    "format-model",
    false,
    [],
    new AbortController().signal,
    { inputBudgetTokens: 88_473, maxTokens: 32_768 },
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
      // A real 8192-token vision window: budgeted from, and too small for one image.
      inputBudgetTokens: 3_686,
      maxTokens: 4_096,
      contextWindow: 8_192,
      contextWindowSource: "discovered",
    },
  )) {
    events.push(event);
  }

  const skipped = events.find((event) =>
    event.kind === "info_text" && event.summary === "Vision skipped");
  assert.ok(skipped && skipped.kind === "info_text");
  const detail = (skipped.details ?? []).join("\n");
  assert.match(detail, /vision-model/, "names the vision model");
  assert.match(detail, /8192-token context window/, "names the window it was measured against");
  assert.match(detail, /reported by the backend/, "says where that number came from");
  assert.match(detail, /Settings → Vision → Model context window/, "says where to change it");
});

test("visionSizeSkipReason explains only size failures, and only when a window is known", async () => {
  const { visionSizeSkipReason } = await import("../src/phases/format");
  const { PromptBudgetExceededError } = await import("../src/prompt-budget");
  const tooBig = new PromptBudgetExceededError(3_686, 4_694, ["image"]);

  // A provider/network failure is not a budget problem and must not blame the window.
  assert.equal(
    visionSizeSkipReason(new Error("fetch failed"), {
      model: "vision-model", contextWindow: 8_192, contextWindowSource: "discovered",
    }),
    null,
  );
  // Without a known vision record there is no context-window field to point at.
  assert.equal(visionSizeSkipReason(tooBig, { model: "vision-model" }), null);

  // A configured window is the user's own instruction, so the advice is to change it.
  const configured = visionSizeSkipReason(tooBig, {
    model: "vision-model", contextWindow: 8_192, contextWindowSource: "configured",
  });
  assert.match(configured ?? "", /you set this window/);
  assert.match(configured ?? "", /Raise or clear/);

  // A fallback window was never budgeted from, so the message must not claim it was.
  const fallback = visionSizeSkipReason(tooBig, {
    model: "vision-model", contextWindow: 8_192, contextWindowSource: "default",
  });
  assert.match(fallback ?? "", /advertises no context window/);
  assert.match(fallback ?? "", /sized from the Format operation's own budget/);
  assert.doesNotMatch(fallback ?? "", /8192-token context window/);

  // The PDF recovery path fails with a plain Error, and is a size failure too.
  const exhausted = new Error(
    "vision.analysis context recovery exhausted (configuredInputBudget=3686, "
    + "finalEffectiveInputBudget=2000): provider context limit (promptTokens=9000)",
  );
  assert.match(
    visionSizeSkipReason(exhausted, {
      model: "vision-model", contextWindow: 8_192, contextWindowSource: "learned",
    }) ?? "",
    /learned from a provider rejection/,
  );
});

test("browser PDF renderer exercises pdfjs and canvas boundaries and reports a missing API", async () => {
  const calls = { getPage: 0, viewport: 0, render: 0, blob: 0 };
  const browser = globalThis as unknown as {
    OffscreenCanvas?: typeof OffscreenCanvas;
    window: typeof window & { pdfjsLib?: unknown };
  };
  const originallyHadPdfjs = Object.hasOwn(browser.window, "pdfjsLib");
  const originalPdfjs = browser.window.pdfjsLib;
  const sentinelPdfjs = { sentinel: "browser-smoke" };
  browser.window.pdfjsLib = sentinelPdfjs;
  const hadPdfjs = Object.hasOwn(browser.window, "pdfjsLib");
  const previousPdfjs = browser.window.pdfjsLib;
  const originallyHadCanvas = Object.hasOwn(globalThis, "OffscreenCanvas");
  const originalCanvas = browser.OffscreenCanvas;
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  const hadCanvas = Object.hasOwn(globalThis, "OffscreenCanvas");
  const previousCanvas = browser.OffscreenCanvas;
  browser.window.pdfjsLib = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => {
          calls.getPage += 1;
          return {
            getViewport: ({ scale }: { scale: number }) => {
              calls.viewport += 1;
              return { width: 10 * scale, height: 20 * scale };
            },
            render: () => {
              calls.render += 1;
              return { promise: Promise.resolve() };
            },
          };
        },
      }),
    }),
  };
  browser.OffscreenCanvas = class {
    constructor(_width: number, _height: number) {}
    getContext() { return {}; }
    async convertToBlob() {
      calls.blob += 1;
      return {
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Blob;
    }
  } as unknown as typeof OffscreenCanvas;

  try {
    const llm = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) =>
            response(pageIdsFromParams(params).map(record)),
        },
      },
    } as unknown as LlmClient;
    const description = await analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      { inputBudgetTokens: 10_000 },
    );
    assert.match(description, /Page p1/);
    assert.deepEqual(calls, { getPage: 1, viewport: 1, render: 1, blob: 1 });

    delete browser.window.pdfjsLib;
    await assert.rejects(
      analyzePdf(
        new ArrayBuffer(0),
        llm,
        "vision-model",
        new AbortController().signal,
      ),
      /pdfjsLib unavailable/,
    );
  } finally {
    try {
      if (hadPdfjs) browser.window.pdfjsLib = previousPdfjs;
      else delete browser.window.pdfjsLib;
      if (hadCanvas) browser.OffscreenCanvas = previousCanvas;
      else delete browser.OffscreenCanvas;
      assert.equal(hadPdfjs, true);
      assert.equal(previousPdfjs, sentinelPdfjs);
      assert.equal(browser.window.pdfjsLib, sentinelPdfjs);
      assert.equal(hadCanvas, true);
      assert.equal(previousCanvas, undefined);
      assert.equal(Object.hasOwn(globalThis, "OffscreenCanvas"), true);
      assert.equal(browser.OffscreenCanvas, undefined);
    } finally {
      if (originallyHadPdfjs) browser.window.pdfjsLib = originalPdfjs;
      else delete browser.window.pdfjsLib;
      if (originallyHadCanvas) browser.OffscreenCanvas = originalCanvas;
      else delete browser.OffscreenCanvas;
      assert.equal(
        Object.hasOwn(globalThis, "OffscreenCanvas"),
        originallyHadCanvas,
      );
      assert.equal(browser.OffscreenCanvas, originalCanvas);
    }
  }
});

test("Format exposes bounded PDF context exhaustion in its failed Vision tool result", async () => {
  const source = "---\ntags: [vision]\n---\n# Vision\n\n![[document.pdf]]";
  const { vaultTools } = memoryVault(source, "document.pdf");
  const browser = globalThis as unknown as {
    OffscreenCanvas?: typeof OffscreenCanvas;
    window: typeof window & { pdfjsLib?: unknown };
  };
  const originallyHadPdfjs = Object.hasOwn(browser.window, "pdfjsLib");
  const originalPdfjs = browser.window.pdfjsLib;
  const sentinelPdfjs = { sentinel: "format-browser-smoke" };
  browser.window.pdfjsLib = sentinelPdfjs;
  const hadPdfjs = Object.hasOwn(browser.window, "pdfjsLib");
  const previousPdfjs = browser.window.pdfjsLib;
  const originallyHadCanvas = Object.hasOwn(globalThis, "OffscreenCanvas");
  const originalCanvas = browser.OffscreenCanvas;
  const sentinelCanvas = class SentinelOffscreenCanvas {} as unknown as typeof OffscreenCanvas;
  browser.OffscreenCanvas = sentinelCanvas;
  const hadCanvas = Object.hasOwn(globalThis, "OffscreenCanvas");
  const previousCanvas = browser.OffscreenCanvas;
  browser.window.pdfjsLib = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 10 * scale,
            height: 20 * scale,
          }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      }),
    }),
  };
  browser.OffscreenCanvas = class {
    constructor(private width: number, _height: number) {}
    getContext() { return {}; }
    async convertToBlob() {
      return {
        arrayBuffer: async () => new Uint8Array([this.width, 2, 3]).buffer,
      } as Blob;
    }
  } as unknown as typeof OffscreenCanvas;

  try {
    const calls: Array<{ stream: unknown; ids: string[] }> = [];
    const llm = {
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            calls.push({ stream: params.stream, ids: pageIdsFromParams(params) });
            if (params.stream === false) throw hostileContextError();
            return (async function* () {
              yield chunk(formatFrame(source, false));
              yield usageChunk();
            })();
          },
        },
      },
    } as unknown as LlmClient;
    const events: RunEvent[] = [];
    for await (const event of runFormat(
      ["notes/source.md"],
      vaultTools,
      llm,
      "format-model",
      false,
      [],
      new AbortController().signal,
      { inputBudgetTokens: 12_000, maxTokens: 777 },
      undefined,
      3,
      {
        enabled: true,
        model: "vision-model",
        language: "en",
      },
    )) {
      events.push(event);
    }

    const failedVision = events.find((event) =>
      event.kind === "tool_result"
      && event.ok === false
      && /vision\.analysis/.test(event.preview ?? ""));
    assert.ok(failedVision, JSON.stringify(calls));
    if (failedVision?.kind === "tool_result") {
      const preview = failedVision.preview ?? "";
      assert.match(
        preview,
        /configuredInputBudget=12000.*finalEffectiveInputBudget=9000.*provider context limit/i,
      );
      assert.doesNotMatch(
        preview,
        /AUTH_SECRET|KEY_SECRET|SOURCE_SECRET|RAW_MEDIA_SECRET|JSON_MEDIA_SECRET|Bearer|api_key|data:image|data:image\\\/png/i,
      );
    }
  } finally {
    try {
      if (hadPdfjs) browser.window.pdfjsLib = previousPdfjs;
      else delete browser.window.pdfjsLib;
      if (hadCanvas) browser.OffscreenCanvas = previousCanvas;
      else delete browser.OffscreenCanvas;
      assert.equal(hadPdfjs, true);
      assert.equal(previousPdfjs, sentinelPdfjs);
      assert.equal(browser.window.pdfjsLib, sentinelPdfjs);
      assert.equal(hadCanvas, true);
      assert.equal(previousCanvas, sentinelCanvas);
      assert.equal(Object.hasOwn(globalThis, "OffscreenCanvas"), true);
      assert.equal(browser.OffscreenCanvas, sentinelCanvas);
    } finally {
      if (originallyHadPdfjs) browser.window.pdfjsLib = originalPdfjs;
      else delete browser.window.pdfjsLib;
      if (originallyHadCanvas) browser.OffscreenCanvas = originalCanvas;
      else delete browser.OffscreenCanvas;
      assert.equal(
        Object.hasOwn(globalThis, "OffscreenCanvas"),
        originallyHadCanvas,
      );
      assert.equal(browser.OffscreenCanvas, originalCanvas);
    }
  }
});
