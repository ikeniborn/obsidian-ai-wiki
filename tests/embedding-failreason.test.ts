import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { PageSimilarityService, buildEmbeddingRequestBody } = await import("../src/page-similarity");

test("embedding failure sets allFailed and a non-empty failReason", async () => {
  const svc = new PageSimilarityService({
    mode: "embedding", model: "m", baseUrl: "http://x", apiKey: "k", topK: 5,
  });
  const r = await svc.selectByEntities(
    [{ name: "x", type: "Concept" }],
    new Map([["p", "annotation"]]),
    ["!Wiki/d/Concept/p.md"],
  );
  assert.equal(r.allFailed, true);
  assert.ok(r.failReason && r.failReason.length > 0);
});

test("embedding request body omits dimensions when unset, includes it when set", () => {
  assert.equal("dimensions" in buildEmbeddingRequestBody("m", ["x"]), false);
  assert.equal("dimensions" in buildEmbeddingRequestBody("m", ["x"], 0), false);
  assert.equal(buildEmbeddingRequestBody("m", ["x"], 512).dimensions, 512);
});
