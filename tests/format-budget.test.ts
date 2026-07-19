import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import { APIConnectionError } from "openai";
import type { LlmCallOptions, LlmClient, RunEvent } from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { runFormat } = await import("../src/phases/format");

function chunk(content: string, finishReason: OpenAI.Chat.Completions.ChatCompletionChunk.Choice["finish_reason"] = null): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  };
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  } as OpenAI.Chat.ChatCompletionChunk;
}

function nonStreamResponse(content: string, promptTokens = 13, completionTokens = 5): OpenAI.Chat.ChatCompletion {
  return {
    id: "completion",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{
      index: 0,
      message: { role: "assistant", content, refusal: null },
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  } as OpenAI.Chat.ChatCompletion;
}

function providerContextError(): Error & { status?: number; code?: string } {
  const error = new Error("prompt size 12000 tokens exceeds maximum context 10000") as Error & { status?: number; code?: string };
  error.status = 400;
  error.code = "context_length_exceeded";
  return error;
}

class MemoryAdapter implements VaultAdapter {
  files = new Map<string, string>();
  writes: Array<{ path: string; data: string }> = [];

  constructor(entries: Record<string, string>) {
    for (const [path, content] of Object.entries(entries)) this.files.set(path, content);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.writes.push({ path, data });
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ""}${data}`);
  }

  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || path === "notes";
  }

  async mkdir(): Promise<void> {}
}

function textFromUserMessage(params: Record<string, unknown>): string {
  const messages = params.messages as OpenAI.Chat.ChatCompletionMessageParam[];
  const user = messages.findLast((message) => message.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  if (Array.isArray(user.content)) {
    return user.content
      .map((part) => ("text" in part && typeof part.text === "string") ? part.text : "")
      .join("\n");
  }
  return "";
}

function frame(report: string, formatted: string): string {
  return [
    "<<<REPORT>>>",
    report,
    "<<<FORMATTED>>>",
    formatted,
    "<<<END>>>",
  ].join("\n");
}

function segmentFrame(segmentId: string, report: string, formatted: string): string {
  return [
    "<<<SEGMENT_ID>>>",
    segmentId,
    "<<<REPORT>>>",
    report,
    "<<<FORMATTED>>>",
    formatted,
    "<<<END>>>",
  ].join("\n");
}

function llmWithResponder(
  responder: (params: Record<string, unknown>, callIndex: number) => string,
  seenParams: Record<string, unknown>[],
): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => {
          const typed = params as Record<string, unknown>;
          seenParams.push(typed);
          const text = responder(typed, seenParams.length - 1);
          return (async function* () {
            yield chunk(text);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

function llmWithCreate(
  create: (
    params: Record<string, unknown>,
    callIndex: number,
    callOpts?: { signal?: AbortSignal },
  ) => AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion | Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | OpenAI.Chat.ChatCompletion>,
  seenParams: Record<string, unknown>[],
  seenSignals?: Array<AbortSignal | undefined>,
): LlmClient {
  return {
    chat: {
      completions: {
        create: async (params: unknown, callOpts?: { signal?: AbortSignal }) => {
          const typed = params as Record<string, unknown>;
          seenParams.push(typed);
          seenSignals?.push(callOpts?.signal);
          return create(typed, seenParams.length - 1, callOpts);
        },
      },
    },
  } as unknown as LlmClient;
}

async function collectFormatEvents(
  source: string,
  llm: LlmClient,
  inputBudgetTokens: number,
  adapter = new MemoryAdapter({ "notes/source.md": source }),
  extraOpts: LlmCallOptions = {},
  hasVision = false,
  signal = new AbortController().signal,
) {
  const events: RunEvent[] = [];
  for await (const event of runFormat(
    ["notes/source.md"],
    new VaultTools(adapter, "/vault"),
    llm,
    "m",
    hasVision,
    [],
    signal,
    { inputBudgetTokens, ...extraOpts },
  )) {
    events.push(event);
  }
  return { events, adapter };
}

function assertFormatLifecycleIntegrity(events: RunEvent[]): void {
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  for (const id of new Set(lifecycle.map((event) => event.id))) {
    const phases = lifecycle.filter((event) => event.id === id).map((event) => event.phase);
    if (phases.at(-1) === "completed") {
      assert.deepEqual(phases, [
        "preparing", "sent", "waiting", "producing", "validating", "applying", "completed",
      ]);
    }
    assert.equal(phases.filter((phase) =>
      ["completed", "retrying", "failed", "cancelled"].includes(phase)).length, 1);
  }
}

test("Format generic pre-chunk incompatibility falls back once with AbortSignal", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const seenSignals: Array<AbortSignal | undefined> = [];
  const signal = new AbortController().signal;
  const original = [
    "---",
    "tags: [fallback]",
    "---",
    "# Generic fallback",
    "",
    "Keep this line.",
  ].join("\n");

  const { adapter, events } = await collectFormatEvents(
    original,
    llmWithCreate((params) => {
      if (params.stream !== false) throw new Error("stream transport unavailable");
      return nonStreamResponse(frame("- fallback", original));
    }, seenParams, seenSignals),
    20_000,
    undefined,
    {},
    false,
    signal,
  );

  assert.ok(seenParams.length >= 2 && seenParams.length % 2 === 0);
  for (let index = 0; index < seenParams.length; index += 2) {
    assert.deepEqual(
      seenParams.slice(index, index + 2).map((params) => params.stream),
      [true, false],
    );
  }
  assert.ok(seenSignals.every((seenSignal) => seenSignal === signal));
  assert.equal(adapter.writes.length, 1);
  assertFormatLifecycleIntegrity(events);
});

test("Format HTTP 502 failure is sent exactly once", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const error = Object.assign(new Error("Bad Gateway"), { status: 502 });

  await assert.rejects(collectFormatEvents(
    "# HTTP failure",
    llmWithCreate(() => {
      throw error;
    }, seenParams),
    20_000,
  ), error);

  assert.equal(seenParams.length, 1);
});

test("Format OpenAI connection failure is sent exactly once", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const error = new APIConnectionError({ message: "Connection failed" });

  await assert.rejects(collectFormatEvents(
    "# Connection failure",
    llmWithCreate(() => {
      throw error;
    }, seenParams),
    20_000,
  ), error);

  assert.equal(seenParams.length, 1);
});

test("Format partial stream failure is propagated without replay", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const error = new Error("stream transport unavailable");

  await assert.rejects(collectFormatEvents(
    "# Partial failure",
    llmWithCreate((params) => {
      if (params.stream === false) {
        return nonStreamResponse(frame("- replayed", "# Must not be written"));
      }
      return (async function* () {
        yield chunk("<<<REPORT>>>\n- partial");
        throw error;
      })();
    }, seenParams),
    20_000,
  ), error);

  assert.equal(seenParams.length, 1);
});

test("Format abort does not trigger non-stream fallback", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const controller = new AbortController();

  const { adapter } = await collectFormatEvents(
    "# Abort",
    llmWithCreate(() => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }, seenParams),
    20_000,
    undefined,
    {},
    false,
    controller.signal,
  );

  assert.equal(seenParams.length, 1);
  assert.deepEqual(adapter.writes, []);
});

test("format keeps whole-file behavior when prepared input fits budget", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [fit]",
    "---",
    "# Fit",
    "",
    "AlphaToken stays in one request.",
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithResponder(() => frame("- whole", original), seenParams),
    20_000,
  );

  assert.equal(seenParams.length, 1);
  assert.match(textFromUserMessage(seenParams[0]), /AlphaToken stays in one request/);
  assert.deepEqual(adapter.writes.map((write) => write.path), ["notes/source.formatted.md"]);
  assert.equal(adapter.files.get("notes/source.md"), original);
  assert.ok(events.some((event) => event.kind === "format_preview"));
});

test("format fast path preserves pre-segmentation basename embed behavior", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [fit]",
    "---",
    "# Fit",
    "",
    "Original ![[assets/diagram.png]] reference.",
  ].join("\n");
  const formatted = [
    "---",
    "tags: [fit]",
    "---",
    "# Fit",
    "",
    "Original ![[diagram.png]] reference.",
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder(() => frame("- whole", formatted), seenParams),
    20_000,
  );

  assert.equal(seenParams.length, 1);
  assert.match(adapter.writes[0].data, /!\[\[diagram\.png]]/);
  assert.doesNotMatch(adapter.writes[0].data, /!\[\[assets\/diagram\.png]]/);
});

test("format segments oversized H2 notes and never sends the full note to one model call", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [oversized]",
    "source: external-note",
    "---",
    "# Oversized",
    "",
    "PreambleToken",
    "",
    "## One",
    "AlphaUniqueToken ![[one.png]]",
    "",
    "## Two",
    Array.from({ length: 80 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      assert.ok(!userText.includes("AlphaUniqueToken") || !userText.includes("BetaUniqueToken79"), "full oversized note was sent");
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1];
      assert.ok(id, "segment calls must carry a segment id");
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      assert.ok(segment.length > 0, "segment calls must carry bounded source markdown");
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
  );

  assert.ok(seenParams.length > 1);
  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.writes[0].path, "notes/source.formatted.md");
  assert.match(adapter.writes[0].data, /^---\ntags: \[oversized]\nsource: external-note\n---/);
  assert.match(adapter.writes[0].data, /AlphaUniqueToken !\[\[one.png]]/);
  assert.match(adapter.writes[0].data, /BetaUniqueToken79/);
  assert.equal(adapter.files.get("notes/source.md"), original);
});

test("format creates no temp preview or source write when a segment response fails", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [failure]",
    "---",
    "# Failure",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");
  const adapter = new MemoryAdapter({ "notes/source.md": original });

  const { events } = await collectFormatEvents(
    original,
    llmWithResponder((params, callIndex) => {
      if (callIndex === 1 || callIndex === 2) return "malformed segment output";
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
    adapter,
  );

  assert.ok(seenParams.length > 1);
  assert.deepEqual(adapter.writes, []);
  assert.equal(adapter.files.get("notes/source.md"), original);
  assert.ok(events.some((event) => event.kind === "error" && /segment/i.test(event.message)));
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.phase, "failed");
  assertFormatLifecycleIntegrity(events);
});

test("segmented Format fails the prior validated lifecycle when the next segment preflight is irreducible", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [preflight-finalizer]",
    "---",
    "## Small",
    "AlphaUniqueToken",
    "",
    "```text",
    "HugeToken " + Array.from({ length: 30_000 }, () => "oversized").join(" "),
    "```",
  ].join("\n");
  const adapter = new MemoryAdapter({ "notes/source.md": original });
  const { events } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
    adapter,
  );

  assert.equal(seenParams.length, 1, "second segment must fail before transport");
  assert.deepEqual(adapter.writes, []);
  assert.equal(events.some((event) => event.kind === "format_preview"), false);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(new Set(lifecycle.map((event) => event.id)).size, 1);
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "failed",
  ], JSON.stringify(events));
  assertFormatLifecycleIntegrity(events);
});

test("segmented Format cancels the prior validated lifecycle before the next segment request", async () => {
  const controller = new AbortController();
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [segment-abort]",
    "---",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");
  const adapter = new MemoryAdapter({ "notes/source.md": original });
  const generator = runFormat(
    ["notes/source.md"],
    new VaultTools(adapter, "/vault"),
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    "m",
    false,
    [],
    controller.signal,
    { inputBudgetTokens: 10_000 },
  );
  const events: RunEvent[] = [];
  while (true) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (next.done) break;
    events.push(next.value);
    if (next.value.kind === "tool_result"
      && next.value.ok
      && next.value.preview?.startsWith("segment-0:")) {
      controller.abort();
      break;
    }
  }
  for await (const event of generator) events.push(event);

  assert.equal(seenParams.length, 1);
  assert.deepEqual(adapter.writes, []);
  assert.equal(events.some((event) => event.kind === "format_preview"), false);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.deepEqual(lifecycle.map((event) => event.phase), [
    "preparing", "sent", "waiting", "producing", "validating", "cancelled",
  ], JSON.stringify(events));
  assertFormatLifecycleIntegrity(events);
});

test("Format preview write failure closes the validated request as failed", async () => {
  const original = "# Source\n\nBody";
  const adapter = new MemoryAdapter({ "notes/source.md": original });
  adapter.write = async () => {
    throw new Error("write denied");
  };
  const { events } = await collectFormatEvents(
    original,
    llmWithResponder(() => frame("- report", "# Formatted\n\nBody"), []),
    10_000,
    adapter,
  );
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.phase, "failed");
  assertFormatLifecycleIntegrity(events);
  assert.equal(events.some((event) => event.kind === "format_preview"), false);
});

test("Format synchronous streaming invocation failure emits waiting before failed", async () => {
  const error = Object.assign(new Error("sync create failed"), { status: 502 });
  const llm = {
    chat: {
      completions: {
        create: () => {
          throw error;
        },
      },
    },
  } as unknown as LlmClient;
  const events: RunEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of runFormat(
      ["notes/source.md"],
      new VaultTools(new MemoryAdapter({ "notes/source.md": "# Source\n\nBody" }), "/vault"),
      llm,
      "m",
      false,
      [],
      new AbortController().signal,
      { inputBudgetTokens: 10_000 },
    )) {
      events.push(event);
    }
  }, error);

  assert.deepEqual(
    events
      .filter((event) => event.kind === "llm_lifecycle")
      .map((event) => event.kind === "llm_lifecycle" ? [event.action, event.phase] : []),
    [
      ["format_note", "preparing"],
      ["format_note", "sent"],
      ["format_note", "waiting"],
      ["format_note", "failed"],
    ],
  );
});

test("Format closes validated lifecycle when restore parameter construction exceeds budget", async () => {
  const original = "---\ntags: [restore]\n---\n# Source\n\nUniqueRestoreToken";
  const { events } = await collectFormatEvents(
    original,
    llmWithResponder(() => frame(
      "- report",
      `---\ntags: [restore]\n---\n# Formatted\n\n${"x".repeat(100_000)}`,
    ), []),
    10_000,
  );

  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.phase, "failed");
  assertFormatLifecycleIntegrity(events);
  assert.equal(events.some((event) =>
    event.kind === "error" && /budget/i.test(event.message)), true);
  assert.equal(events.some((event) => event.kind === "format_preview"), false);
});

test("Format abort during token restoration stops before preview", async () => {
  const original = "# Source\n\nUniqueRestoreToken";
  const controller = new AbortController();
  const seen: Record<string, unknown>[] = [];
  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithCreate((_params, callIndex) => {
      if (callIndex === 0) {
        return (async function* () {
          yield chunk(frame("- report", "# Formatted"));
        })();
      }
      return (async function* () {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      })();
    }, seen),
    10_000,
    undefined,
    {},
    false,
    controller.signal,
  );

  assert.equal(seen.length, 2);
  assert.deepEqual(adapter.writes, []);
  assert.equal(events.some((event) => event.kind === "format_preview"), false);
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.equal(lifecycle.at(-1)?.phase, "cancelled");
  assertFormatLifecycleIntegrity(events);
});

test("format retries a malformed complete segment frame once with correction context", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const attemptsById = new Map<string, number>();
  const original = [
    "---",
    "tags: [retry]",
    "---",
    "# Retry",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1] ?? "segment-0";
      const attempts = attemptsById.get(id) ?? 0;
      attemptsById.set(id, attempts + 1);
      if (id === "segment-1" && attempts === 0) return segmentFrame("wrong-id", "- wrong", "bad");
      if (id === "segment-1") {
        const system = ((params.messages as OpenAI.Chat.ChatCompletionMessageParam[])[0].content ?? "").toString();
        assert.match(system, /previous segment attempt failed/i);
      }
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
  );

  assert.equal(attemptsById.get("segment-1"), 2);
  assert.equal(adapter.writes.length, 1);
});

test("segmented correction provider context errors split into narrower calls", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const attemptsById = new Map<string, number>();
  let targetId = "";
  const original = [
    "---",
    "tags: [correction-context]",
    "---",
    "# Correction Context",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 90 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(50)}`).join("\n"),
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithCreate((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      if (!targetId && segment.includes("BetaUniqueToken0")) targetId = id;
      const attempts = attemptsById.get(id) ?? 0;
      attemptsById.set(id, attempts + 1);

      if (params.stream === false) throw new Error("segment context errors must not use identical non-stream fallback");
      if (id === targetId && attempts === 0) {
        return (async function* () {
          yield chunk(segmentFrame("wrong-id", "- wrong", "bad"));
          yield usageChunk();
        })();
      }
      if (id === targetId && attempts === 1) throw providerContextError();

      return (async function* () {
        yield chunk(segmentFrame(id, `- formatted ${id}`, segment));
        yield usageChunk();
      })();
    }, seenParams),
    10_000,
  );

  assert.equal(attemptsById.get(targetId), 2);
  assert.ok(seenParams.some((params) => new RegExp(`Segment ID:\\s*${targetId}-0`).test(textFromUserMessage(params))));
  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /BetaUniqueToken89/);
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget"
    && event.callSite === "format.segment"
    && event.retryReason === "provider_context_error"));
});

test("segmented missing-token recovery never rebuilds an oversized whole-file model request", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [tokens]",
    "---",
    "# Tokens",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment.replace("AlphaUniqueToken", "Alpha"));
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /restored-lines: token loss after retry/);
  assert.match(adapter.writes[0].data, /AlphaUniqueToken/);
  assert.ok(seenParams.every((params) => /Segment ID:/.test(textFromUserMessage(params))));
});

test("whole-file provider context rejection routes to segmented calls without identical fallback", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [whole-context]",
    "---",
    "# Whole Context",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 90 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(50)}`).join("\n"),
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithCreate((params, callIndex) => {
      const userText = textFromUserMessage(params);
      if (callIndex === 0) {
        assert.doesNotMatch(userText, /Segment ID:/);
        throw providerContextError();
      }
      if (params.stream === false && !/Segment ID:/.test(userText)) {
        throw new Error("whole provider context error must not use identical non-stream fallback");
      }
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      assert.ok(id);
      return (async function* () {
        yield chunk(segmentFrame(id, `- formatted ${id}`, segment));
        yield usageChunk();
      })();
    }, seenParams),
    20_000,
  );

  const wholeCalls = seenParams.filter((params) => !/Segment ID:/.test(textFromUserMessage(params)));
  assert.equal(wholeCalls.length, 1);
  assert.ok(seenParams.some((params) => /Segment ID:\s*segment-\d+/.test(textFromUserMessage(params))));
  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /BetaUniqueToken89/);
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget"
    && event.callSite === "format.output"
    && event.retryReason === "provider_context_error"));
});

test("oversized format fails closed for direct Markdown images even when hasVision is false", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [image]",
    "---",
    "# Image",
    "",
    "![diagram](assets/diagram.png)",
    "",
    "## Body",
    Array.from({ length: 80 }, (_, index) => `ImageToken${index} ${"i".repeat(40)}`).join("\n"),
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithResponder(() => {
      throw new Error("image-bearing oversized note must fail before model calls");
    }, seenParams),
    10_000,
  );

  assert.equal(seenParams.length, 0);
  assert.deepEqual(adapter.writes, []);
  assert.ok(events.some((event) => event.kind === "error" && /image attachments/i.test(event.message)));
});

test("segmented format preserves BOM and CRLF frontmatter exactly without exposing it to segment calls", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const frontmatter = "\uFEFF---\r\ntags: [crlf]\r\nsource: external\r\n---\r\n";
  const original = `${frontmatter}# CRLF\r\n\r\n## One\r\nAlphaUniqueToken\r\n\r\n## Two\r\n${
    Array.from({ length: 80 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}\r\n`).join("")
  }`;

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      assert.doesNotMatch(userText, /tags: \[crlf]/);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1];
      assert.ok(id);
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.ok(adapter.writes[0].data.startsWith(frontmatter));
  assert.match(adapter.writes[0].data, /\r\n# CRLF\r\n/);
});

test("segmented format restores BOM and CRLF frontmatter exactly once", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const frontmatter = "\uFEFF---\r\ntags: [crlf-once]\r\nsource: external\r\n---\r\n";
  const body = `# CRLF\r\n\r\n## One\r\nAlphaUniqueToken\r\n\r\n## Two\r\n${
    Array.from({ length: 80 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}\r\n`).join("")
  }`;
  const original = `${frontmatter}${body}`;

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1];
      assert.ok(id);
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment.replace("# CRLF", "# CRLF Formatted"));
    }, seenParams),
    10_000,
  );

  const expected = `${frontmatter}${body.replace("# CRLF", "# CRLF Formatted")}`;
  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.writes[0].data, expected);
  assert.equal([...adapter.writes[0].data.matchAll(/tags: \[crlf-once]/g)].length, 1);
});

test("segmented reassembly strips model-added frontmatter without stripping thematic breaks", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const frontmatter = "\uFEFF---\r\ntags: [model-frontmatter]\r\nsource: external\r\n---\r\n";
  const original = `${frontmatter}# Model Frontmatter\r\n\r\n## One\r\nAlphaUniqueToken\r\n\r\n## Two\r\n${
    Array.from({ length: 80 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}\r\n`).join("")
  }`;

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1];
      assert.ok(id);
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      const formatted = id === "segment-0"
        ? `---\ntags: [model-added]\n---\n${segment}---\nThematic break stays.\n`
        : segment;
      return segmentFrame(id, `- formatted ${id}`, formatted);
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.ok(adapter.writes[0].data.startsWith(frontmatter));
  assert.equal([...adapter.writes[0].data.matchAll(/tags: \[/g)].length, 1);
  assert.match(adapter.writes[0].data, /^---\nThematic break stays\./m);
});

test("segmented provider context errors split into narrower calls and reassemble", async () => {
  const seenParams: Record<string, unknown>[] = [];
  let failedOnce = false;
  const original = [
    "---",
    "tags: [context]",
    "---",
    "# Context",
    "",
    "## Huge",
    Array.from({ length: 120 }, (_, index) => `ContextToken${index} ${"c".repeat(80)}`).join("\n"),
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithCreate((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      if (params.stream === false) throw new Error("segment context errors must not use identical non-stream fallback");
      if (segment.includes("ContextToken") && !failedOnce) {
        failedOnce = true;
        throw providerContextError();
      }
      return (async function* () {
        yield chunk(segmentFrame(id, `- formatted ${id}`, segment));
        yield usageChunk();
      })();
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /ContextToken119/);
  assert.ok(seenParams.some((params) => /Segment ID:\s*segment-\d+-0/.test(textFromUserMessage(params))));
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget"
    && event.callSite === "format.segment"
    && event.retryReason === "provider_context_error"));
});

test("segmented provider context errors fail closed when a source unit cannot be split", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [irreducible]",
    "---",
    "# Irreducible",
    "",
    `OneHugeToken ${"x".repeat(4_000)}`,
  ].join("\n");

  const { events, adapter } = await collectFormatEvents(
    original,
    llmWithCreate((params) => {
      if (params.stream === false) throw new Error("segment context errors must not use identical non-stream fallback");
      throw providerContextError();
    }, seenParams),
    9_000,
  );

  assert.deepEqual(adapter.writes, []);
  assert.ok(events.some((event) =>
    event.kind === "prompt_budget"
    && event.callSite === "format.segment"
    && event.retryReason === "provider_context_error"));
  assert.ok(events.some((event) => event.kind === "error" && /context/i.test(event.message)));
});

test("segmented non-stream fallback records prompt usage, completion usage, and stats", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [nonstream]",
    "---",
    "# Nonstream",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { events } = await collectFormatEvents(
    original,
    llmWithCreate((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      if (params.stream !== false) throw new Error("temporary transport failure");
      return nonStreamResponse(segmentFrame(id, `- formatted ${id}`, segment), 13, 5);
    }, seenParams),
    10_000,
  );

  const nonStreamCalls = seenParams.filter((params) => params.stream === false).length;
  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.ok(nonStreamCalls > 1);
  assert.equal(budgetEvents.length, seenParams.length);
  assert.equal(
    budgetEvents.filter((event) => event.actualInputTokens === 13).length,
    nonStreamCalls,
  );
  const requestIds = budgetEvents.map((event) => event.requestId);
  assert.equal(new Set(requestIds).size, requestIds.length);
  const statsEvents = events.filter((event) => event.kind === "llm_call_stats");
  assert.equal(statsEvents.length, nonStreamCalls);
  const result = events.findLast((event) => event.kind === "result");
  assert.ok(result);
  assert.equal(result.outputTokens, nonStreamCalls * 5);
});

test("runtime segmentation never sends partial fenced code blocks", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [fence-runtime]",
    "---",
    "# Fence",
    "",
    "## Code",
    "```ts",
    ...Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};`),
    "```",
    "",
    "## Large",
    Array.from({ length: 100 }, (_, index) => `LargeToken${index} ${"l".repeat(60)}`).join("\n"),
    "",
    "## Tail",
    "TailToken",
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment[-\d]+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      const fenceCount = [...segment.matchAll(/^```/gm)].length;
      assert.ok(fenceCount === 0 || fenceCount === 2, `partial fence in ${id}`);
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /const value19 = 19;/);
});

test("segmented format emits format.segment prompt-budget telemetry and aggregates output tokens", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [telemetry]",
    "---",
    "# Telemetry",
    "",
    "## One",
    "AlphaUniqueToken",
    "",
    "## Two",
    Array.from({ length: 80 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { events } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1] ?? "segment-0";
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(id, `- formatted ${id}`, segment);
    }, seenParams),
    10_000,
    new MemoryAdapter({ "notes/source.md": original }),
    { maxTokens: 123 },
  );

  const budgetEvents = events.filter((event) => event.kind === "prompt_budget");
  assert.ok(budgetEvents.length > 1);
  assert.equal(budgetEvents.length, seenParams.length);
  assert.ok(budgetEvents.every((event) => event.callSite === "format.segment"));
  assert.ok(budgetEvents.every((event) => event.estimatedInputTokens <= event.effectiveInputBudget));
  assert.ok(budgetEvents.every((event) => event.outputBudget === 123));
  assert.ok(budgetEvents.every((event) => event.actualInputTokens === 11));
  const lifecycle = events.filter((event) => event.kind === "llm_lifecycle");
  assert.ok(lifecycle.length > 0);
  assert.ok(lifecycle.every((event) => event.action === "format_note"));
  const previewIndex = events.findIndex((event) => event.kind === "format_preview");
  assert.ok(previewIndex > 0);
  assert.equal(events[previewIndex - 1]?.kind, "llm_lifecycle");
  assert.equal(events[previewIndex - 1]?.kind === "llm_lifecycle"
    ? events[previewIndex - 1].phase
    : "", "applying");
  assert.equal(events[previewIndex + 1]?.kind, "llm_lifecycle");
  assert.equal(events[previewIndex + 1]?.kind === "llm_lifecycle"
    ? events[previewIndex + 1].phase
    : "", "completed");
  for (const id of new Set(lifecycle.map((event) => event.id))) {
    const phases = lifecycle.filter((event) => event.id === id).map((event) => event.phase);
    assert.deepEqual(phases, [
      "preparing", "sent", "waiting", "producing", "validating", "applying", "completed",
    ]);
  }
  assertFormatLifecycleIntegrity(events);

  const statsEvents = events.filter((event) => event.kind === "llm_call_stats");
  assert.equal(statsEvents.length, seenParams.length);
  const result = events.findLast((event) => event.kind === "result");
  assert.ok(result);
  assert.equal(result.outputTokens, seenParams.length * 7);
});

test("format restores frontmatter and Obsidian embeds after segmented formatting", async () => {
  const seenParams: Record<string, unknown>[] = [];
  const original = [
    "---",
    "tags: [identity]",
    "source: external-system",
    "---",
    "# Identity",
    "",
    "## One",
    "AlphaUniqueToken ![[assets/diagram.png]]",
    "",
    "## Two",
    Array.from({ length: 70 }, (_, index) => `BetaUniqueToken${index} ${"b".repeat(40)}`).join("\n"),
  ].join("\n");

  const { adapter } = await collectFormatEvents(
    original,
    llmWithResponder((params) => {
      const userText = textFromUserMessage(params);
      const id = userText.match(/Segment ID:\s*(segment-\d+)/)?.[1];
      assert.ok(id);
      const segment = userText.match(/<<<SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/)?.[1] ?? "";
      return segmentFrame(
        id,
        `- formatted ${id}`,
        segment
          .replace("![[assets/diagram.png]]", "![diagram](assets/diagram.png)")
          .replace("# Identity", "# Identity Formatted"),
      );
    }, seenParams),
    10_000,
  );

  assert.equal(adapter.writes.length, 1);
  assert.match(adapter.writes[0].data, /^---\ntags: \[identity]\nsource: external-system\n---/);
  assert.match(adapter.writes[0].data, /!\[\[assets\/diagram\.png]]/);
  assert.doesNotMatch(adapter.writes[0].data, /!\[diagram]\(assets\/diagram\.png\)/);
  assert.match(adapter.writes[0].data, /# Identity Formatted/);
});
