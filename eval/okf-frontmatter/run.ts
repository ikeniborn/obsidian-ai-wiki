// Run (plain tsx no longer works once splitSections is exercised — it pulls in
// `obsidian` transitively via src/page-similarity.ts):
//   node_modules/.bin/esbuild eval/okf-frontmatter/run.ts \
//     --bundle --platform=node --format=cjs \
//     --alias:obsidian=./eval/okf-frontmatter/obsidian-stub.ts \
//     --outfile=eval/okf-frontmatter/run.cjs
//   node eval/okf-frontmatter/run.cjs
import { renameWikiPageFields, entityTypeFromPath, parseResourceFromFm, ensureType, ensureDescription, validateAndRepairSourceFrontmatter, upsertRawFrontmatter } from "../../src/utils/raw-frontmatter";
import { parseDescriptionFromFm, collectDescriptions, deriveFallbackDescription } from "../../src/wiki-index";
import { splitSections, DEFAULT_CHUNKING } from "../../src/page-similarity";

let pass = 0, fail = 0; const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
---
# X
body [[wiki_d_x]]
`;
const renamed = renameWikiPageFields(legacy);
check("resource present", /^resource:/m.test(renamed));
check("resource is plain (no brackets)", /resource:\s*\n\s*-\s*"?Src"?/m.test(renamed) || /resource:\s*\[\s*"?Src"?\s*\]/.test(renamed));
check("timestamp present", /^timestamp:/m.test(renamed));
check("status present", /^status:/m.test(renamed));
check("wiki_type dropped", !/wiki_type:/m.test(renamed));
check("no legacy wiki_sources", !/wiki_sources:/m.test(renamed));
check("body preserved", renamed.includes("# X\nbody [[wiki_d_x]]"));
check("idempotent", renameWikiPageFields(renamed) === renamed);

// last-wins when both keys exist
const both = `---\nwiki_sources: ["[[A]]"]\nresource: ["[[B]]"]\n---\n# T\n`;
const bothOut = renameWikiPageFields(both);
check("both→single resource key", (bothOut.match(/^resource:/gm) || []).length === 1);

check("type from subdir", entityTypeFromPath("!Wiki/d", "!Wiki/d/person/wiki_d_alice.md") === "person");
check("type entities→concept", entityTypeFromPath("!Wiki/d", "!Wiki/d/entities/wiki_d_x.md") === "concept");
check("type flat→concept", entityTypeFromPath("!Wiki/d", "!Wiki/d/wiki_d_x.md") === "concept");
check("parseResource plain", JSON.stringify(parseResourceFromFm(renamed)) === JSON.stringify(["Src"]));

const noType = `---\nresource: []\n---\n# A\n`;
check("type injected", /^type: person$/m.test(ensureType(noType, "person")));
check("type not duplicated", ensureType(ensureType(noType, "person"), "person").match(/^type:/gm)!.length === 1);
const ann = "Alice is a lead engineer. She owns billing. Covers: invoices, dunning. Terms: AR, ledger.";
check("description = full annotation (verbatim)", ensureDescription(noType, ann).includes(ann));
check("description empty→noop", ensureDescription(noType, "") === noType);

// Task 3 — source notes drop wiki-tracking dates, keep wiki_articles.
const sourceLegacy = `---
title: Src
wiki_added: 2026-05-01
wiki_updated: 2026-07-09
wiki_articles:
  - "[[wiki_d_x]]"
---
# Src
body
`;
const { content: sourceRepaired } = validateAndRepairSourceFrontmatter(sourceLegacy);
check("source: wiki_added dropped", !/^wiki_added:/m.test(sourceRepaired));
check("source: wiki_updated dropped", !/^wiki_updated:/m.test(sourceRepaired));
check("source: wiki_articles kept", /^wiki_articles:/m.test(sourceRepaired) && sourceRepaired.includes("[[wiki_d_x]]"));

const upserted = upsertRawFrontmatter(sourceLegacy, { wiki_articles: ["[[wiki_d_y]]"] });
check("upsertRawFrontmatter: wiki_added stripped", !/^wiki_added:/m.test(upserted));
check("upsertRawFrontmatter: wiki_updated stripped", !/^wiki_updated:/m.test(upserted));
check("upsertRawFrontmatter: only wiki_articles written", upserted.includes("[[wiki_d_y]]") && !upserted.includes("[[wiki_d_x]]"));

// Task 5b — parseDescriptionFromFm reads the frontmatter `description` scalar.
const withDesc = `---\ndescription: "Alice leads the billing team."\n---\n# Alice\nbody\n`;
check("parseDescriptionFromFm reads scalar", parseDescriptionFromFm(withDesc) === "Alice leads the billing team.");
check("parseDescriptionFromFm missing field → \"\"", parseDescriptionFromFm(`---\nresource: []\n---\n# T\n`) === "");
check("parseDescriptionFromFm no frontmatter → \"\"", parseDescriptionFromFm("plain body") === "");

// Task 5b — collectDescriptions: frontmatter description wins, fallback to body derivation,
// `_`-prefixed / non-wiki stems skipped.
const descPages = [
  { path: "!Wiki/d/entities/wiki_d_alice.md", content: withDesc },
  { path: "!Wiki/d/entities/wiki_d_bob.md", content: "# Bob\n\nBob is a data engineer.\n" },
  { path: "!Wiki/d/_index.md", content: "ignore me" },
  { path: "!Wiki/d/notes/not-a-wiki-stem.md", content: "# Skip\n\nshould be skipped.\n" },
];
const descriptions = collectDescriptions(descPages);
check("collectDescriptions: frontmatter description used", descriptions.get("wiki_d_alice") === "Alice leads the billing team.");
check("collectDescriptions: fallback for page w/o description", descriptions.get("wiki_d_bob") === deriveFallbackDescription("# Bob\n\nBob is a data engineer.\n"));
check("collectDescriptions: `_`-prefixed stem skipped", !descriptions.has("_index"));
check("collectDescriptions: non-wiki stem skipped", !descriptions.has("not-a-wiki-stem"));

// Task 5b — splitSections excludes `## Related` / `## External links` from retrieval chunks.
const bodyWithLinkSections = [
  "# Alice",
  "",
  "Alice is a lead engineer on the billing team.",
  "",
  "## Key characteristics",
  "",
  "Owns invoices and dunning workflows.",
  "",
  "## Related",
  "",
  "- [[wiki_d_bob]]",
  "- [[wiki_d_carol]]",
  "",
  "## External links",
  "",
  "- [Billing docs](https://example.com/billing)",
  "",
].join("\n");
const sectionWindows = splitSections(bodyWithLinkSections, DEFAULT_CHUNKING);
check("splitSections drops ## Related", !sectionWindows.some((w) => w.heading.toLowerCase() === "## related"));
check("splitSections drops ## External links", !sectionWindows.some((w) => w.heading.toLowerCase() === "## external links"));
check("splitSections keeps other sections", sectionWindows.some((w) => w.heading === "## Key characteristics"));
check("splitSections: no relocated-link text leaks into any surviving chunk",
  !sectionWindows.some((w) => w.window.includes("wiki_d_bob") || w.window.includes("example.com/billing")));

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
