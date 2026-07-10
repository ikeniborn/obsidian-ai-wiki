// Run: npx tsx eval/okf-frontmatter/run.ts
import { renameWikiPageFields, entityTypeFromPath, parseResourceFromFm } from "../../src/utils/raw-frontmatter";

let pass = 0, fail = 0; const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
wiki_outgoing_links: ["[[wiki_d_x]]"]
wiki_external_links: ["https://a.b"]
---
# X
body [[wiki_d_x]]
`;
const renamed = renameWikiPageFields(legacy);
check("resource present", /^resource:/m.test(renamed));
check("timestamp present", /^timestamp:/m.test(renamed));
check("status present", /^status:/m.test(renamed));
check("outgoing_links present", /^outgoing_links:/m.test(renamed));
check("external_links present", /^external_links:/m.test(renamed));
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
check("parseResource reads resource", JSON.stringify(parseResourceFromFm(renamed)) === JSON.stringify(["[[Src]]"]));

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
