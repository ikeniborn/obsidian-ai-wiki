// Run: npx tsx eval/okf-frontmatter/run.ts
import { renameWikiPageFields, entityTypeFromPath, parseResourceFromFm, ensureType, ensureDescription, validateAndRepairSourceFrontmatter, upsertRawFrontmatter } from "../../src/utils/raw-frontmatter";

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

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
