import assert from "node:assert/strict";
import test from "node:test";
import {
  domainMetadataPath,
  domainIndexPath,
  domainLogPath,
  legacyDomainIndexPath,
  legacyDomainLogPath,
  legacyDomainEmbeddingsPath,
  LEGACY_GLOBAL_DOMAIN_PATH,
} from "../src/wiki-path";

test("jsonl service paths live directly in the domain folder", () => {
  assert.equal(domainMetadataPath("!Wiki/hld"), "!Wiki/hld/metadata.jsonl");
  assert.equal(domainIndexPath("!Wiki/hld"), "!Wiki/hld/index.jsonl");
  assert.equal(domainLogPath("!Wiki/hld"), "!Wiki/hld/log.jsonl");
});

test("legacy service paths remain explicit for migration", () => {
  assert.equal(LEGACY_GLOBAL_DOMAIN_PATH, "!Wiki/_config/_domain.json");
  assert.equal(legacyDomainIndexPath("!Wiki/hld"), "!Wiki/hld/_config/_index.md");
  assert.equal(legacyDomainLogPath("!Wiki/hld"), "!Wiki/hld/_config/_log.md");
  assert.equal(legacyDomainEmbeddingsPath("!Wiki/hld"), "!Wiki/hld/_config/_embeddings.json");
});
