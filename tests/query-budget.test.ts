import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import type { SelectedChunk } from "../src/page-similarity";
import type { LlmClient, RunEvent } from "../src/types";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const {
  packChatHistory,
  packQueryChunks,
} = await import("../src/phases/query-budget");
const { PromptBudgetExceededError } = await import("../src/prompt-budget");
const { answerFromContext } = await import("../src/phases/query-answer");
const { runLintChat } = await import("../src/phases/chat");
const { wrapMobileNoStream } = await import("../src/mobile-llm-wrap");
const { render } = await import("../src/phases/template");
const { default: chatTemplate } = await import("../prompts/chat.md");

function selectedChunk(index: number, score: number): SelectedChunk {
  return {
    articleId: `wiki_d_${index}`,
    path: `!Wiki/d/concept/wiki_d_${index}.md`,
    heading: `## Section ${index}`,
    body: `COMPLETE_CHUNK_${index}_START\n${String(index).repeat(180)}\nCOMPLETE_CHUNK_${index}_END`,
    score,
    source: index % 2 === 0 ? "seed" : "graph",
    ordinal: index,
  };
}

function repackChunk(index: number): SelectedChunk {
  return {
    ...selectedChunk(index, 100 - index),
    body: [
      `REPACK_CHUNK_${index}_START`,
      `${String(index)} failover citation `.repeat(55),
      `REPACK_CHUNK_${index}_END`,
    ].join("\n"),
  };
}

function contextError(): Error & { code: string } {
  return Object.assign(
    new Error("prompt input exceeds context window"),
    { code: "context_length_exceeded" },
  );
}

function streamChunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "content",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function successfulStream(answer: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return (async function* () {
    yield streamChunk(answer);
    yield usageChunk();
  })();
}

function completion(answer: string): OpenAI.Chat.ChatCompletion {
  return {
    id: "completion",
    object: "chat.completion",
    created: 0,
    model: "mock",
    choices: [{
      index: 0,
      message: { role: "assistant", content: answer, refusal: null },
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: { prompt_tokens: 444, completion_tokens: 7, total_tokens: 451 },
  };
}

interface CapturedCall {
  params: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

function transportFailureThenCompletion(calls: CapturedCall[]): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown, callOpts?: { signal?: AbortSignal }) => {
          calls.push({
            params: params as Record<string, unknown>,
            signal: callOpts?.signal,
          });
          if (calls.length === 1) throw new Error("socket disconnected");
          return completion("fallback answer");
        },
      },
    },
  } as unknown as LlmClient;
}

function assertCleanFallback(calls: CapturedCall[], signal: AbortSignal): void {
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.stream, false);
  assert.equal("stream_options" in calls[1].params, false);
  assert.equal(calls[1].signal, signal);
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function nextAssistantEvent<T>(
  generator: AsyncGenerator<RunEvent, T>,
): Promise<Extract<RunEvent, { kind: "assistant_text" }>> {
  while (true) {
    const next = await generator.next();
    if (next.done) throw new Error("generator completed before assistant_text");
    if (next.value.kind === "assistant_text") return next.value;
  }
}

async function drainRemaining<T>(generator: AsyncGenerator<RunEvent, T>): Promise<T> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
  }
}

async function drainGenerator<T>(
  generator: AsyncGenerator<RunEvent, T>,
): Promise<{ events: RunEvent[]; result: T }> {
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

function requestText(params: Record<string, unknown>): string {
  const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  return messages
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");
}

function includedRepackChunks(text: string): number {
  return (text.match(/REPACK_CHUNK_\d+_START/g) ?? []).length;
}

function heterogeneousQueryChunks(): SelectedChunk[] {
  return [
    {
      ...selectedChunk(100, 100),
      body: `HET_QUERY_LARGE_START\n${"L".repeat(4_000)}\nHET_QUERY_LARGE_END`,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      ...selectedChunk(200 + index, 90 - index),
      body: `HET_QUERY_SMALL_${index}_START\n${"s".repeat(220)}\nHET_QUERY_SMALL_${index}_END`,
    })),
  ];
}

function includedMarkerIds(text: string, prefix: string): Set<string> {
  return new Set(
    [...text.matchAll(new RegExp(`${prefix}_([A-Z0-9_]+)_START`, "g"))]
      .map((match) => match[1]),
  );
}

function isStrictSubset(next: Set<string>, previous: Set<string>): boolean {
  return next.size < previous.size && [...next].every((id) => previous.has(id));
}

function chatPair(id: string, userSize: number, assistantSize: number) {
  return [
    {
      role: "user" as const,
      content: `HET_CHAT_UNIT_${id}_START\n${"u".repeat(userSize)}\nHET_CHAT_UNIT_${id}_END`,
    },
    {
      role: "assistant" as const,
      content: `chat pair ${id} assistant ${"a".repeat(assistantSize)}`,
    },
  ];
}

test("packQueryChunks keeps the exact current question and complete highest-score chunks", () => {
  const question = "What is the failover procedure? [CURRENT-QUESTION]";
  const chunks = Array.from({ length: 20 }, (_, index) => selectedChunk(index, 20 - index));

  const result = packQueryChunks({
    question,
    systemPrompt: "Answer with citations.",
    chunks,
    inputBudgetTokens: 3_000,
    opts: {},
  });

  const messageText = result.messages
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");
  assert.match(messageText, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(result.estimatedInputTokens <= 3_000);
  assert.ok(result.selected.length > 0);
  assert.ok(result.selected.length < chunks.length);
  assert.deepEqual(result.selected, chunks.slice(0, result.selected.length));
  for (const chunk of chunks) {
    const included = messageText.includes(chunk.body);
    assert.equal(included, result.selected.includes(chunk), `${chunk.articleId} must be whole or omitted`);
  }
});

test("packQueryChunks treats incoming post-reranker order as authoritative", () => {
  const rerankerWinner: SelectedChunk = {
    ...selectedChunk(1, 9.5),
    body: `RERANKER_WINNER_START\n${"w".repeat(900)}\nRERANKER_WINNER_END`,
  };
  const rawScoreLeader: SelectedChunk = {
    ...selectedChunk(0, 10),
    body: `RAW_SCORE_LEADER_START\n${"r".repeat(900)}\nRAW_SCORE_LEADER_END`,
  };
  const args = {
    question: "Which reranked chunk should survive?",
    systemPrompt: "Use the highest-ranked complete chunk.",
    opts: {},
  };
  const winnerBudget = packQueryChunks({
    ...args,
    chunks: [rerankerWinner],
    inputBudgetTokens: 100_000,
  }).estimatedInputTokens;
  const rawLeaderBudget = packQueryChunks({
    ...args,
    chunks: [rawScoreLeader],
    inputBudgetTokens: 100_000,
  }).estimatedInputTokens;
  const oneChunkBudget = Math.max(winnerBudget, rawLeaderBudget);

  const packed = packQueryChunks({
    ...args,
    chunks: [rerankerWinner, rawScoreLeader],
    inputBudgetTokens: oneChunkBudget,
  });

  assert.deepEqual(packed.selected, [rerankerWinner]);
  assert.equal(packed.selected[0].score, 9.5, "raw score remains telemetry data");
  assert.match(JSON.stringify(packed.messages), /RERANKER_WINNER_START[\s\S]*RERANKER_WINNER_END/);
  assert.doesNotMatch(JSON.stringify(packed.messages), /RAW_SCORE_LEADER_START|RAW_SCORE_LEADER_END/);
});

test("packChatHistory keeps the newest user turn and drops old turns as whole pairs", () => {
  const newest = "Current instruction must survive exactly [CURRENT-INSTRUCTION]";
  const history = [
    { role: "user" as const, content: `OLD_USER_START ${"u".repeat(1_000)} OLD_USER_END` },
    { role: "assistant" as const, content: `OLD_ASSISTANT_START ${"a".repeat(1_000)} OLD_ASSISTANT_END` },
    { role: "user" as const, content: "RECENT_USER_START recent question RECENT_USER_END" },
    { role: "assistant" as const, content: "RECENT_ASSISTANT_START recent answer RECENT_ASSISTANT_END" },
    { role: "user" as const, content: newest },
  ];

  const result = packChatHistory({
    systemPrompt: "Follow-up contract.",
    context: "LOW_PRIORITY_CONTEXT",
    history,
    inputBudgetTokens: 3_000,
    opts: {},
  });

  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, new RegExp(newest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(serialized, /RECENT_USER_START[\s\S]*RECENT_USER_END/);
  assert.match(serialized, /RECENT_ASSISTANT_START[\s\S]*RECENT_ASSISTANT_END/);
  assert.doesNotMatch(serialized, /OLD_USER_START|OLD_USER_END/);
  assert.doesNotMatch(serialized, /OLD_ASSISTANT_START|OLD_ASSISTANT_END/);
  assert.ok(result.estimatedInputTokens <= 3_000);
});

test("packQueryChunks rejects an oversized current question instead of truncating it", () => {
  const question = `CURRENT_QUESTION_START${"q".repeat(5_000)}CURRENT_QUESTION_END`;

  assert.throws(() => packQueryChunks({
    question,
    systemPrompt: "contract",
    chunks: [],
    inputBudgetTokens: 2_000,
    opts: {},
  }), (error) => {
    assert.ok(error instanceof PromptBudgetExceededError);
    assert.match(error.message, /budget/i);
    assert.deepEqual(error.requiredIds, ["query:current-question"]);
    return true;
  });
});

test("answerFromContext context retries keep a strict subset with heterogeneous chunks", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) throw contextError();
          return successfulStream("strict subset answer");
        },
      },
    },
  } as unknown as LlmClient;
  const question = "Keep this heterogeneous retry question exactly";
  const systemPrompt = "Answer from complete heterogeneous citation chunks.";
  const chunks = heterogeneousQueryChunks();
  const opts = {
    semanticCompression: {
      profile: "balanced" as const,
      operation: "query" as const,
    },
  };
  const inputBudgetTokens = packQueryChunks({
    question,
    systemPrompt,
    chunks: [chunks[0]],
    inputBudgetTokens: 100_000,
    opts,
  }).estimatedInputTokens;

  const { result } = await drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: { ...opts, inputBudgetTokens },
    signal: new AbortController().signal,
    systemPrompt,
    question,
    chunks,
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(result.answer, "strict subset answer");
  assert.equal(requests.length, 2);
  const markerSets = requests.map((request) =>
    includedMarkerIds(requestText(request), "HET_QUERY"));
  assert.deepEqual([...markerSets[0]], ["LARGE"]);
  assert.ok(
    isStrictSubset(markerSets[1], markerSets[0]),
    `retry markers must be a strict subset: ${[...markerSets[0]]} -> ${[...markerSets[1]]}`,
  );
});

test("answerFromContext rerenders dynamic system metadata from each packed subset", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) throw contextError();
          return successfulStream("dynamic metadata answer");
        },
      },
    },
  } as unknown as LlmClient;
  const chunks = [repackChunk(0), repackChunk(1)];
  const renderSystemPrompt = (selected: readonly SelectedChunk[]) => [
    "DYNAMIC_QUERY_CONTRACT",
    ...selected.map((chunk) => `DYNAMIC_LINK:${chunk.articleId}`),
    ...selected.map((chunk) => `DYNAMIC_INDEX:${chunk.articleId}`),
  ].join("\n");

  const { result } = await drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: { inputBudgetTokens: 20_000 },
    signal: new AbortController().signal,
    systemPrompt: renderSystemPrompt,
    question: "Dynamic metadata current question",
    chunks,
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(requests.length, 2);
  for (const request of requests) {
    const text = requestText(request);
    const bodyIds = new Set(
      [...text.matchAll(/--- article: ([^,\s]+)/g)].map((match) => match[1]),
    );
    const linkIds = new Set(
      [...text.matchAll(/DYNAMIC_LINK:([^\s]+)/g)].map((match) => match[1]),
    );
    const indexIds = new Set(
      [...text.matchAll(/DYNAMIC_INDEX:([^\s]+)/g)].map((match) => match[1]),
    );
    assert.deepEqual(linkIds, bodyIds);
    assert.deepEqual(indexIds, bodyIds);
    assert.match(text, /DYNAMIC_QUERY_CONTRACT/);
    assert.match(text, /Dynamic metadata current question/);
  }
  assert.deepEqual(
    (result as { selectedChunks?: SelectedChunk[] }).selectedChunks,
    [chunks[0]],
  );
});

test("answerFromContext does not resend a required-only prompt after a context error", async () => {
  const requests: Record<string, unknown>[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          throw contextError();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(async () => drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: {
      inputBudgetTokens: 10_000,
      semanticCompression: { profile: "balanced", operation: "query" },
    },
    signal: new AbortController().signal,
    systemPrompt: "Required-only query contract.",
    question: "Required-only current question",
    chunks: [],
    wikiLinkValidationRetries: 0,
  })), /context/i);

  assert.equal(requests.length, 1, "required-only Query request must not be resent identically");
});

test("answerFromContext rebuilds non-stream fallback params and preserves AbortSignal", async () => {
  const calls: CapturedCall[] = [];
  const signal = new AbortController().signal;

  const { events, result } = await drainGenerator(answerFromContext({
    llm: transportFailureThenCompletion(calls),
    model: "mock",
    opts: { inputBudgetTokens: 10_000 },
    signal,
    systemPrompt: "Query fallback contract.",
    question: "Current fallback question",
    chunks: [],
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(result.answer, "fallback answer");
  assert.equal(calls[0].params.stream, true);
  assert.deepEqual(calls[0].params.stream_options, { include_usage: true });
  assert.equal(calls[0].signal, signal);
  assertCleanFallback(calls, signal);
  const budget = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.actualInputTokens, 444);
  const stats = events.filter((event) => event.kind === "llm_call_stats");
  assert.equal(stats.length, 1);
  assert.equal(stats[0].kind === "llm_call_stats" ? stats[0].inputTokens : undefined, 444);
  assert.equal(stats[0].kind === "llm_call_stats" ? stats[0].outputTokens : undefined, 7);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.llmCallStats?.inputTokens, 444);
  assert.equal(result.llmCallStats?.outputTokens, 7);
});

test("runLintChat rebuilds non-stream fallback params and preserves AbortSignal", async () => {
  const calls: CapturedCall[] = [];
  const signal = new AbortController().signal;

  const { events } = await drainGenerator(runLintChat(
    transportFailureThenCompletion(calls),
    "mock",
    undefined,
    signal,
    { inputBudgetTokens: 10_000 },
    "",
    [{ role: "user", content: "Current Chat fallback instruction" }],
    "Chat fallback contract",
  ));

  assert.equal(calls[0].params.stream, true);
  assert.deepEqual(calls[0].params.stream_options, { include_usage: true });
  assert.equal(calls[0].signal, signal);
  assertCleanFallback(calls, signal);
  const budget = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.actualInputTokens, 444);
  const stats = events.filter((event) => event.kind === "llm_call_stats");
  assert.equal(stats.length, 1);
  assert.equal(stats[0].kind === "llm_call_stats" ? stats[0].inputTokens : undefined, 444);
  assert.equal(stats[0].kind === "llm_call_stats" ? stats[0].outputTokens : undefined, 7);
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.equal(result.outputTokens, 7);
});

test("mobile Query fallback reaches the inner client without stream options and with AbortSignal", async () => {
  const calls: CapturedCall[] = [];
  const signal = new AbortController().signal;
  const mobileLlm = wrapMobileNoStream(transportFailureThenCompletion(calls));

  const { result } = await drainGenerator(answerFromContext({
    llm: mobileLlm,
    model: "mock",
    opts: { inputBudgetTokens: 10_000 },
    signal,
    systemPrompt: "Mobile fallback contract.",
    question: "Current mobile fallback question",
    chunks: [],
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(result.answer, "fallback answer");
  assert.equal(calls[0].params.stream, false);
  assert.equal("stream_options" in calls[0].params, false);
  assert.equal(calls[0].signal, signal);
  assertCleanFallback(calls, signal);
});

test("answerFromContext yields the first visible delta before the provider stream completes", async () => {
  const firstProduced = deferred();
  const releaseProvider = deferred();
  const llm = {
    chat: {
      completions: {
        create: async () => (async function* () {
          firstProduced.resolve();
          yield streamChunk("QUERY_LIVE_FIRST");
          await releaseProvider.promise;
          yield streamChunk("QUERY_LIVE_SECOND");
          yield usageChunk();
        })(),
      },
    },
  } as unknown as LlmClient;
  const generator = answerFromContext({
    llm,
    model: "mock",
    opts: { inputBudgetTokens: 10_000 },
    signal: new AbortController().signal,
    systemPrompt: "Live Query contract.",
    question: "Live Query question",
    chunks: [],
    wikiLinkValidationRetries: 0,
  });
  const firstAssistant = nextAssistantEvent(generator);

  await firstProduced.promise;
  const beforeRelease = await Promise.race([
    firstAssistant.then(() => "visible" as const),
    new Promise<"blocked">((resolve) => setImmediate(() => resolve("blocked"))),
  ]);
  releaseProvider.resolve();
  const event = await firstAssistant;
  await drainRemaining(generator);

  assert.equal(beforeRelease, "visible");
  assert.equal(event.delta, "QUERY_LIVE_FIRST");
});

test("runLintChat yields the first visible delta before the provider stream completes", async () => {
  const firstProduced = deferred();
  const releaseProvider = deferred();
  const llm = {
    chat: {
      completions: {
        create: async () => (async function* () {
          firstProduced.resolve();
          yield streamChunk("CHAT_LIVE_FIRST");
          await releaseProvider.promise;
          yield streamChunk("CHAT_LIVE_SECOND");
          yield usageChunk();
        })(),
      },
    },
  } as unknown as LlmClient;
  const generator = runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    { inputBudgetTokens: 10_000 },
    "",
    [{ role: "user", content: "Live Chat instruction" }],
    "Live Chat contract",
  );
  const firstAssistant = nextAssistantEvent(generator);

  await firstProduced.promise;
  const beforeRelease = await Promise.race([
    firstAssistant.then(() => "visible" as const),
    new Promise<"blocked">((resolve) => setImmediate(() => resolve("blocked"))),
  ]);
  releaseProvider.resolve();
  const event = await firstAssistant;
  await drainRemaining(generator);

  assert.equal(beforeRelease, "visible");
  assert.equal(event.delta, "CHAT_LIVE_FIRST");
});

test("live Query preserves prompt usage, output usage, and result semantics", async () => {
  const llm = {
    chat: {
      completions: {
        create: async () => successfulStream("QUERY_USAGE_ANSWER"),
      },
    },
  } as unknown as LlmClient;

  const { events, result } = await drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: { inputBudgetTokens: 10_000 },
    signal: new AbortController().signal,
    systemPrompt: "Query usage contract.",
    question: "Query usage question",
    chunks: [],
    wikiLinkValidationRetries: 0,
  }));

  const budget = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.actualInputTokens, 100);
  const stats = events.find((event) => event.kind === "llm_call_stats");
  assert.ok(stats && stats.kind === "llm_call_stats");
  assert.equal(stats.inputTokens, 100);
  assert.equal(stats.outputTokens, 5);
  assert.equal(result.answer, "QUERY_USAGE_ANSWER");
  assert.equal(result.outputTokens, 5);
});

test("live Chat preserves prompt usage, output usage, and result semantics", async () => {
  const llm = {
    chat: {
      completions: {
        create: async () => successfulStream("CHAT_USAGE_ANSWER"),
      },
    },
  } as unknown as LlmClient;

  const { events } = await drainGenerator(runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    { inputBudgetTokens: 10_000 },
    "",
    [{ role: "user", content: "Chat usage instruction" }],
    "Chat usage contract",
  ));

  const budget = events.find((event) => event.kind === "prompt_budget");
  assert.ok(budget && budget.kind === "prompt_budget");
  assert.equal(budget.actualInputTokens, 100);
  const stats = events.find((event) => event.kind === "llm_call_stats");
  assert.ok(stats && stats.kind === "llm_call_stats");
  assert.equal(stats.inputTokens, 100);
  assert.equal(stats.outputTokens, 5);
  const result = events.find((event) => event.kind === "result");
  assert.ok(result && result.kind === "result");
  assert.equal(result.text, "CHAT_USAGE_ANSWER");
  assert.equal(result.outputTokens, 5);
});

test("answerFromContext does not repack a context error after a visible delta", async () => {
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          if (calls > 1) return successfulStream("QUERY_RETRY_MUST_NOT_RUN");
          return (async function* () {
            yield streamChunk("QUERY_VISIBLE_BEFORE_ERROR");
            throw contextError();
          })();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(async () => {
    for await (const event of answerFromContext({
      llm,
      model: "mock",
      opts: { inputBudgetTokens: 10_000 },
      signal: new AbortController().signal,
      systemPrompt: "Late Query error contract.",
      question: "Late Query error question",
      chunks: [repackChunk(0)],
      wikiLinkValidationRetries: 0,
    })) {
      events.push(event);
    }
  }, /context/i);

  assert.equal(calls, 1);
  assert.equal(
    events.some((event) =>
      event.kind === "assistant_text" && event.delta === "QUERY_VISIBLE_BEFORE_ERROR"),
    true,
  );
  assert.equal(
    events.some((event) =>
      event.kind === "assistant_text" && event.delta === "QUERY_RETRY_MUST_NOT_RUN"),
    false,
  );
});

test("runLintChat does not fall back or replay after a visible delta", async () => {
  const events: RunEvent[] = [];
  let calls = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls += 1;
          if ((params as { stream?: boolean }).stream === false) {
            return completion("CHAT_FALLBACK_MUST_NOT_RUN");
          }
          return (async function* () {
            yield streamChunk("CHAT_VISIBLE_BEFORE_ERROR");
            throw new Error("late chat transport failure");
          })();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(async () => {
    for await (const event of runLintChat(
      llm,
      "mock",
      undefined,
      new AbortController().signal,
      { inputBudgetTokens: 10_000 },
      "",
      [{ role: "user", content: "Late Chat error instruction" }],
      "Late Chat error contract",
    )) {
      events.push(event);
    }
  }, /late chat transport failure/);

  assert.equal(calls, 1);
  assert.equal(
    events.some((event) =>
      event.kind === "assistant_text" && event.delta === "CHAT_VISIBLE_BEFORE_ERROR"),
    true,
  );
  assert.equal(
    events.some((event) =>
      event.kind === "assistant_text" && event.delta === "CHAT_FALLBACK_MUST_NOT_RUN"),
    false,
  );
});

test("answerFromContext repacks complete chunks below provider boundaries and keeps the question", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt <= 2) throw contextError();
          return successfulStream("bounded answer");
        },
      },
    },
  } as unknown as LlmClient;
  const question = "Keep this current question exactly [QUERY-REPACK]";

  const { events, result } = await drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: {
      inputBudgetTokens: 5_000,
      semanticCompression: { profile: "balanced", operation: "query" },
    },
    signal: new AbortController().signal,
    systemPrompt: "Answer with complete citation support.",
    question,
    chunks: Array.from({ length: 8 }, (_, index) => repackChunk(index)),
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(result.answer, "bounded answer");
  assert.equal(requests.length, 3);
  assert.equal(requests.every((request) => request.stream === true), true);
  const texts = requests.map(requestText);
  assert.equal(texts.every((text) => text.includes(question)), true);
  const counts = texts.map(includedRepackChunks);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `chunk counts: ${counts.join(", ")}`);
  for (const text of texts) {
    for (let index = 0; index < 8; index++) {
      assert.equal(
        text.includes(`REPACK_CHUNK_${index}_START`),
        text.includes(`REPACK_CHUNK_${index}_END`),
        `chunk ${index} must stay complete`,
      );
    }
  }
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length, 3);
  assert.deepEqual(
    budgetEvents.map((event) => event.retryReason),
    ["provider_context_error", "provider_context_error", undefined],
  );
  assert.equal(
    budgetEvents.every((event) => event.estimatedInputTokens <= event.effectiveInputBudget),
    true,
  );
});

test("answerFromContext repacks a context error raised while consuming the stream", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) {
            return (async function* (): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
              throw contextError();
            })();
          }
          return successfulStream("iteration repacked answer");
        },
      },
    },
  } as unknown as LlmClient;
  const question = "Keep this question during stream iteration repack";

  const { events, result } = await drainGenerator(answerFromContext({
    llm,
    model: "mock",
    opts: {
      inputBudgetTokens: 5_000,
      semanticCompression: { profile: "balanced", operation: "query" },
    },
    signal: new AbortController().signal,
    systemPrompt: "Answer from complete chunks.",
    question,
    chunks: Array.from({ length: 6 }, (_, index) => repackChunk(index)),
    wikiLinkValidationRetries: 0,
  }));

  assert.equal(result.answer, "iteration repacked answer");
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.stream === true), true);
  assert.equal(requests.map(requestText).every((text) => text.includes(question)), true);
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.deepEqual(
    budgetEvents.map((event) => event.retryReason),
    ["provider_context_error", undefined],
  );
});

test("runLintChat context retries keep a strict subset with heterogeneous history", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) throw contextError();
          return successfulStream("strict chat subset answer");
        },
      },
    },
  } as unknown as LlmClient;
  const operationHeader = "Query answer (query)";
  const current = {
    role: "user" as const,
    content: "HETEROGENEOUS CURRENT CHAT INSTRUCTION",
  };
  const smallPairs = Array.from(
    { length: 8 },
    (_, index) => chatPair(`SMALL_${index}`, 80, 80),
  ).flat();
  const mediumPair = chatPair("MEDIUM", 250, 250);
  const giantPair = chatPair("GIANT", 1_800, 1_800);
  const history = [...smallPairs, ...mediumPair, ...giantPair, current];
  const opts = {
    semanticCompression: {
      profile: "balanced" as const,
      operation: "query" as const,
    },
  };
  const systemPrompt = render(chatTemplate, {
    operation_header: operationHeader,
    context: "",
  });
  const inputBudgetTokens = packChatHistory({
    systemPrompt,
    context: "",
    history: [...mediumPair, ...giantPair, current],
    inputBudgetTokens: 100_000,
    opts,
  }).estimatedInputTokens;

  await drainGenerator(runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    { ...opts, inputBudgetTokens },
    "",
    history,
    operationHeader,
  ));

  assert.equal(requests.length, 2);
  const markerSets = requests.map((request) =>
    includedMarkerIds(requestText(request), "HET_CHAT_UNIT"));
  assert.deepEqual([...markerSets[0]], ["MEDIUM", "GIANT"]);
  assert.ok(
    isStrictSubset(markerSets[1], markerSets[0]),
    `retry markers must be a strict subset: ${[...markerSets[0]]} -> ${[...markerSets[1]]}`,
  );
});

test("runLintChat does not resend required-only chat after a context error", async () => {
  const requests: Record<string, unknown>[] = [];
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          throw contextError();
        },
      },
    },
  } as unknown as LlmClient;

  await assert.rejects(async () => drainGenerator(runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    {
      inputBudgetTokens: 10_000,
      semanticCompression: { profile: "balanced", operation: "lint" },
    },
    "",
    [{ role: "user", content: "Required-only current chat instruction" }],
    "Wiki lint check",
  )), /context/i);

  assert.equal(requests.length, 1, "required-only Chat request must not be resent identically");
});

test("runLintChat repacks whole history after a stream context error without non-stream fallback", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) throw contextError();
          return successfulStream("chat answer");
        },
      },
    },
  } as unknown as LlmClient;
  const currentInstruction = "CURRENT_CHAT_INSTRUCTION must survive exactly";
  const operationHeader = "Query answer (query)";
  const history = [
    { role: "user" as const, content: `RECENT_CHAT_USER_START ${"u".repeat(800)} RECENT_CHAT_USER_END` },
    { role: "assistant" as const, content: `RECENT_CHAT_ASSISTANT_START ${"a".repeat(800)} RECENT_CHAT_ASSISTANT_END` },
    { role: "user" as const, content: currentInstruction },
  ];

  const { events } = await drainGenerator(runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    {
      inputBudgetTokens: 5_000,
      semanticCompression: { profile: "balanced", operation: "query" },
    },
    `PRIOR_CONTEXT_START ${"c".repeat(800)} PRIOR_CONTEXT_END`,
    history,
    operationHeader,
  ));

  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.stream === true), true);
  const texts = requests.map(requestText);
  assert.equal(texts.every((text) => text.includes(currentInstruction)), true);
  assert.equal(texts.every((text) => text.includes(operationHeader)), true);
  assert.ok(texts[0].length > texts[1].length);
  for (const text of texts) {
    assert.equal(
      text.includes("RECENT_CHAT_USER_START"),
      text.includes("RECENT_CHAT_ASSISTANT_START"),
      "history pair must stay whole",
    );
  }
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.equal(budgetEvents.length, 2);
  assert.deepEqual(
    budgetEvents.map((event) => event.retryReason),
    ["provider_context_error", undefined],
  );
});

test("runLintChat repacks a context error raised while consuming the stream", async () => {
  const requests: Record<string, unknown>[] = [];
  let attempt = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          requests.push(params as Record<string, unknown>);
          attempt += 1;
          if (attempt === 1) {
            return (async function* (): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
              throw contextError();
            })();
          }
          return successfulStream("chat iteration repacked");
        },
      },
    },
  } as unknown as LlmClient;
  const currentInstruction = "CURRENT CHAT ITERATION INSTRUCTION";

  const { events } = await drainGenerator(runLintChat(
    llm,
    "mock",
    undefined,
    new AbortController().signal,
    {
      inputBudgetTokens: 5_000,
      semanticCompression: { profile: "balanced", operation: "query" },
    },
    `ITERATION_CONTEXT ${"c".repeat(800)}`,
    [
      { role: "user", content: `OLDER_USER ${"u".repeat(800)}` },
      { role: "assistant", content: `OLDER_ASSISTANT ${"a".repeat(800)}` },
      { role: "user", content: currentInstruction },
    ],
    "Query answer (query)",
  ));

  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.stream === true), true);
  assert.equal(requests.map(requestText).every((text) => text.includes(currentInstruction)), true);
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.deepEqual(
    budgetEvents.map((event) => event.retryReason),
    ["provider_context_error", undefined],
  );
});
