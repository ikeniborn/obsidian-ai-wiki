import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { z } from "zod";
import type { LlmClient, RunEvent } from "../src/types";
import { parseAnswerFrames } from "../src/phases/framed-output";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { parseWithRetry } = await import("../src/phases/parse-with-retry");
const {
  runStructuredWithRetry,
  StructuredValidationError,
} = await import("../src/phases/structured-output");

const SmallSchema = z.object({
  value: z.string(),
});

const AnswerSchema = z.object({
  reasoning: z.string(),
  answer_markdown: z.string(),
  citations: z.array(z.string()),
});

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function llmFromAttempts(attempts: Array<string | Error>, seenParams: Record<string, unknown>[] = []): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          seenParams.push(params as Record<string, unknown>);
          const next = attempts[i++] ?? "";
          if (next instanceof Error) throw next;
          return (async function* () {
            if (next) yield chunk(next);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

function isTestJsonModeError(e: unknown): boolean {
  return Boolean(
    e
      && typeof e === "object"
      && (e as { status?: unknown }).status === 400
      && String((e as { message?: unknown }).message ?? "").includes("response_format"),
  );
}

function jsonModeError(): Error & { status: number } {
  const err = new Error("response_format json_object is unsupported in json mode") as Error & { status: number };
  err.status = 400;
  return err;
}

test("json-zod valid JSON succeeds without structural error", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":"ok"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "ok");
  assert.equal(events.some((ev) => ev.kind === "structural_error"), false);
  assert.equal(events.some((ev) => ev.kind === "llm_call_stats"), true);
});

test("empty JSON output downgrades response formats and validates recovered JSON", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["", "", '{"value":"recovered"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 2,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "recovered");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "empty_output"),
    true,
  );
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object", "none"],
  );
});

test("backend json-mode error downgrades and recovers", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts([jsonModeError(), '{"value":"fallback"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "fallback");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object"],
  );
});

test("schema retry recovery emits succeeded structural_error event", async () => {
  const events: RunEvent[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":42}', '{"value":"recovered"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "recovered");
  assert.equal(
    events.some((ev) =>
      ev.kind === "structural_error"
      && ev.errorType === "schema_validate"
      && ev.retryAttempt === 1
      && ev.succeeded === true
      && ev.message === "retry succeeded"),
    true,
  );
});

test("json-zod with jsonMode unset starts with json_schema response_format", async () => {
  const seenParams: Record<string, unknown>[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal((seenParams[0]?.response_format as { type?: string } | undefined)?.type, "json_schema");
});

test("json-zod with jsonMode false sends no response_format", async () => {
  const seenParams: Record<string, unknown>[] = [];

  await parseWithRetry({
    llm: llmFromAttempts(['{"value":"plain"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: false },
    schema: SmallSchema,
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(seenParams[0]?.response_format, undefined);
});

test("runner emits response-format fallback without hidden client wrapper", async () => {
  const events: RunEvent[] = [];
  const seenParams: Record<string, unknown>[] = [];

  const result = await runStructuredWithRetry({
    llm: llmFromAttempts([jsonModeError(), '{"value":"visible"}'], seenParams),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "visible");
  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"),
    true,
  );
  assert.deepEqual(
    seenParams.map((params) => (params.response_format as { type?: string } | undefined)?.type ?? "none"),
    ["json_schema", "json_object"],
  );
});

test("framed-zod parses parseAnswerFrames and validates schema", async () => {
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["<<<ANSWER>>>\nAnswer\n<<<CITATIONS>>>\n- wiki_a\n<<<END>>>"]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: {
      kind: "framed-zod",
      schema: AnswerSchema,
      parse: parseAnswerFrames,
      repairInstruction: "Return answer frames only.",
    },
    maxRetries: 1,
    callSite: "query.answer",
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.equal(result.value.answer_markdown, "Answer");
  assert.deepEqual(result.value.citations, ["wiki_a"]);
});

test("framed-zod invalid frames emit frame_parse and throw StructuredValidationError", async () => {
  const events: RunEvent[] = [];

  await assert.rejects(
    runStructuredWithRetry({
      llm: llmFromAttempts(["bad", "still bad"]),
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: {},
      profile: {
        kind: "framed-zod",
        schema: AnswerSchema,
        parse: parseAnswerFrames,
        repairInstruction: "Return answer frames only.",
      },
      maxRetries: 1,
      callSite: "query.answer",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
    }),
    StructuredValidationError,
  );

  assert.equal(
    events.some((ev) => ev.kind === "structural_error" && ev.errorType === "frame_parse"),
    true,
  );
});

function reasoningChunk(reasoning: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "r", object: "chat.completion.chunk", created: 0, model: "m",
    choices: [{ index: 0, delta: { reasoning } as unknown as OpenAI.Chat.ChatCompletionChunk.Choice.Delta, finish_reason: null }],
  };
}

test("streaming structured call emits reasoning and content deltas live", async () => {
  const events: RunEvent[] = [];
  const llm = {
    chat: { completions: { create: async () => (async function* () {
      yield reasoningChunk("thinking hard");
      yield chunk('{"value":"ok"}');
      yield usageChunk();
    })() } },
  } as unknown as LlmClient;

  const result = await runStructuredWithRetry({
    llm, model: "m", baseMessages: [{ role: "user", content: "x" }],
    opts: {}, profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1, callSite: "query.seeds",
    signal: new AbortController().signal, onEvent: (ev) => events.push(ev),
  });

  assert.equal(result.value.value, "ok");
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && ev.isReasoning === true && ev.delta === "thinking hard"),
    true,
  );
  assert.equal(
    events.some((ev) => ev.kind === "assistant_text" && !ev.isReasoning && ev.delta.includes('"value"')),
    true,
  );
});
