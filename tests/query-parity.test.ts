import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import type OpenAI from "openai";
import type { DomainEntry } from "../src/domain";
import type { SelectedChunk } from "../src/page-similarity";
import {
  DEFAULT_SETTINGS,
  type LlmCallOptions,
  type LlmClient,
  type LlmWikiPluginSettings,
  type OpKey,
  type RunEvent,
  type RunRequest,
  type WikiOperation,
} from "../src/types";
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

const {
  AgentRunner,
  resolveFollowUpPolicyOperation,
} = await import("../src/agent-runner");
const { policyKey } = await import("../src/model-call-policy");
const { estimatePreparedMessages } = await import("../src/prompt-budget");
const { PageSimilarityService } = await import("../src/page-similarity");
const { runQuery } = await import("../src/phases/query");
const { runCrossDomainQuery } = await import("../src/phases/query-cross-domain");
const { normalizeRerankerConfig } = await import("../src/reranker");

(globalThis as unknown as {
  window: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}).window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

const domain = readFileSync(new URL("../src/phases/query.ts", import.meta.url), "utf8");
const cross = readFileSync(new URL("../src/phases/query-cross-domain.ts", import.meta.url), "utf8");

for (const [name, src] of [["query", domain], ["query-cross-domain", cross]] as const) {
  test(`${name} selects chunks, dedupes, then reranks in that order`, () => {
    const selIdx = src.indexOf("selectRelevantChunks");
    const dedupIdx = src.indexOf("dedupeChunks(");
    const rerankIdx = src.indexOf("rerankChunks(");
    assert.ok(selIdx > -1, "selectRelevantChunks present");
    assert.ok(dedupIdx > -1, "dedupeChunks present");
    assert.ok(rerankIdx > -1, "rerankChunks present");
    assert.ok(selIdx < dedupIdx && dedupIdx < rerankIdx, "order: select → dedupe → rerank");
  });

  test(`${name} drives rerank limits from rerankerRuntime.config`, () => {
    assert.match(src, /rerankerRuntime\.config\.rerankerTopN/);
    assert.match(src, /rerankerRuntime\.config\.contextTopN/);
  });

  test(`${name} applies article-depth context packing after reranking`, () => {
    const rerankIdx = src.indexOf("rerankChunks(");
    const contextIdx = src.indexOf("selectQueryContextChunks(");
    assert.ok(rerankIdx > -1 && contextIdx > rerankIdx);
    assert.match(src, /resultTopN:\s*candidateLimit/);
    assert.doesNotMatch(src, /reranked\.chunks\.slice\(0, contextLimit\)/);
  });

  test(`${name} applies boilerplate demotion`, () => {
    assert.match(src, /boilerplateDemotion|demoteBoilerplate/);
  });
}

function memoryAdapter(initial: Record<string, string> = {}): VaultAdapter {
  const files = new Map(Object.entries(initial));
  const folders = new Set<string>([""]);
  const addParents = (path: string): void => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      folders.add(parts.slice(0, index).join("/"));
    }
  };
  for (const path of files.keys()) addParents(path);

  return {
    read: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    write: async (path, value) => {
      addParents(path);
      files.set(path, value);
    },
    append: async (path, value) => {
      addParents(path);
      files.set(path, (files.get(path) ?? "") + value);
    },
    list: async (path) => {
      const prefix = path ? `${path}/` : "";
      const directFiles = [...files.keys()].filter((candidate) => {
        if (!candidate.startsWith(prefix)) return false;
        return !candidate.slice(prefix.length).includes("/");
      });
      const directFolders = [...folders].filter((candidate) => {
        if (!candidate.startsWith(prefix) || candidate === path) return false;
        return !candidate.slice(prefix.length).includes("/");
      });
      return { files: directFiles, folders: directFolders };
    },
    exists: async (path) => files.has(path) || folders.has(path),
    mkdir: async (path) => {
      addParents(`${path}/child`);
      folders.add(path);
    },
    remove: async (path) => {
      files.delete(path);
    },
  };
}

function queryPage(): string {
  return [
    "---",
    "description: Failover procedure quorum recovery citation evidence.",
    "---",
    "# Failover",
    "",
    "## Procedure",
    "PARITY_CHUNK_START",
    "Failover procedure requires quorum before recovery.",
    "failover quorum recovery citation evidence ".repeat(15),
    "PARITY_CHUNK_END",
    "",
    "## Background",
    "Secondary failover background.",
    "failover background ".repeat(32),
  ].join("\n");
}

function capturingLlm(
  requests: Record<string, unknown>[],
  inputTokens?: number,
  failStreaming = false,
): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const request = params as Record<string, unknown>;
          requests.push(request);
          if (failStreaming && request.stream === true) {
            throw new Error("stream transport unavailable");
          }
          if (failStreaming) {
            return {
              id: "completion",
              object: "chat.completion",
              created: 0,
              model: "mock",
              choices: [{
                index: 0,
                message: { role: "assistant", content: "parity answer", refusal: null },
                finish_reason: "stop",
                logprobs: null,
              }],
              usage: {
                prompt_tokens: inputTokens ?? 444,
                completion_tokens: 7,
                total_tokens: (inputTokens ?? 444) + 7,
              },
            } as OpenAI.Chat.ChatCompletion;
          }
          return (async function* () {
            yield {
              id: "content",
              object: "chat.completion.chunk",
              created: 0,
              model: "mock",
              choices: [{
                index: 0,
                delta: { content: "parity answer" },
                finish_reason: null,
              }],
            } as OpenAI.Chat.ChatCompletionChunk;
            if (inputTokens !== undefined) {
              yield {
                id: "usage",
                object: "chat.completion.chunk",
                created: 0,
                model: "mock",
                choices: [],
                usage: {
                  prompt_tokens: inputTokens,
                  completion_tokens: 2,
                  total_tokens: inputTokens + 2,
                },
              } as OpenAI.Chat.ChatCompletionChunk;
            }
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

function providerContextError(): Error & { code: string } {
  return Object.assign(
    new Error("prompt input exceeds context window"),
    { code: "context_length_exceeded" },
  );
}

function repackingLlm(
  requests: Record<string, unknown>[],
  answer: string,
): LlmClient {
  let attempt = 0;
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) throw providerContextError();
          return (async function* () {
            yield {
              id: "content",
              object: "chat.completion.chunk",
              created: 0,
              model: "mock",
              choices: [{
                index: 0,
                delta: { content: answer },
                finish_reason: null,
              }],
            } as OpenAI.Chat.ChatCompletionChunk;
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

function fixedChunkSimilarity(chunks: SelectedChunk[]): InstanceType<typeof PageSimilarityService> {
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: chunks.length });
  similarity.withBoilerplateDemotion = () => similarity;
  similarity.selectRelevantChunks = async (
    _query,
    pages,
  ) => chunks.filter((chunk) => pages.has(chunk.path));
  return similarity;
}

function articleIdsInBody(request: Record<string, unknown>): Set<string> {
  return new Set(
    [...messagesText(request).matchAll(/--- article: ([^,\s]+)/g)]
      .map((match) => match[1]),
  );
}

function availableLinkIds(request: Record<string, unknown>): Set<string> {
  return new Set(
    [...messagesText(request).matchAll(/^- (wiki_[^\s]+)$/gm)]
      .map((match) => match[1]),
  );
}

function indexIds(request: Record<string, unknown>): Set<string> {
  return new Set(
    [...messagesText(request).matchAll(/^(wiki_[^:\s]+):/gm)]
      .map((match) => match[1]),
  );
}

async function drainEvents(
  generator: AsyncGenerator<RunEvent, unknown>,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return events;
    events.push(next.value);
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function nextWithOverallTimeout<T>(
  generator: AsyncGenerator<RunEvent, T>,
  label: string,
): Promise<IteratorResult<RunEvent, T>> {
  let resolve!: (value: IteratorResult<RunEvent, T>) => void;
  let reject!: (error: unknown) => void;
  const settled = new Promise<IteratorResult<RunEvent, T>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void generator.next().then(resolve, reject);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error(`${label} lifecycle buffered behind request`)), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function messagesText(request: Record<string, unknown>): string {
  return (request.messages as OpenAI.Chat.ChatCompletionMessageParam[])
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");
}

test("single- and cross-domain Query use the same bounded answer packing behavior", async () => {
  const pagePath = "!Wiki/d/concept/wiki_d_failover.md";
  const vaultTools = new VaultTools(memoryAdapter({ [pagePath]: queryPage() }), "/vault");
  const domainEntry: DomainEntry = {
    id: "d",
    name: "Demo",
    wiki_folder: "d",
    source_paths: [],
    entity_types: [],
    analyzed_sources: {},
  };
  const question = "How does the failover procedure use quorum for recovery?";
  const opts = {
    inputBudgetTokens: 6_000,
    maxTokens: 500,
    semanticCompression: {
      profile: "balanced" as const,
      operation: "query" as const,
    },
  };
  const rerankerRuntime = {
    config: normalizeRerankerConfig({
      enabled: false,
      rerankerTopN: 8,
      contextTopN: 8,
    }),
    baseUrl: "",
    apiKey: "",
  };
  const singleRequests: Record<string, unknown>[] = [];
  const crossRequests: Record<string, unknown>[] = [];

  const singleEvents = await drainEvents(runQuery(
    [question],
    false,
    vaultTools,
    capturingLlm(singleRequests, 444, true),
    "mock",
    [domainEntry],
    "/vault",
    new AbortController().signal,
    1,
    opts,
    5,
    0.01,
    10,
    undefined,
    0,
    0,
    false,
    60,
    0,
    { enabled: false, factor: 0 },
    rerankerRuntime,
  ));
  const crossEvents = await drainEvents(runCrossDomainQuery(
    question,
    vaultTools,
    capturingLlm(crossRequests, 444, true),
    "mock",
    [domainEntry],
    new AbortController().signal,
    {
      graphDepth: 1,
      seedTopK: 5,
      seedMinScore: 0.01,
      bfsTopK: 10,
      seedSimilarityThreshold: 0,
      bfsMinScoreRatio: 0,
      boilerplateDemotion: { enabled: false, factor: 0 },
      rerankerRuntime,
    },
    60,
    0,
    opts,
  ));

  assert.equal(singleRequests.length, 2);
  assert.equal(crossRequests.length, 2);
  for (const [path, requests] of [
    ["single", singleRequests],
    ["cross", crossRequests],
  ] as const) {
    assert.equal(requests[0].stream, true, `${path} starts streaming`);
    assert.equal(requests[1].stream, false, `${path} fallback is non-streaming`);
    for (const request of requests) {
      const text = messagesText(request);
      assert.match(text, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(text, /PARITY_CHUNK_START[\s\S]*PARITY_CHUNK_END/);
      assert.ok(
        estimatePreparedMessages(request.messages as OpenAI.Chat.ChatCompletionMessageParam[])
          <= opts.inputBudgetTokens,
      );
    }
  }

  const singleBudget = singleEvents.filter((event) => event.kind === "prompt_budget");
  const crossBudget = crossEvents.filter((event) => event.kind === "prompt_budget");
  assert.equal(singleBudget.length, 2);
  assert.equal(crossBudget.length, 2);
  assert.ok(singleBudget.every((event) => event.callSite === "query.answer"));
  assert.ok(crossBudget.every((event) => event.callSite === "query.answer"));
  assert.ok(singleBudget.every((event) => event.compressionProfile === "balanced"));
  assert.ok(crossBudget.every((event) => event.compressionProfile === "balanced"));
  assert.ok(singleBudget.every((event) => event.configuredInputBudget === opts.inputBudgetTokens));
  assert.ok(crossBudget.every((event) => event.configuredInputBudget === opts.inputBudgetTokens));
  assert.equal(
    singleEvents.some((event) => event.kind === "query_stats" && !event.crossDomain),
    true,
  );
  assert.equal(
    crossEvents.some((event) => event.kind === "query_stats" && event.crossDomain),
    true,
  );
  for (const [path, events] of [
    ["single", singleEvents],
    ["cross", crossEvents],
  ] as const) {
    const queryStatsIndex = events.findIndex((event) => event.kind === "query_stats");
    const usageIndexes = events
      .map((event, index) => event.kind === "llm_call_stats" ? index : -1)
      .filter((index) => index >= 0);
    assert.equal(usageIndexes.length, 1, `${path} emits one final usage event`);
    assert.ok(
      usageIndexes[0] > queryStatsIndex,
      `${path} final usage follows query_stats so the UI can fill its token row`,
    );
    const usage = events[usageIndexes[0]];
    assert.equal(usage.kind === "llm_call_stats" ? usage.inputTokens : undefined, 444);
    assert.equal(usage.kind === "llm_call_stats" ? usage.outputTokens : undefined, 7);
  }
});

test("Query seed selection and primary answer expose ordered human lifecycle attempts", async () => {
  const pagePath = "!Wiki/d/concept/wiki_d_failover.md";
  const requests: Record<string, unknown>[] = [];
  const seedRelease = deferred();
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const request = params as Record<string, unknown>;
          requests.push(request);
          if (request.stream === false) {
            await seedRelease.promise;
            return {
              id: "seed-completion",
              object: "chat.completion",
              created: 0,
              model: "mock",
              choices: [{
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    reasoning: "The annotated failover page is the relevant source.",
                    seeds: ["wiki_d_failover"],
                  }),
                  refusal: null,
                },
                finish_reason: "stop",
                logprobs: null,
              }],
              usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
            } as OpenAI.Chat.ChatCompletion;
          }
          return (async function* () {
            yield {
              id: "answer",
              object: "chat.completion.chunk",
              created: 0,
              model: "mock",
              choices: [{
                index: 0,
                delta: { content: "Seed-selected answer." },
                finish_reason: "stop",
              }],
            } as OpenAI.Chat.ChatCompletionChunk;
          })();
        },
      },
    },
  } as unknown as LlmClient;
  const generator = runQuery(
    ["unmatched-token-zzzx"],
    false,
    new VaultTools(memoryAdapter({ [pagePath]: queryPage() }), "/vault"),
    llm,
    "mock",
    [{
      id: "d",
      name: "Demo",
      wiki_folder: "d",
      source_paths: [],
      entity_types: [],
      analyzed_sources: {},
    }],
    "/vault",
    new AbortController().signal,
    1,
    { inputBudgetTokens: 6_000, maxTokens: 500 },
    5,
    0.9,
    10,
    fixedChunkSimilarity([{
      articleId: "wiki_d_failover",
      path: pagePath,
      heading: "## Procedure",
      body: "Failover procedure requires quorum before recovery.",
      score: 1,
      source: "seed",
      ordinal: 0,
    }]),
    0,
    0,
    false,
    60,
    0,
    { enabled: false, factor: 0 },
    {
      config: normalizeRerankerConfig({ enabled: false, rerankerTopN: 8, contextTopN: 8 }),
      baseUrl: "",
      apiKey: "",
    },
  );
  const events: RunEvent[] = [];
  const seedPhases: string[] = [];
  while (seedPhases.length < 3) {
    const next = await nextWithOverallTimeout(generator, "query seed");
    assert.equal(next.done, false);
    if (!next.done) {
      events.push(next.value);
      if (next.value.kind === "llm_lifecycle"
        && next.value.action === "select_relevant_pages") {
        seedPhases.push(next.value.phase);
      }
    }
  }
  assert.deepEqual(seedPhases, ["preparing", "sent", "waiting"]);
  seedRelease.resolve();
  for await (const event of generator) events.push(event);

  assert.deepEqual(requests.map((request) => request.stream), [false, true]);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(
    [...new Set(lifecycle.map((event) => event.id))].map((id) => {
      const attempt = lifecycle.filter((event) => event.id === id);
      return [attempt[0]?.action, attempt.map((event) => event.phase)];
    }),
    [
      ["select_relevant_pages", ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"]],
      ["answer_question", ["preparing", "sent", "waiting", "producing", "validating", "applying", "completed"]],
    ],
  );
});

test("single- and cross-domain Query keep the post-reranker winner under a one-chunk budget", async () => {
  const rawPath = "!Wiki/d/concept/wiki_d_raw.md";
  const winnerPath = "!Wiki/d/concept/wiki_d_winner.md";
  const page = (title: string) => [
    "---",
    "description: Reranker ranking evidence shared candidate.",
    "---",
    `# ${title}`,
    "",
    "Reranker ranking evidence shared candidate.",
  ].join("\n");
  const vaultTools = new VaultTools(memoryAdapter({
    [rawPath]: page("Raw"),
    [winnerPath]: page("Winner"),
  }), "/vault");
  const domainEntry: DomainEntry = {
    id: "d",
    name: "Demo",
    wiki_folder: "d",
    source_paths: [],
    entity_types: [],
    analyzed_sources: {},
  };
  const rawScoreLeader: SelectedChunk = {
    articleId: "wiki_d_raw",
    path: rawPath,
    heading: "## Raw",
    body: `RAW_SCORE_LEADER_START\n${"r".repeat(2_400)}\nRAW_SCORE_LEADER_END`,
    score: 1,
    source: "seed",
    ordinal: 0,
  };
  const rerankerWinner: SelectedChunk = {
    articleId: "wiki_d_winner",
    path: winnerPath,
    heading: "## Winner",
    body: `RERANKER_WINNER_START\n${"w".repeat(2_400)}\nRERANKER_WINNER_END`,
    score: 0.99,
    source: "seed",
    ordinal: 0,
  };
  const similarity = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  similarity.withBoilerplateDemotion = () => similarity;
  similarity.selectRelevantChunks = async () => [rawScoreLeader, rerankerWinner];
  const rerankerRuntime = {
    config: normalizeRerankerConfig({
      enabled: true,
      model: "reranker-test",
      rerankerTopN: 2,
      contextTopN: 2,
    }),
    baseUrl: "https://reranker.test",
    apiKey: "test",
  };
  const question = "Which reranker ranking evidence wins?";
  // Rescaled twice for the token estimator: from a byte-era budget of 7_000,
  // then to 1_350 once the character-class rules priced these letter runs near
  // half the old flat rate. It still fits only one of the two 2_400-character
  // candidate chunks.
  const opts = {
    inputBudgetTokens: 1_350,
    maxTokens: 200,
    semanticCompression: {
      profile: "balanced" as const,
      operation: "query" as const,
    },
  };
  const requests = {
    single: [] as Record<string, unknown>[],
    cross: [] as Record<string, unknown>[],
  };
  const testGlobal = globalThis as typeof globalThis & {
    __obsidianRequestUrlForTest?: (options: { body?: string }) => Promise<{ text: string }>;
  };
  const previousRequestUrl = testGlobal.__obsidianRequestUrlForTest;
  testGlobal.__obsidianRequestUrlForTest = async () => ({
    text: JSON.stringify({
      results: [
        { index: 0, relevance_score: 0.05 },
        { index: 1, relevance_score: 0.99 },
      ],
    }),
  });

  try {
    await drainEvents(runQuery(
      [question],
      false,
      vaultTools,
      capturingLlm(requests.single),
      "mock",
      [domainEntry],
      "/vault",
      new AbortController().signal,
      1,
      opts,
      2,
      0.01,
      2,
      similarity,
      0,
      0,
      false,
      60,
      0,
      { enabled: false, factor: 0 },
      rerankerRuntime,
    ));
    await drainEvents(runCrossDomainQuery(
      question,
      vaultTools,
      capturingLlm(requests.cross),
      "mock",
      [domainEntry],
      new AbortController().signal,
      {
        graphDepth: 1,
        seedTopK: 2,
        seedMinScore: 0.01,
        bfsTopK: 2,
        seedSimilarityThreshold: 0,
        bfsMinScoreRatio: 0,
        boilerplateDemotion: { enabled: false, factor: 0 },
        rerankerRuntime,
      },
      60,
      0,
      opts,
      similarity,
    ));
  } finally {
    testGlobal.__obsidianRequestUrlForTest = previousRequestUrl;
  }

  for (const [path, pathRequests] of [
    ["single", requests.single],
    ["cross", requests.cross],
  ] as const) {
    assert.equal(pathRequests.length, 1, `${path} answer request`);
    const text = messagesText(pathRequests[0]);
    assert.match(text, /RERANKER_WINNER_START[\s\S]*RERANKER_WINNER_END/, path);
    assert.doesNotMatch(text, /RAW_SCORE_LEADER_START|RAW_SCORE_LEADER_END/, path);
  }
  assert.equal(rerankerWinner.score, 0.99);
  assert.equal(rawScoreLeader.score, 1);
});

test("single- and cross-domain Query metadata stays final while retrieval telemetry stays pre-budget", async () => {
  const page = (title: string) => [
    "---",
    "description: Bounded metadata citation evidence.",
    "---",
    `# ${title}`,
    "",
    "Bounded metadata citation evidence.",
  ].join("\n");
  const chunk = (
    articleId: string,
    path: string,
    marker: string,
    score: number,
  ): SelectedChunk => ({
    articleId,
    path,
    heading: `## ${marker}`,
    body: `${marker}_BODY_START\n${marker} evidence\n${marker}_BODY_END`,
    score,
    source: "seed",
    ordinal: 0,
  });
  const opts = {
    inputBudgetTokens: 20_000,
    maxTokens: 200,
    semanticCompression: {
      profile: "balanced" as const,
      operation: "query" as const,
    },
  };
  const rerankerRuntime = {
    config: normalizeRerankerConfig({
      enabled: false,
      rerankerTopN: 4,
      contextTopN: 4,
    }),
    baseUrl: "",
    apiKey: "",
  };
  const question = "Which bounded metadata citation evidence is available?";

  const singleKeepPath = "!Wiki/s/concept/wiki_s_keep.md";
  const singleDropPath = "!Wiki/s/concept/wiki_s_drop.md";
  const singleDomain: DomainEntry = {
    id: "s",
    name: "Single",
    wiki_folder: "s",
    source_paths: [],
    entity_types: [],
    analyzed_sources: {},
  };
  const singleChunks = [
    chunk("wiki_s_keep", singleKeepPath, "SINGLE_KEEP", 1),
    chunk("wiki_s_drop", singleDropPath, "SINGLE_DROP", 0.9),
  ];
  const singleRequests: Record<string, unknown>[] = [];
  const singleEvents = await drainEvents(runQuery(
    [question],
    false,
    new VaultTools(memoryAdapter({
      [singleKeepPath]: page("Single Keep"),
      [singleDropPath]: page("Single Drop"),
    }), "/vault"),
    repackingLlm(singleRequests, "single citation [[wiki_s_drop]]"),
    "mock",
    [singleDomain],
    "/vault",
    new AbortController().signal,
    1,
    opts,
    2,
    0.01,
    2,
    fixedChunkSimilarity(singleChunks),
    0,
    0,
    false,
    60,
    0,
    { enabled: false, factor: 0 },
    rerankerRuntime,
  ));

  const alphaPath = "!Wiki/a/concept/wiki_a_keep.md";
  const betaPath = "!Wiki/b/concept/wiki_b_drop.md";
  const alpha: DomainEntry = {
    id: "a",
    name: "Alpha",
    wiki_folder: "a",
    source_paths: [],
    entity_types: [],
    analyzed_sources: {},
  };
  const beta: DomainEntry = {
    id: "b",
    name: "Beta",
    wiki_folder: "b",
    source_paths: [],
    entity_types: [],
    analyzed_sources: {},
  };
  const crossChunks = [
    chunk("wiki_a_keep", alphaPath, "CROSS_KEEP", 1),
    chunk("wiki_b_drop", betaPath, "CROSS_DROP", 0.9),
  ];
  const crossRequests: Record<string, unknown>[] = [];
  const crossEvents = await drainEvents(runCrossDomainQuery(
    question,
    new VaultTools(memoryAdapter({
      [alphaPath]: page("Alpha Keep"),
      [betaPath]: page("Beta Drop"),
    }), "/vault"),
    repackingLlm(crossRequests, "cross citation [[wiki_b_drop]]"),
    "mock",
    [alpha, beta],
    new AbortController().signal,
    {
      graphDepth: 1,
      seedTopK: 2,
      seedMinScore: 0.01,
      bfsTopK: 2,
      seedSimilarityThreshold: 0,
      bfsMinScoreRatio: 0,
      boilerplateDemotion: { enabled: false, factor: 0 },
      rerankerRuntime,
    },
    60,
    0,
    opts,
    fixedChunkSimilarity(crossChunks),
  ));

  for (const [path, requests] of [
    ["single", singleRequests],
    ["cross", crossRequests],
  ] as const) {
    assert.equal(requests.length, 2, `${path} retries once`);
    const firstBodies = articleIdsInBody(requests[0]);
    const finalBodies = articleIdsInBody(requests[1]);
    assert.equal(firstBodies.size, 2, `${path} initial chunks`);
    assert.equal(finalBodies.size, 1, `${path} successful chunks`);
    for (const request of requests) {
      assert.deepEqual(availableLinkIds(request), articleIdsInBody(request), `${path} links`);
      assert.deepEqual(indexIds(request), articleIdsInBody(request), `${path} index`);
    }
  }

  const singleStats = singleEvents.find((event) => event.kind === "query_stats");
  assert.ok(singleStats && singleStats.kind === "query_stats");
  assert.equal(singleStats.pagesSelected, 1);
  assert.equal(singleStats.chunksSelected, 1);
  assert.equal(singleStats.seedCount, 1);
  assert.equal(singleStats.graphCount, 0);
  assert.equal(singleStats.reranker?.selected, 2);
  const singleEval = singleEvents.find((event) => event.kind === "eval_meta");
  assert.ok(singleEval && singleEval.kind === "eval_meta");
  assert.deepEqual(singleEval.fields.found_pages, ["wiki_s_keep"]);
  assert.deepEqual(
    (singleEval.fields.found_chunks as Array<{ articleId: string }>)
      .map((found) => found.articleId),
    ["wiki_s_keep"],
  );
  const singleResult = singleEvents.find((event) => event.kind === "result");
  assert.ok(singleResult && singleResult.kind === "result");
  assert.match(singleResult.text, /\[\[wiki_s_drop\]\] \*\(not in wiki\)\*/);

  const crossStats = crossEvents.find((event) => event.kind === "query_stats");
  assert.ok(crossStats && crossStats.kind === "query_stats");
  assert.equal(crossStats.domainsStudied, 2);
  assert.deepEqual(crossStats.fromDomains, ["Alpha"]);
  assert.equal(crossStats.pagesSelected, 1);
  assert.equal(crossStats.chunksSelected, 1);
  assert.equal(crossStats.reranker?.selected, 2);
  const crossEval = crossEvents.find((event) => event.kind === "eval_meta");
  assert.ok(crossEval && crossEval.kind === "eval_meta");
  assert.deepEqual(crossEval.fields.found_pages, ["wiki_a_keep"]);
  assert.deepEqual(
    (crossEval.fields.found_chunks as Array<{ articleId: string }>)
      .map((found) => found.articleId),
    ["wiki_a_keep"],
  );
  const crossResult = crossEvents.find((event) => event.kind === "result");
  assert.ok(crossResult && crossResult.kind === "result");
  assert.match(crossResult.text, /\[\[wiki_b_drop\]\] \*\(not in wiki\)\*/);
});

function runnerSettings(): LlmWikiPluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.baseUrl = "https://llm.example/v1";
  settings.nativeAgent.apiKey = "test-key";
  settings.nativeAgent.model = "chat-model";
  settings.nativeAgent.perOperation = true;
  settings.nativeAgent.operations.query = {
    ...settings.nativeAgent.operations.query,
    model: "native-query-model",
    inputBudgetTokens: 4_321,
    maxTokens: 987,
    compressionProfile: "minimum",
  };
  settings.nativeAgent.operations.lint = {
    ...settings.nativeAgent.operations.lint,
    model: "native-lint-model",
    inputBudgetTokens: 8_765,
    maxTokens: 654,
    compressionProfile: "maximum",
  };
  settings.nativeAgent.operations.format = {
    ...settings.nativeAgent.operations.format,
    model: "native-format-model",
    inputBudgetTokens: 2_468,
    maxTokens: 321,
    compressionProfile: "minimum",
  };
  return settings;
}

async function captureRunnerPolicy(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation = "chat",
  policyOperation: OpKey = "query",
): Promise<{
  req: RunRequest;
  model: string;
  opts: Parameters<Extract<LlmClient["chat"]["completions"]["create"], (...args: never[]) => unknown>>[0] | Record<string, unknown>;
}> {
  const runner = new AgentRunner(
    capturingLlm([]),
    settings,
    new VaultTools(memoryAdapter(), "/vault"),
    "Vault",
    [],
    undefined,
    false,
    stubModelContextStore(),
  );
  let captured: {
    req: RunRequest;
    model: string;
    opts: Record<string, unknown>;
  } | undefined;
  (runner as unknown as {
    runOperation(
      req: RunRequest,
      model: string,
      opts: Record<string, unknown>,
    ): AsyncGenerator<RunEvent>;
  }).runOperation = async function* (req, model, opts) {
    captured = { req, model, opts };
    yield { kind: "result", durationMs: 1, text: "captured" };
  };

  await drainEvents(runner.run({
    operation,
    policyOperation,
    operationHeader: "VISIBLE OPERATION LABEL",
    args: [],
    cwd: "/vault",
    signal: new AbortController().signal,
    timeoutMs: 0,
    chatMessages: [{ role: "user", content: "current" }],
  }));
  assert.ok(captured);
  return captured;
}

test("follow-up Chat policy propagation governs OpenAI without changing its visible label", async () => {
  assert.equal(resolveFollowUpPolicyOperation("query"), "query");
  assert.equal(resolveFollowUpPolicyOperation("lint"), "lint");
  assert.equal(resolveFollowUpPolicyOperation("ingest"), "lint");
  assert.equal(policyKey("chat", "query"), "query");
  assert.equal(policyKey("chat", "lint"), "lint");
  assert.equal(policyKey("chat", "ingest"), "lint");

  const openai = await captureRunnerPolicy(runnerSettings());
  assert.equal(openai.req.operationHeader, "VISIBLE OPERATION LABEL");
  assert.equal(openai.model, "native-query-model");
  assert.equal(openai.opts.inputBudgetTokens, 4_321);
  assert.equal(openai.opts.maxTokens, 987);
  assert.deepEqual(openai.opts.semanticCompression, {
    profile: "minimum",
    operation: "query",
  });
});

test("AgentRunner treats policyOperation as a Chat parent and never as a non-Chat override", async () => {
  const settings = runnerSettings();
  const format = await captureRunnerPolicy(settings, "format", "query");
  assert.equal(format.model, "native-format-model");
  assert.equal(format.opts.inputBudgetTokens, 2_468);
  assert.equal(format.opts.maxTokens, 321);
  assert.equal(format.opts.semanticCompression, undefined);

  const query = await captureRunnerPolicy(settings, "query", "lint");
  assert.equal(query.model, "native-query-model");
  assert.equal(query.opts.inputBudgetTokens, 4_321);
  assert.equal(query.opts.maxTokens, 987);
  assert.deepEqual(query.opts.semanticCompression, {
    profile: "minimum",
    operation: "query",
  });

  const queryChat = await captureRunnerPolicy(settings, "chat", "query");
  assert.equal(queryChat.model, "native-query-model");
  assert.deepEqual(queryChat.opts.semanticCompression, {
    profile: "minimum",
    operation: "query",
  });

  const lintChat = await captureRunnerPolicy(settings, "chat", "lint");
  assert.equal(lintChat.model, "native-lint-model");
  assert.deepEqual(lintChat.opts.semanticCompression, {
    profile: "maximum",
    operation: "lint",
  });
});
