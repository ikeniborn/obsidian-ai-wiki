/**
 * Out-of-vault eval for the OKF startup migration. Exercises the REAL pure functions
 * `migrateWikiPageOkf` / `relocateFrontmatterLinks` from src/migrate-okf-frontmatter.ts
 * against a synthetic legacy fixture. No vault, no LLM.
 *
 * `npx tsx eval/okf-migrate/run.ts` may fail if tsx tries to resolve the `obsidian` module
 * chain (this file's driver imports `Notice`/`Vault` from "obsidian", a types-only package
 * with no runtime). If so, build & run with esbuild instead:
 *   node_modules/.bin/esbuild eval/okf-migrate/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./eval/okf-migrate/obsidian-stub.ts \
 *     --outfile=eval/okf-migrate/run.cjs
 *   node eval/okf-migrate/run.cjs
 */
import { migrateWikiPageOkf, relocateFrontmatterLinks } from "../../src/migrate-okf-frontmatter";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

// ---------------------------------------------------------------------------
// migrateWikiPageOkf — full pipeline on a legacy page
// ---------------------------------------------------------------------------
const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
wiki_outgoing_links: ["[[wiki_d_y]]"]
wiki_external_links: ["https://a.b"]
---
# Alice

Alice leads billing.
`;

const out = migrateWikiPageOkf(
  legacy,
  "!Wiki/d",
  "!Wiki/d/person/wiki_d_alice.md",
  "Alice leads billing. Owns invoices.",
);

check("resource plain", /resource:\s*\n\s*-\s*"?Src"?/.test(out) || /resource:\s*\[\s*"?Src"?/.test(out), out);
check("timestamp/status/type", /^timestamp:/m.test(out) && /^status:/m.test(out) && /^type: person$/m.test(out), out);
check("description set", /^description: /m.test(out), out);
check("no frontmatter outgoing/external", !/wiki_outgoing_links:/m.test(out) && !/wiki_external_links:/m.test(out), out);
check("## Related in body", /^## Related$/m.test(out) && out.includes("[[wiki_d_y]]"), out);
check("## External links in body", /^## External links$/m.test(out) && out.includes("https://a.b"), out);
check(
  "idempotent",
  migrateWikiPageOkf(out, "!Wiki/d", "!Wiki/d/person/wiki_d_alice.md", "Alice leads billing. Owns invoices.") === out,
);

// ---------------------------------------------------------------------------
// relocateFrontmatterLinks — unit checks
// ---------------------------------------------------------------------------
const noLinks = `---
resource:
  - Src
timestamp: 2026-07-09
status: developing
---
# X
body
`;
check("no-op when no frontmatter link arrays", relocateFrontmatterLinks(noLinks) === noLinks);

const mergeFixture = `---
wiki_outgoing_links: ["[[wiki_d_y]]", "[[wiki_d_z]]"]
wiki_external_links: ["https://a.b", "https://c.d"]
---
# X

## Related

- [[wiki_d_z]]

## External links

- [existing](https://c.d)
`;
const merged = relocateFrontmatterLinks(mergeFixture);
check("merge dedupes existing Related link", (merged.match(/\[\[wiki_d_z\]\]/g) ?? []).length === 1, merged);
check("merge adds missing Related link", merged.includes("[[wiki_d_y]]"), merged);
check("merge dedupes existing External link by url", (merged.match(/https:\/\/c\.d/g) ?? []).length === 1, merged);
check("merge adds missing External link", merged.includes("https://a.b"), merged);
check("relocateFrontmatterLinks is idempotent", relocateFrontmatterLinks(merged) === merged);

// ---------------------------------------------------------------------------
// malformed wiki_outgoing_links (scalar, not a block-list) — defensive fix regression
// ---------------------------------------------------------------------------
const malformed = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
wiki_outgoing_links: not-an-array
---
# Alice

Alice leads billing.
`;

let malformedThrew = false;
let relocated = "";
try {
  relocated = relocateFrontmatterLinks(malformed);
} catch {
  malformedThrew = true;
}
check("relocateFrontmatterLinks does not throw on malformed wiki_outgoing_links", !malformedThrew, relocated);
check("malformed wiki_outgoing_links key kept in frontmatter (not silently dropped)", /^wiki_outgoing_links:/m.test(relocated), relocated);
check("no ## Related fabricated from malformed wiki_outgoing_links", !/^## Related$/m.test(relocated), relocated);

let malformedFullThrew = false;
let migratedMalformed = "";
try {
  migratedMalformed = migrateWikiPageOkf(
    malformed,
    "!Wiki/d",
    "!Wiki/d/person/wiki_d_alice.md",
    "Alice leads billing.",
  );
} catch {
  malformedFullThrew = true;
}
check("migrateWikiPageOkf does not throw on malformed wiki_outgoing_links", !malformedFullThrew, migratedMalformed);
check("migrateWikiPageOkf keeps malformed wiki_outgoing_links key in frontmatter", /^wiki_outgoing_links:/m.test(migratedMalformed), migratedMalformed);
check("migrateWikiPageOkf does not fabricate ## Related from malformed wiki_outgoing_links", !/^## Related$/m.test(migratedMalformed), migratedMalformed);

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
