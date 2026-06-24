/**
 * Out-of-vault eval for incremental source-hash detection.
 * Exercises the REAL pure functions from src/ — no Obsidian, no LLM, no fs.
 * Run: npx tsx eval/incremental-sources/run.ts
 */
import {
  computeChangedSources, hashSource, sourceBodyForHash, capList, parsePageSources,
} from "../../src/incremental-sources";
// TODO(Task 2): restore migrateDomainsV3 import + tests 6-7
// import { migrateDomainsV3, type DomainEntry } from "../../src/domain";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// =====================================================================
section("sourceBodyForHash + hashSource");

check("strips leading frontmatter",
  sourceBodyForHash("---\nwiki_updated: 2026-06-25\n---\nbody text") === "body text");
check("no-frontmatter passthrough (trailing trimmed)",
  sourceBodyForHash("plain body\n\n") === "plain body");
check("hashSource has fnv1a prefix + 8 hex",
  /^fnv1a:[0-9a-f]{8}$/.test(hashSource("---\na: 1\n---\nhello")));
check("deterministic",
  hashSource("---\nx: 1\n---\nB") === hashSource("---\nx: 1\n---\nB"));
check("frontmatter-only edit → SAME hash",
  hashSource("---\nwiki_updated: 2026-06-01\n---\nBODY") ===
  hashSource("---\nwiki_updated: 2026-06-25\nwiki_articles:\n  - \"[[p]]\"\n---\nBODY"));
check("body edit → DIFFERENT hash",
  hashSource("---\nx: 1\n---\nBODY one") !== hashSource("---\nx: 1\n---\nBODY two"));

// =====================================================================
section("computeChangedSources — hash rules");

// 1: no stored key → changed (new source)
check("1 new source (no key) → changed", JSON.stringify(computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:00000001" }],
  analyzed: {},
}).changed) === JSON.stringify(["s/a.md"]));

// 2: stored "" → silent baseline (not changed, returned in baselined)
check("2 empty stored → baselined, not changed", (() => {
  const r = computeChangedSources({
    sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000beef" }],
    analyzed: { "s/a.md": "" },
  });
  return r.changed.length === 0 && r.baselined["s/a.md"] === "fnv1a:0000beef";
})());

// 3: equal hash → skip
check("3 equal hash → not changed", computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000aaaa" }],
  analyzed: { "s/a.md": "fnv1a:0000aaaa" },
}).changed.length === 0);

// 4: differing hash → changed
check("4 differing hash → changed", computeChangedSources({
  sourceFiles: [{ path: "s/a.md", hash: "fnv1a:0000aaaa" }],
  analyzed: { "s/a.md": "fnv1a:0000bbbb" },
}).changed[0] === "s/a.md");

// 5: strict subset — only the edited one
check("5 strict subset", (() => {
  const r = computeChangedSources({
    sourceFiles: [
      { path: "s/a.md", hash: "fnv1a:0000aaaa" }, // matches stored → skip
      { path: "s/b.md", hash: "fnv1a:0000ffff" }, // differs → changed
    ],
    analyzed: { "s/a.md": "fnv1a:0000aaaa", "s/b.md": "fnv1a:00001111" },
  });
  return JSON.stringify(r.changed) === JSON.stringify(["s/b.md"]) && Object.keys(r.baselined).length === 0;
})());

// =====================================================================
// TODO(Task 2): restore migrateDomainsV3 import + tests 6-7
// section("migrateDomainsV3 — list → map");
//
// check("6 list → map of empty hashes + flag", (() => {
//   const domains = [{ id: "d", name: "D", wiki_folder: "d",
//     analyzed_sources: ["x.md", "y.md"], analyzed_sources_v2: true } as unknown as DomainEntry];
//   const { migrated } = migrateDomainsV3(domains);
//   const m = domains[0].analyzed_sources as unknown as Record<string, string>;
//   return migrated === true && m["x.md"] === "" && m["y.md"] === "" && domains[0].analyzed_sources_v3 === true;
// })());
//
// check("7 idempotent (already v3) → no change", (() => {
//   const domains = [{ id: "d", name: "D", wiki_folder: "d",
//     analyzed_sources: { "x.md": "fnv1a:0000aaaa" }, analyzed_sources_v2: true,
//     analyzed_sources_v3: true } as unknown as DomainEntry];
//   const { migrated } = migrateDomainsV3(domains);
//   const m = domains[0].analyzed_sources as unknown as Record<string, string>;
//   return migrated === false && m["x.md"] === "fnv1a:0000aaaa";
// })());

// =====================================================================
section("capList");
check("8 capList under cap returns all", (() => {
  const r = capList(["a", "b"], 20); return r.shown.length === 2 && r.overflow === 0;
})());
check("9 capList over cap truncates + overflow", (() => {
  const names = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const r = capList(names, 20); return r.shown.length === 20 && r.overflow === 5;
})());

// =====================================================================
section("parsePageSources — real on-disk wiki_sources shapes");
check("pp double-quoted wikilink → bare stem",
  JSON.stringify(parsePageSources('---\nwiki_sources:\n  - "[[alpha]]"\n---\nx')) === JSON.stringify(["alpha"]));
check("pp unquoted wikilink → bare stem",
  JSON.stringify(parsePageSources('---\nwiki_sources:\n  - [[alpha]]\n---\nx')) === JSON.stringify(["alpha"]));
check("pp path + .md inside wikilink → basename",
  JSON.stringify(parsePageSources('---\nwiki_sources:\n  - "[[notes/alpha.md]]"\n---\nx')) === JSON.stringify(["alpha"]));
check("pp multiple entries",
  JSON.stringify(parsePageSources('---\nwiki_sources:\n  - "[[a]]"\n  - "[[b]]"\n---\nx')) === JSON.stringify(["a","b"]));
check("pp no wiki_sources → []",
  parsePageSources('---\ntitle: x\n---\nbody').length === 0);

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
