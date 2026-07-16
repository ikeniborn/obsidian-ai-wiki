import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type OpenAI from "openai";
import {
  PromptBudgetExceededError,
  classifyContextError,
  createPromptBudgetEvent,
  estimatePreparedMessages,
  packContextUnits,
  runWithContextRepack,
  shrinkInputBudget,
} from "../src/prompt-budget";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const { buildChatParams, prepareChatMessages } = await import("../src/phases/llm-utils");

test("UTF-8 text uses one byte as one conservative estimated token", () => {
  const ascii = estimatePreparedMessages([{ role: "user", content: "abc" }]);
  const cyrillic = estimatePreparedMessages([{ role: "user", content: "абв" }]);
  assert.ok(cyrillic > ascii);
});

test("image URL payload reserves media tokens without counting base64 text", () => {
  const short = estimatePreparedMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
  ] }]);
  const long = estimatePreparedMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: `data:image/png;base64,${"a".repeat(50_000)}` } },
  ] }]);
  assert.equal(short, long);
  assert.ok(short >= 4096);
});

test("estimator serializes role, name, tool-call, and tool-result metadata exactly", () => {
  const messages = [
    { role: "system", name: "policy", content: "contract" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: '{"query":"абв"}' },
      }],
    },
    { role: "tool", tool_call_id: "call_1", content: "result" },
  ] as OpenAI.Chat.ChatCompletionMessageParam[];

  const expected = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  assert.equal(estimatePreparedMessages(messages), expected);
});

test("estimator reserves every media part and serializes other non-text parts", () => {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image_url", image_url: { url: "data:image/png;base64,short", detail: "high" } },
      { type: "input_audio", input_audio: { data: "audio-bytes", format: "wav" } },
      { type: "image_url", image_url: { url: "https://example.invalid/image.png" } },
    ],
  }] as unknown as OpenAI.Chat.ChatCompletionMessageParam[];
  const serialized = [{
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image_url", image_url: { url: "[media]", detail: "high" } },
      { type: "input_audio", input_audio: { data: "audio-bytes", format: "wav" } },
      { type: "image_url", image_url: { url: "[media]" } },
    ],
  }];
  const expected = new TextEncoder().encode(JSON.stringify(serialized)).byteLength + 2 * 4_096;

  assert.equal(estimatePreparedMessages(messages), expected);
});

test("packer keeps required units whole and drops lower-priority optional units", () => {
  const packed = packContextUnits({
    inputBudgetTokens: 170,
    fixedMessages: [{ role: "system", content: "contract" }],
    opts: {},
    units: [
      { id: "required", source: "source", text: "r".repeat(40), required: true, priority: 0, estimatedTokens: 40 },
      { id: "high", source: "wiki", text: "h".repeat(40), required: false, priority: 10, estimatedTokens: 40 },
      { id: "low", source: "wiki", text: "l".repeat(80), required: false, priority: 1, estimatedTokens: 80 },
    ],
    render: (units) => [{ role: "system", content: "contract" }, { role: "user", content: units.map((u) => u.text).join("\n") }],
  });
  assert.deepEqual(packed.selected.map((unit) => unit.id), ["required", "high"]);
  assert.ok(packed.estimatedInputTokens <= 170);
});

test("packer renders fixed-only prompts before estimating and returning them", () => {
  const fixedMessages = [{ role: "system" as const, content: "fixed contract" }];
  let renders = 0;
  const packed = packContextUnits({
    inputBudgetTokens: 1_000,
    fixedMessages,
    opts: {},
    units: [],
    render: () => {
      renders += 1;
      return fixedMessages;
    },
  });

  assert.equal(renders, 1);
  assert.deepEqual(packed.messages, fixedMessages);
  assert.equal(packed.estimatedInputTokens, estimatePreparedMessages(fixedMessages));
});

test("zero-unit render output is authoritative over compatibility fixedMessages", () => {
  const rendered = [
    { role: "system" as const, content: "prepared contract" },
    { role: "user" as const, content: "prepared request" },
  ];
  const packed = packContextUnits({
    inputBudgetTokens: 1_000,
    fixedMessages: [{ role: "system", content: "legacy fixed input" }],
    opts: {},
    units: [],
    render: () => rendered,
  });

  assert.deepEqual(packed.messages, rendered);
  assert.equal(packed.estimatedInputTokens, estimatePreparedMessages(rendered));
});

test("packer rejects duplicate context unit IDs", () => {
  assert.throws(() => packContextUnits({
    inputBudgetTokens: 1_000,
    fixedMessages: [],
    opts: {},
    units: [
      { id: "duplicate", source: "source", text: "required", required: true, priority: 1, estimatedTokens: 8 },
      { id: "duplicate", source: "wiki", text: "optional", required: false, priority: 1, estimatedTokens: 8 },
    ],
    render: (units) => [{ role: "user", content: units.map((unit) => unit.text).join("\n") }],
  }), /duplicate context unit id/i);
});

test("equal-priority optional units use locale-independent code-point ID order", () => {
  const packed = packContextUnits({
    inputBudgetTokens: 1_000,
    fixedMessages: [],
    opts: {},
    units: [
      { id: "ä", source: "wiki", text: "umlaut", required: false, priority: 1, estimatedTokens: 6 },
      { id: "z", source: "wiki", text: "latin", required: false, priority: 1, estimatedTokens: 5 },
    ],
    render: (units) => [{ role: "user", content: units.map((unit) => unit.text).join("\n") }],
  });

  assert.deepEqual(packed.selected.map((unit) => unit.id), ["z", "ä"]);
});

test("renderer mutation cannot corrupt selected context units", () => {
  const unit = {
    id: "required",
    source: "source" as const,
    text: "original",
    required: true,
    priority: 1,
    estimatedTokens: 8,
  };
  const packed = packContextUnits({
    inputBudgetTokens: 1_000,
    fixedMessages: [],
    opts: {},
    units: [unit],
    render: (units) => {
      const content = units[0]?.text ?? "";
      if (units[0]) (units[0] as { text: string }).text = "mutated";
      return [{ role: "user", content }];
    },
  });

  assert.equal(unit.text, "original");
  assert.equal(packed.selected[0].text, "original");
});

test("required overflow fails instead of truncating", () => {
  const emptyMessages = [{ role: "user" as const, content: "" }];
  assert.throws(() => packContextUnits({
    inputBudgetTokens: estimatePreparedMessages(emptyMessages),
    fixedMessages: [],
    opts: {},
    units: [{ id: "q", source: "source", text: "question", required: true, priority: 1, estimatedTokens: 8 }],
    render: (units) => [{ role: "user", content: units[0]?.text ?? "" }],
  }), PromptBudgetExceededError);
});

test("provider counts use ratio and safety factor; unknown counts use 75 percent", () => {
  const details = classifyContextError(new Error("prompt size 565000 exceeds maximum context 524288"));
  assert.deepEqual(details, { promptTokens: 565000, maxContextTokens: 524288 });
  assert.equal(shrinkInputBudget(16_384, details), Math.floor(16_384 * 524288 / 565000 * 0.9));
  assert.equal(shrinkInputBudget(16_384, {}), 12_288);
});

test("budget shrinking uses provider ratios only for real overflow counts", () => {
  const cases = [
    { name: "near-unity overflow", current: 10, details: { promptTokens: 1_001, maxContextTokens: 1_000 }, expected: 8 },
    { name: "equal counts", current: 100, details: { promptTokens: 100, maxContextTokens: 100 }, expected: 75 },
    { name: "reversed counts", current: 100, details: { promptTokens: 100, maxContextTokens: 200 }, expected: 75 },
    { name: "missing counts", current: 2, details: {}, expected: 1 },
    { name: "tiny ratio", current: 2, details: { promptTokens: 100_000, maxContextTokens: 1 }, expected: 1 },
  ] as const;

  for (const fixture of cases) {
    assert.equal(shrinkInputBudget(fixture.current, fixture.details), fixture.expected, fixture.name);
  }
});

test("every shrink from a budget above one stays positive and strictly decreases", () => {
  const details = [
    {},
    { promptTokens: 1_001, maxContextTokens: 1_000 },
    { promptTokens: 100, maxContextTokens: 200 },
    { promptTokens: 100_000, maxContextTokens: 1 },
  ];

  for (let current = 2; current <= 64; current++) {
    for (const value of details) {
      const next = shrinkInputBudget(current, value);
      assert.ok(next >= 1, `budget ${current} produced ${next}`);
      assert.ok(next < current, `budget ${current} did not shrink: ${next}`);
    }
  }
});

test("context error classifier recognizes input-context provider variants", () => {
  const fixtures: Array<{ name: string; error: unknown; expected: object }> = [
    { name: "known code", error: { code: "context_length_exceeded" }, expected: {} },
    { name: "known type", error: { type: "input_too_long" }, expected: {} },
    { name: "max-context code", error: { code: "max_context_length_exceeded" }, expected: {} },
    { name: "prompt-too-long code", error: { code: "prompt_too_long" }, expected: {} },
    { name: "nested code", error: { error: { code: "context_window_exceeded" } }, expected: {} },
    {
      name: "nested code behind generic provider envelope",
      error: {
        code: "invalid_request_error",
        message: "request failed",
        error: {
          code: "context_length_exceeded",
          message: "prompt size 565000 exceeds maximum context 524288",
        },
      },
      expected: { promptTokens: 565_000, maxContextTokens: 524_288 },
    },
    {
      name: "OpenAI-compatible",
      error: new Error("This model's maximum context length is 4096 tokens. However, your messages resulted in 5000 tokens."),
      expected: { promptTokens: 5_000, maxContextTokens: 4_096 },
    },
    {
      name: "Anthropic-style",
      error: new Error("prompt is too long: 213084 tokens > 200000 maximum"),
      expected: { promptTokens: 213_084, maxContextTokens: 200_000 },
    },
    {
      name: "Ollama",
      error: new Error("the request exceeds the available context size; shorten the input"),
      expected: {},
    },
    {
      name: "explicit input count",
      error: new Error("input token count 565000 exceeds maximum number of tokens allowed 524288"),
      expected: { promptTokens: 565_000, maxContextTokens: 524_288 },
    },
    {
      name: "prompt plus requested completion exceeds context window",
      error: new Error("prompt size 5000 plus requested completion tokens exceeds maximum context 4096"),
      expected: { promptTokens: 5_000, maxContextTokens: 4_096 },
    },
    {
      name: "nested message",
      error: { error: { message: "prompt size 565000 exceeds maximum context 524288" } },
      expected: { promptTokens: 565_000, maxContextTokens: 524_288 },
    },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(classifyContextError(fixture.error), fixture.expected, fixture.name);
  }
});

test("context error classifier rejects quota and output-limit messages", () => {
  const fixtures: Array<{ name: string; error: unknown }> = [
    { name: "network", error: new Error("connection reset by peer") },
    { name: "deadline", error: new Error("context deadline exceeded") },
    { name: "timeout", error: new Error("context timeout exceeded") },
    { name: "quota", error: new Error("You exceeded your current quota; check plan and billing details") },
    { name: "input quota", error: new Error("input token quota exceeded for this account") },
    { name: "prompt rate limit", error: new Error("prompt token rate limit exceeded") },
    { name: "account", error: new Error("Your account has reached its token limit") },
    { name: "completion", error: new Error("completion token limit exceeded") },
    { name: "completion mentioning prompt", error: new Error("completion token limit for this prompt exceeded") },
    { name: "output", error: new Error("output token limit exceeded") },
    {
      name: "output-only context reservation",
      error: new Error("requested completion 5000 exceeds maximum context 4096"),
    },
    { name: "generated tokens", error: new Error("too many tokens were generated in the completion") },
    { name: "descriptive context", error: new Error("This model has a context window of 128000 tokens") },
    {
      name: "ambiguous code with output semantics",
      error: { code: "too_many_tokens", message: "completion token limit exceeded" },
    },
  ];

  for (const fixture of fixtures) {
    assert.equal(classifyContextError(fixture.error), null, fixture.name);
  }
});

test("budget telemetry returns fresh metadata-only events", () => {
  const secret = "SECRET_SOURCE_AND_AUTH_MARKER";
  const metadata = {
    callSite: "ingest.synthesize",
    configuredInputBudget: 16_384,
    effectiveInputBudget: 12_288,
    estimatedInputTokens: 12_000,
    actualInputTokens: 11_900,
    outputBudget: 4_096,
    compressionProfile: "balanced" as const,
    contextUnits: 8,
    sourceChunks: 3,
    reductionDepth: 1,
    retryReason: "provider_context_error" as const,
    messages: secret,
    sourceText: secret,
    evidence: secret,
    imageData: secret,
    apiKey: secret,
    headers: secret,
  };

  const first = createPromptBudgetEvent(metadata);
  const second = createPromptBudgetEvent(metadata);

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.deepEqual(Object.keys(first).sort(), [
    "actualInputTokens",
    "callSite",
    "compressionProfile",
    "configuredInputBudget",
    "contextUnits",
    "effectiveInputBudget",
    "estimatedInputTokens",
    "kind",
    "outputBudget",
    "reductionDepth",
    "retryReason",
    "sourceChunks",
  ]);
});

test("context recovery rebuilds twice at most and emits one event per attempt", async () => {
  const budgets: number[] = [];
  const events: ReturnType<typeof createPromptBudgetEvent>[] = [];
  let attempts = 0;

  const result = await runWithContextRepack({
    callSite: "ingest.synthesize",
    configuredInputBudget: 1_000,
    outputBudget: 256,
    compressionProfile: "balanced",
    build: (effectiveInputBudget) => {
      budgets.push(effectiveInputBudget);
      return {
        value: effectiveInputBudget,
        estimatedInputTokens: effectiveInputBudget - 10,
        contextUnits: 4,
        sourceChunks: 2,
        reductionDepth: attempts,
      };
    },
    execute: async (effectiveInputBudget) => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("context window exceeded"), { code: "context_length_exceeded" });
      }
      return { effectiveInputBudget, inputTokens: 321 };
    },
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(budgets, [1_000, 750, 562]);
  assert.equal(result.effectiveInputBudget, 562);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.retryReason), [
    "provider_context_error",
    "provider_context_error",
    undefined,
  ]);
  assert.equal(events[2].actualInputTokens, 321);
});

test("event callback failure is delivered once and is not treated as execution failure", async () => {
  const callbackError = new Error("event sink failed");
  let deliveries = 0;
  let executions = 0;

  await assert.rejects(runWithContextRepack({
    callSite: "ingest.synthesize",
    configuredInputBudget: 100,
    compressionProfile: "balanced",
    build: () => ({ value: null, estimatedInputTokens: 10, contextUnits: 1 }),
    execute: async () => {
      executions += 1;
      return { inputTokens: 8 };
    },
    onEvent: () => {
      deliveries += 1;
      throw callbackError;
    },
  }), callbackError);

  assert.equal(executions, 1);
  assert.equal(deliveries, 1);
});

test("context recovery stops after the initial call plus two repacks", async () => {
  let attempts = 0;
  const events: ReturnType<typeof createPromptBudgetEvent>[] = [];

  await assert.rejects(runWithContextRepack({
    callSite: "vision.analysis",
    configuredInputBudget: 100,
    compressionProfile: "minimum",
    build: (effectiveInputBudget) => ({
      value: effectiveInputBudget,
      estimatedInputTokens: effectiveInputBudget,
      contextUnits: 1,
    }),
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("prompt is too long"), { code: "context_length_exceeded" });
    },
    onEvent: (event) => events.push(event),
  }), /prompt is too long/);

  assert.equal(attempts, 3);
  assert.equal(events.length, 3);
});

test("context recovery rethrows at budget one without rebuilding at zero", async () => {
  const budgets: number[] = [];
  let attempts = 0;
  const contextError = Object.assign(new Error("context window exceeded"), {
    code: "context_length_exceeded",
  });

  await assert.rejects(runWithContextRepack({
    callSite: "vision.analysis",
    configuredInputBudget: 1,
    compressionProfile: "minimum",
    build: (effectiveInputBudget) => {
      budgets.push(effectiveInputBudget);
      return { value: null, estimatedInputTokens: 1, contextUnits: 1 };
    },
    execute: async () => {
      attempts += 1;
      throw contextError;
    },
    onEvent: () => {},
  }), contextError);

  assert.deepEqual(budgets, [1]);
  assert.equal(attempts, 1);
});

test("buildChatParams rejects the complete prepared message above budget", () => {
  const messages = [{ role: "user" as const, content: "required question" }];
  const opts = { inputBudgetTokens: 1 };
  const estimated = estimatePreparedMessages(prepareChatMessages(messages, opts));

  assert.throws(
    () => buildChatParams("m", messages, { inputBudgetTokens: estimated - 1 }),
    (error: unknown) => {
      assert.ok(error instanceof PromptBudgetExceededError);
      assert.equal(error.budget, estimated - 1);
      assert.equal(error.estimated, estimated);
      assert.deepEqual(error.requiredIds, []);
      return true;
    },
  );
});
