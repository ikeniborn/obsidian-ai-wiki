import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isWikiPagePath } from "../src/wiki-path";

test("isWikiPagePath accepts wiki content pages, rejects meta/sidecars", () => {
  assert.equal(isWikiPagePath("!Wiki/os/macos.md"), true);
  assert.equal(isWikiPagePath("!Wiki/os/index.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/metadata.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/log.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/_config/_domain.json"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_config/_index.md"), false);
});

test("query.ts scopes the file list to the domain wiki folder and filters to wiki pages", () => {
  const src = readFileSync(new URL("../src/phases/query.ts", import.meta.url), "utf8");
  // Folder is derived from the domain's wiki_folder under !Wiki.
  assert.match(src, /domainWikiFolder\(domain\.wiki_folder\)/);
  // The listed files feeding graph/candidate build are filtered by isWikiPagePath.
  assert.match(src, /listFiles\(wikiVaultPath\)/);
  assert.match(src, /\.filter\(isWikiPagePath\)/);
});
