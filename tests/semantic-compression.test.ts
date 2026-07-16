import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const { compressionInstruction } = await import("../src/semantic-compression");
const { prepareChatMessages } = await import("../src/phases/llm-utils");

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
