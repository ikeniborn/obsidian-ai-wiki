import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
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

test("required overflow fails instead of truncating", () => {
  assert.throws(() => packContextUnits({
    inputBudgetTokens: 10,
    fixedMessages: [],
    opts: {},
    units: [{ id: "q", source: "source", text: "question", required: true, priority: 1, estimatedTokens: 8 }],
    render: (units) => [{ role: "user", content: units[0].text }],
  }), PromptBudgetExceededError);
});

test("provider counts use ratio and safety factor; unknown counts use 75 percent", () => {
  const details = classifyContextError(new Error("prompt size 565000 exceeds maximum context 524288"));
  assert.deepEqual(details, { promptTokens: 565000, maxContextTokens: 524288 });
  assert.equal(shrinkInputBudget(16_384, details), Math.floor(16_384 * 524288 / 565000 * 0.9));
  assert.equal(shrinkInputBudget(16_384, {}), 12_288);
});

test("context error classifier accepts provider codes and rejects unrelated failures", () => {
  assert.deepEqual(classifyContextError({ code: "context_length_exceeded" }), {});
  assert.equal(classifyContextError(new Error("connection reset by peer")), null);
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
