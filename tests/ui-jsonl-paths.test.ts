import assert from "node:assert/strict";
import test from "node:test";
import { domainIndexPath, domainLogPath, domainWikiFolder } from "../src/wiki-path";

test("sidebar opens JSONL service files for a domain", () => {
  const folder = domainWikiFolder("hld");
  assert.equal(domainIndexPath(folder), "!Wiki/hld/index.jsonl");
  assert.equal(domainLogPath(folder), "!Wiki/hld/log.jsonl");
});
