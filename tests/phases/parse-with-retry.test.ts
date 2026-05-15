import { describe, it, expect, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import { z } from "zod";
import {
  parseWithRetry, formatZodFeedback, StructuredValidationError,
} from "../../src/phases/parse-with-retry";
import type { LlmClient, RunEvent } from "../../src/types";
import { structuralErrorCounter } from "../../src/structural-error-counter";

const Schema = z.object({ id: z.string().min(1), value: z.number() });

function streamFromText(text: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
      yield {
        choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
        usage: { completion_tokens: 5 },
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
    },
  };
}

function makeLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown) => {
          const text = responses[Math.min(i++, responses.length - 1)];
          return streamFromText(text) as never;
        }) as never,
      },
    },
  };
}

const baseArgs = {
  model: "test",
  baseMessages: [{ role: "user" as const, content: "x" }],
  opts: {},
  schema: Schema,
  callSite: "init.bootstrap" as const,
};

beforeEach(() => structuralErrorCounter.reset());

describe("parseWithRetry", () => {
  it("returns value on first-attempt success (maxRetries=0)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([JSON.stringify({ id: "a", value: 1 })]);
    const r = await parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(r.value).toEqual({ id: "a", value: 1 });
    expect(r.outputTokens).toBe(5);
    expect(events).toEqual([]);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 1 });
  });

  it("throws StructuredValidationError on invalid first attempt with maxRetries=0", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["not json"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeInstanceOf(StructuredValidationError);
    const fail = events.find(e => e.kind === "structural_error" && e.succeeded === false);
    expect(fail).toBeDefined();
    expect(structuralErrorCounter.get().failed).toBe(1);
  });

  it("retries after fail then succeeds (maxRetries=1, fail+ok)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([
      "{}",
      JSON.stringify({ id: "x", value: 7 }),
    ]);
    const r = await parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(r.value).toEqual({ id: "x", value: 7 });
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    const midFlight = events.find(e => e.kind === "structural_error" && e.succeeded === null);
    expect(midFlight).toBeDefined();
    const ok = events.find(e => e.kind === "structural_error" && e.succeeded === true);
    expect(ok).toBeDefined();
    expect(structuralErrorCounter.get().retried).toBe(1);
  });

  it("throws after retries exhausted (maxRetries=1, fail+fail)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["{}", "still not valid"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeInstanceOf(StructuredValidationError);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(structuralErrorCounter.get().failed).toBe(1);
  });

  it("emits errorType=json_parse for non-JSON output", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["totally not json garbage"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    const ev = events.find(e => e.kind === "structural_error");
    if (ev?.kind === "structural_error") expect(ev.errorType).toBe("json_parse");
  });

  it("emits errorType=schema_validate for valid JSON failing schema", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([JSON.stringify({ id: "", value: "wrong" })]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    const ev = events.find(e => e.kind === "structural_error");
    if (ev?.kind === "structural_error") expect(ev.errorType).toBe("schema_validate");
  });

  it("retry message contains feedback string", async () => {
    const calls: unknown[] = [];
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async (params: unknown) => {
            calls.push(params);
            const responses = ["{}", JSON.stringify({ id: "ok", value: 1 })];
            return streamFromText(responses[calls.length - 1]) as never;
          }) as never,
        },
      },
    };
    await parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    const second = calls[1] as { messages: Array<{ role: string; content: string }> };
    const lastUser = second.messages[second.messages.length - 1];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content).toMatch(/failed validation/i);
  });

  it("propagates AbortError without emitting events or recording counter", async () => {
    const events: RunEvent[] = [];
    const ac = new AbortController();
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            ac.abort();
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }) as never,
        },
      },
    };
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: ac.signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    expect(events).toEqual([]);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });
});

describe("formatZodFeedback", () => {
  it("includes path and message bullets", () => {
    const r = Schema.safeParse({ id: "", value: "x" });
    if (r.success) throw new Error("expected fail");
    const fb = formatZodFeedback(r.error, '{"id":"","value":"x"}');
    expect(fb).toMatch(/failed validation/i);
    expect(fb).toMatch(/id/);
    expect(fb).toMatch(/value/);
    expect(fb).toMatch(/Return ONLY/i);
  });

  it("formats json_parse errors as plain text", () => {
    const fb = formatZodFeedback(null, "raw garbage");
    expect(fb).toMatch(/JSON/i);
    expect(fb).toMatch(/Return ONLY/i);
  });
});
