"use strict";

// src/wiki-path.ts
var WIKI_ROOT = "!Wiki";
var GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
var GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
var GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
var GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;
function isWikiArticlePath(path) {
  return path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`);
}

// eval/format-button/run.ts
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}
console.log("\n=== isWikiArticlePath ===");
check("wiki root exactly is wiki", isWikiArticlePath("!Wiki") === true);
check("domain wiki article is wiki", isWikiArticlePath("!Wiki/Alpha/Page.md") === true);
check("wiki config file is wiki", isWikiArticlePath("!Wiki/_config/_index.md") === true);
check("plain source file is not wiki", isWikiArticlePath("Sources/doc.md") === false);
check("note outside wiki is not wiki", isWikiArticlePath("notes/x.md") === false);
check("prefix without slash boundary is not wiki", isWikiArticlePath("!WikiOther/z.md") === false);
console.log(`
${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
