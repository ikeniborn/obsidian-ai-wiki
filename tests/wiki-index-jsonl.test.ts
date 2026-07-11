import assert from "node:assert/strict";
import test from "node:test";
import { parseWikiIndexJsonl, stringifyWikiIndexJsonl, pageRecordId, chunkRecordId } from "../src/wiki-index-jsonl";

test("index JSONL parses page and chunk records", () => {
  const text = [
    '{"kind":"page","schemaVersion":1,"articleId":"hld_system","path":"!Wiki/hld/systems/hld_system.md","type":"system","description":"System description","resource":["СКИТ"],"bodyHash":"b","descriptionHash":"d"}',
    '{"kind":"chunk","schemaVersion":1,"articleId":"hld_system","path":"!Wiki/hld/systems/hld_system.md","heading":"## Scope","ordinal":0,"bodyHash":"b","embedTextHash":"e","vector":[0.1,0.2],"vectorModel":"m","dimensions":2,"updatedAt":"2026-07-11T00:00:00.000Z"}',
  ].join("\n") + "\n";
  const records = parseWikiIndexJsonl(text, "!Wiki/hld/index.jsonl");
  assert.equal(records.length, 2);
  assert.equal(pageRecordId(records[0] as any), "page:hld_system");
  assert.equal(chunkRecordId(records[1] as any), "chunk:hld_system:0");
});

test("stringifyWikiIndexJsonl keeps complete records per line", () => {
  assert.match(stringifyWikiIndexJsonl([{
    kind: "page",
    schemaVersion: 1,
    articleId: "a",
    path: "p",
    type: "concept",
    description: "d",
    resource: [],
    bodyHash: "b",
    descriptionHash: "h",
  }]), /\n$/);
});
