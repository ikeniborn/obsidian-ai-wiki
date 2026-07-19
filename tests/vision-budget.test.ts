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
  settings.backend = "native-agent";
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

test("record merge covers every page and governed field for every profile", () => {
  const records = [record("p1"), record("p2")];
  for (const profile of ["maximum", "balanced", "minimum"] as const) {
    const merged = mergeRecognitionRecords(records, profile);
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
  }
});

test("AgentRunner forwards resolved global and per-operation profiles only to Vision messages", async () => {
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
    assert.match(
      JSON.stringify(visionParams.messages),
      new RegExp(`${item.profile} semantic compression`, "i"),
    );
    const formatSystem = (
      formatParams.messages as OpenAI.Chat.ChatCompletionMessageParam[]
    ).find((message) => message.role === "system")?.content;
    assert.equal(typeof formatSystem, "string");
    assert.doesNotMatch(String(formatSystem), /semantic compression/i);
    formatSystems.push(String(formatSystem));
  }

  assert.equal(new Set(formatSystems).size, 1);
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
        compressionProfile: "maximum",
        onEvent: (event) => events.push(event),
      },
    ),
    /uncertainty/i,
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0].stream, false);
  assert.equal(seen[0].max_tokens, 321);
  assert.ok(seen[0].response_format);
  assert.ok(
    estimatePreparedMessages(
      seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[],
    ) <= 20_000,
  );
  assert.match(JSON.stringify(seen[0].messages), /maximum semantic compression/i);
  const budgetEvent = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budgetEvent);
  if (budgetEvent?.kind === "prompt_budget") {
    assert.equal(budgetEvent.callSite, "vision.analysis");
    assert.equal(budgetEvent.outputBudget, 321);
    assert.equal(budgetEvent.compressionProfile, "maximum");
    assert.equal(budgetEvent.actualInputTokens, 123);
  }
  assert.doesNotMatch(JSON.stringify(events), /AQID|visible text|box contains text/);
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
      compressionProfile: "minimum",
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
  assert.ok(seen.every((params) => params.max_tokens === 222));
  assert.ok(seen.every((params) => /minimum semantic compression/i.test(JSON.stringify(params.messages))));
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
      compressionProfile: "balanced",
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
      compressionProfile: "balanced",
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
        compressionProfile: "balanced",
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

test("PDF context recovery exhausts two global repacks with unique bounded requests", async () => {
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

  await assert.rejects(
    analyzePdf(
      new ArrayBuffer(0),
      llm,
      "vision-model",
      new AbortController().signal,
      "en",
      "en",
      {
        inputBudgetTokens: 20_000,
        compressionProfile: "balanced",
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
    /vision\.analysis.*configuredInputBudget=20000.*finalEffectiveInputBudget=11250.*provider context limit.*promptTokens=12000.*maxContextTokens=10000/i,
  );

  const budgets = events
    .filter((event) => event.kind === "prompt_budget")
    .map((event) => event.kind === "prompt_budget" ? event.effectiveInputBudget : -1);
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen.map((call) => call.signature)).size, 3);
  assert.deepEqual(budgets, [20_000, 15_000, 11_250]);
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
        compressionProfile: "maximum",
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
      compressionProfile: "minimum",
      onEvent: (event) => events.push(event),
    },
  );

  assert.equal(seen[0].max_tokens, 456);
  assert.equal(seen[0].stream, false);
  assert.match(JSON.stringify(seen[0].messages), /minimum semantic compression/i);
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
      compressionProfile: "minimum",
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

test("Excalidraw uses one media unit with bounded profile and output cap", async () => {
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
      compressionProfile: "maximum",
    },
  );

  const messages = seen[0].messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const mediaParts = messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === "image_url");
  assert.equal(mediaParts.length, 1);
  assert.equal(seen[0].max_tokens, 654);
  assert.match(JSON.stringify(messages), /maximum semantic compression/i);
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
    "native-agent",
    undefined,
    3,
    {
      enabled: true,
      model: "vision-model",
      language: "en",
      compressionProfile: "balanced",
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
      "native-agent",
      undefined,
      3,
      {
        enabled: true,
        model: "vision-model",
        language: "en",
        compressionProfile: "balanced",
      },
    )) {
      events.push(event);
    }

    const failedVision = events.find((event) =>
      event.kind === "tool_result"
      && event.ok === false
      && /vision\.analysis/.test(event.preview));
    assert.ok(failedVision, JSON.stringify(calls));
    if (failedVision?.kind === "tool_result") {
      assert.match(
        failedVision.preview,
        /configuredInputBudget=12000.*finalEffectiveInputBudget=9000.*provider context limit/i,
      );
      assert.doesNotMatch(
        failedVision.preview,
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
