import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../src/content-hash";
import {
  chunkRecordId,
  collectPageDescriptions,
  pageRecordId,
  parseWikiIndexJsonl,
  reconcilePageRecords,
  removeArticleRecords,
  removePageRecord,
  stringifyWikiIndexJsonl,
  upsertPageRecord,
  type PageIndexRecord,
  type WikiIndexRecord,
} from "../src/wiki-index-jsonl";
import { pageIndexRecordFromMarkdown } from "../src/wiki-index";

const page = (id: string, description = id): PageIndexRecord => ({
  kind: "page",
  schemaVersion: 1,
  articleId: id,
  path: `!Wiki/d/concept/${id}.md`,
  type: "concept",
  description,
  resource: ["source"],
  bodyHash: `body-${id}`,
  descriptionHash: `desc-${id}`,
});

const chunk: WikiIndexRecord = {
  kind: "chunk",
  schemaVersion: 1,
  articleId: "a",
  path: "!Wiki/d/concept/a.md",
  heading: "## Facts",
  ordinal: 0,
  bodyHash: "body-a",
  embedTextHash: "embed-a",
  vector: [0.1, 0.2],
  vectorModel: "m",
  dimensions: 2,
  updatedAt: "2026-07-16T00:00:00.000Z",
};

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

test("page upsert and removal preserve every chunk and unknown record", () => {
  const unknown = { kind: "future", value: 1 };
  const records = upsertPageRecord([chunk, unknown], page("a"));
  assert.deepEqual(records.filter((record) => record.kind === "chunk"), [chunk]);
  assert.deepEqual(records.find((record) => record.kind === "future"), unknown);
  assert.deepEqual(removePageRecord(records, "a"), [chunk, unknown]);
});

test("page upsert replaces in place without reordering opposite records", () => {
  const unknown = { kind: "future", value: 1 };
  assert.deepEqual(
    upsertPageRecord([chunk, page("a", "old"), unknown], page("a", "new")),
    [chunk, page("a", "new"), unknown],
  );
});

test("reconcile replaces only page records and leaves chunk records unchanged", () => {
  const records = reconcilePageRecords([page("old"), chunk], [page("a", "new")]);
  assert.deepEqual(records.filter((record) => record.kind === "chunk"), [chunk]);
  assert.equal(collectPageDescriptions(records).get("a"), "new");
  assert.equal(collectPageDescriptions(records).has("old"), false);
});

test("article deletion removes its page and chunk records but keeps other articles", () => {
  const records = removeArticleRecords([page("a"), page("b"), chunk], "a");
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "a"), false);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "a"), false);
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "b"), true);
});

test("page metadata builder reads governed CRLF frontmatter and hashes exact content", () => {
  const content = [
    "---",
    "description: Covers the runtime index.",
    "resource:",
    "  - source-a",
    "  - source-b",
    "timestamp: 2026-07-16",
    "tags:",
    "  - storage/jsonl",
    "---",
    "# Runtime index",
    "",
    "Body.",
    "",
  ].join("\r\n");

  assert.deepEqual(pageIndexRecordFromMarkdown("!Wiki/d", "!Wiki/d/concept/runtime-index.md", content), {
    kind: "page",
    schemaVersion: 1,
    articleId: "runtime-index",
    path: "!Wiki/d/concept/runtime-index.md",
    type: "concept",
    description: "Covers the runtime index.",
    resource: ["source-a", "source-b"],
    timestamp: "2026-07-16",
    tags: ["storage/jsonl"],
    bodyHash: contentHash(content),
    descriptionHash: contentHash("Covers the runtime index."),
  });
});
