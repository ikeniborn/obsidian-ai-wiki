import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const domain = readFileSync(new URL("../src/phases/query.ts", import.meta.url), "utf8");
const cross = readFileSync(new URL("../src/phases/query-cross-domain.ts", import.meta.url), "utf8");

for (const [name, src] of [["query", domain], ["query-cross-domain", cross]] as const) {
  test(`${name} selects chunks, dedupes, then reranks in that order`, () => {
    const selIdx = src.indexOf("selectRelevantChunks");
    const dedupIdx = src.indexOf("dedupeChunks(");
    const rerankIdx = src.indexOf("rerankChunks(");
    assert.ok(selIdx > -1, "selectRelevantChunks present");
    assert.ok(dedupIdx > -1, "dedupeChunks present");
    assert.ok(rerankIdx > -1, "rerankChunks present");
    assert.ok(selIdx < dedupIdx && dedupIdx < rerankIdx, "order: select → dedupe → rerank");
  });

  test(`${name} drives rerank limits from rerankerRuntime.config`, () => {
    assert.match(src, /rerankerRuntime\.config\.rerankerTopN/);
    assert.match(src, /rerankerRuntime\.config\.contextTopN/);
  });

  test(`${name} applies boilerplate demotion`, () => {
    assert.match(src, /boilerplateDemotion|demoteBoilerplate/);
  });
}
