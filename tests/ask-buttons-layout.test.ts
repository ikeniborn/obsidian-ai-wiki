import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");

test("Ask Wiki button is created before Ask Domain", () => {
  const wikiIdx = src.indexOf("this.askWikiBtn = askButtons.createEl");
  const domainIdx = src.indexOf("this.askDomainBtn = askButtons.createEl");
  assert.ok(wikiIdx > -1 && domainIdx > -1, "both button creations present");
  assert.ok(wikiIdx < domainIdx, "askWiki must be created first");
});

test("Ask Domain is the accent (mod-cta) button, Ask Wiki is not", () => {
  const domainLine = src.split("\n").find((l) => l.includes("this.askDomainBtn = askButtons.createEl"))!;
  const wikiLine = src.split("\n").find((l) => l.includes("this.askWikiBtn = askButtons.createEl"))!;
  assert.match(domainLine, /mod-cta/);
  assert.doesNotMatch(wikiLine, /mod-cta/);
});
