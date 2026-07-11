import assert from "node:assert/strict";
import test from "node:test";
import { buildLogRecord, parseLegacyLogBlocks } from "../src/wiki-log";

test("buildLogRecord emits structured ingest operation", () => {
  const record = buildLogRecord("hld", {
    op: "ingest",
    sourcePath: "src.md",
    entries: [{ path: "!Wiki/hld/system/a.md", action: "CREATED", statusTo: "developing" }],
    outputTokens: 42,
  }, "2026-07-11T00:00:00.000Z");
  assert.equal(record.kind, "operation");
  assert.equal(record.op, "ingest");
  assert.equal(record.entries?.[0].action, "CREATED");
});

test("parseLegacyLogBlocks preserves unparsed markdown blocks", () => {
  const blocks = parseLegacyLogBlocks("## 2026-07-10 — ingest — hld\n**Tokens:** 10\n\n---\n", "hld");
  assert.equal(blocks[0].kind, "legacy_log_block");
  assert.match(blocks[0].text, /Tokens/);
});
