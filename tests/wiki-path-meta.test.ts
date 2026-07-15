import assert from "node:assert/strict";
import test from "node:test";
import { isDomainMetaPath, isWikiPagePath, validateArticlePath } from "../src/wiki-path";

test("isDomainMetaPath flags jsonl sidecars, _config, and legacy md meta", () => {
  assert.equal(isDomainMetaPath("!Wiki/os/metadata.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/index.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/log.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_config/_embeddings.json"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_index.md"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_log.md"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/wiki_os_safari.md"), false);
});

test("isWikiPagePath accepts only content .md pages", () => {
  assert.equal(isWikiPagePath("!Wiki/os/wiki_os_safari.md"), true);
  assert.equal(isWikiPagePath("!Wiki/os/metadata.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/index.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_index.md"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_config/x.md"), false);
});

test("validateArticlePath rejects legacy _config service paths", () => {
  assert.equal(validateArticlePath("!Wiki/os/systems/wiki_os_safari.md", "!Wiki/os"), true);
  assert.equal(validateArticlePath("!Wiki/os/_config/_index.md", "!Wiki/os"), false);
  assert.equal(validateArticlePath("!Wiki/os/metadata.jsonl", "!Wiki/os"), false);
});
