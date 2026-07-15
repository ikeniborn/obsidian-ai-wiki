import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { probeEmbeddingDimensionsResult } = await import("../src/page-similarity");

test("probe result surfaces the underlying error instead of a bare null", async () => {
  const r = await probeEmbeddingDimensionsResult("http://x", "k", "m", 1024);
  assert.equal(r.probe, undefined);
  assert.ok(r.error && r.error.length > 0);
});
