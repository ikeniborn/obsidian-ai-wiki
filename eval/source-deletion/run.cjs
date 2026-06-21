"use strict";

// src/wiki-path.ts
var WIKI_ROOT = "!Wiki";
var GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
var GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
var GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
var GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;

// src/source-deletion.ts
function sourceStem(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}
function stripSourceToken(token) {
  return token.replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim();
}
function wikiSourceTokens(content) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return [];
  const m = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fm[1]);
  if (!m) return [];
  return m[1].split("\n").map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim()).filter(Boolean).map(stripSourceToken);
}
function computeDeletionPlan(sourcePath, pages, sourceStemToPath) {
  const target = sourceStem(sourcePath);
  const toDelete = [];
  const toRebuild = [];
  const remainingStems = /* @__PURE__ */ new Set();
  for (const [pagePath, content] of pages) {
    const tokens = wikiSourceTokens(content);
    if (!tokens.includes(target)) continue;
    if (tokens.length === 1) {
      toDelete.push(pagePath);
    } else {
      toRebuild.push(pagePath);
      for (const t of tokens) if (t !== target) remainingStems.add(t);
    }
  }
  const remainingSources = [];
  for (const stem of remainingStems) {
    const p = sourceStemToPath.get(stem);
    if (p) remainingSources.push(p);
  }
  return { toDelete, toRebuild, remainingSources };
}
function isSourceFile(path, domain) {
  if (path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`)) return false;
  if (!path.endsWith(".md")) return false;
  for (const sp of domain.source_paths ?? []) {
    const norm = sp.replace(/\/+$/, "");
    if (path === norm || path.startsWith(`${norm}/`)) return true;
  }
  return false;
}

// eval/source-deletion/run.ts
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `
        \u2192 ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`
=== ${t} ===`);
}
function page(sources) {
  const list = sources.map((s) => `  - "[[${s}]]"`).join("\n");
  return `---
wiki_sources:
${list}
---
# Page
`;
}
section("computeDeletionPlan");
{
  const pages = /* @__PURE__ */ new Map([
    ["!Wiki/work/Type/wiki_work_a.md", page(["note"])],
    // sole-source → delete
    ["!Wiki/work/Type/wiki_work_b.md", page(["note", "other"])],
    // multi → rebuild on "other"
    ["!Wiki/work/Type/wiki_work_c.md", page(["unrelated"])],
    // ignore
    ["!Wiki/work/Type/wiki_work_d.md", page(["note", "other"])]
    // multi → shares "other"
  ]);
  const stemToPath = /* @__PURE__ */ new Map([
    ["other", "src/other.md"],
    ["unrelated", "src/unrelated.md"]
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, stemToPath);
  check(
    "sole-source page goes to toDelete",
    plan.toDelete.includes("!Wiki/work/Type/wiki_work_a.md") && plan.toDelete.length === 1,
    JSON.stringify(plan.toDelete)
  );
  check(
    "multi-source pages go to toRebuild",
    plan.toRebuild.includes("!Wiki/work/Type/wiki_work_b.md") && plan.toRebuild.includes("!Wiki/work/Type/wiki_work_d.md") && plan.toRebuild.length === 2,
    JSON.stringify(plan.toRebuild)
  );
  check(
    "unrelated page ignored",
    !plan.toDelete.includes("!Wiki/work/Type/wiki_work_c.md") && !plan.toRebuild.includes("!Wiki/work/Type/wiki_work_c.md")
  );
  check(
    "remainingSources deduped and excludes target",
    plan.remainingSources.length === 1 && plan.remainingSources[0] === "src/other.md",
    JSON.stringify(plan.remainingSources)
  );
}
section("stem matching edge cases");
{
  const pages = /* @__PURE__ */ new Map([
    ["!Wiki/work/Type/wiki_work_x.md", page(["note-2"])]
    // must NOT match "note"
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, /* @__PURE__ */ new Map());
  check(
    "note does not false-match note-2",
    plan.toDelete.length === 0 && plan.toRebuild.length === 0,
    JSON.stringify(plan)
  );
  const pages2 = /* @__PURE__ */ new Map([
    ["!Wiki/work/Type/wiki_work_y.md", page(["note", "ghost"])]
    // "ghost" resolves to nothing
  ]);
  const plan2 = computeDeletionPlan("src/note.md", pages2, /* @__PURE__ */ new Map());
  check(
    "unresolved remaining stem is dropped",
    plan2.toRebuild.length === 1 && plan2.remainingSources.length === 0,
    JSON.stringify(plan2)
  );
}
section("isSourceFile");
{
  const domain = { id: "work", name: "Work", wiki_folder: "work", source_paths: ["src", "notes/foo.md"] };
  check("wiki page is not a source", isSourceFile("!Wiki/work/Type/wiki_work_a.md", domain) === false);
  check("file under source folder is a source", isSourceFile("src/note.md", domain) === true);
  check("exact file source entry matches", isSourceFile("notes/foo.md", domain) === true);
  check("unrelated file is not a source", isSourceFile("other/x.md", domain) === false);
}
console.log(`
========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
