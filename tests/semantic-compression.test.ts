import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const { compressionInstruction } = await import("../src/semantic-compression");
const { buildChatParams, prepareChatMessages } = await import("../src/phases/llm-utils");

test("profiles change density and keep ingest evidence invariant", () => {
  const maximum = compressionInstruction({ profile: "maximum", operation: "ingest" });
  const minimum = compressionInstruction({ profile: "minimum", operation: "ingest" });
  assert.notEqual(maximum, minimum);
  for (const text of [maximum, minimum]) {
    assert.match(text, /packet/i);
    assert.match(text, /source range/i);
    assert.match(text, /do not drop/i);
  }
});

test("query, lint, and vision preserve their governed fields", () => {
  assert.match(compressionInstruction({ profile: "balanced", operation: "query" }), /citation/i);
  assert.match(compressionInstruction({ profile: "balanced", operation: "lint" }), /severity/i);
  assert.match(compressionInstruction({ profile: "balanced", operation: "vision" }), /OCR/i);
});

test("messages without semanticCompression remain profile-independent", () => {
  const base = [{ role: "user" as const, content: "format this" }];
  assert.deepEqual(prepareChatMessages(base, {}), prepareChatMessages(base, { semanticCompression: undefined }));
});

test("semantic compression is appended once after other system sections through the shared preparation path", () => {
  const messages = [
    { role: "system" as const, content: "Original system prompt", name: "original-system" },
    { role: "user" as const, content: "Answer this question" },
  ];
  const original = structuredClone(messages);
  const opts = {
    outputLanguage: "en" as const,
    reasoningLanguage: "es" as const,
    systemPrompt: "Keep this clarification.",
    semanticCompression: { profile: "maximum" as const, operation: "query" as const },
  };

  const prepared = prepareChatMessages(messages, opts);
  const params = buildChatParams("model", messages, opts);
  const firstSystem = prepared.find((message) => message.role === "system");
  assert.ok(firstSystem && typeof firstSystem.content === "string");

  const content = firstSystem.content;
  assert.equal(content.match(/^## Semantic compression$/gm)?.length, 1);
  const orderedSections = [
    "## Language",
    "## Reasoning language",
    "## Clarification",
    "## Semantic compression",
  ];
  const positions = orderedSections.map((section) => content.indexOf(section));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.deepEqual(params.messages, prepared);
  assert.deepEqual(messages, original);
  assert.equal(firstSystem.name, "original-system");
});

test("zero or absent thinking budget omits reasoning controls", () => {
  const messages = [{ role: "user" as const, content: "Answer this" }];

  for (const opts of [{}, { thinkingBudgetTokens: 0 }]) {
    const params = buildChatParams("model", messages, opts);
    assert.equal("reasoning_effort" in params, false);
    assert.equal("extra_body" in params, false);
    assert.equal("thinking" in params, false);
  }
});

test("legacy numeric thinking budget never emits a non-standard OpenAI parameter", () => {
  const params = buildChatParams(
    "model",
    [{ role: "user" as const, content: "Answer this" }],
    {
      thinkingBudgetTokens: 512,
      jsonMode: "json_object",
      maxTokens: 1024,
      temperature: 0.2,
      topP: 0.9,
    },
  );

  assert.equal("thinking" in params, false);
  assert.equal(params.max_completion_tokens, 1024);
  assert.equal("max_tokens" in params, false);
  assert.deepEqual(params.response_format, { type: "json_object" });
  assert.equal(params.temperature, 0.2);
  assert.equal(params.top_p, 0.9);
});

test("shared request builder emits only OpenAI Chat Completions fields", () => {
  const params = buildChatParams(
    "model",
    [{ role: "user" as const, content: "Answer this" }],
    {
      maxTokens: 1024,
      temperature: 0.2,
      topP: 0.9,
      jsonMode: "json_schema",
      jsonSchema: { name: "answer", schema: { type: "object" } },
      includeStreamUsage: true,
      thinkingBudgetTokens: 4096,
    },
    true,
  );

  assert.deepEqual(Object.keys(params).sort(), [
    "max_completion_tokens",
    "messages",
    "model",
    "response_format",
    "stream_options",
    "temperature",
    "top_p",
  ]);
});
