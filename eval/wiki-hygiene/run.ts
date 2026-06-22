/**
 * Out-of-vault eval for the wiki-hygiene pure functions. Exercises the REAL
 * functions from src/ against synthetic fixtures. No vault, no LLM, no DOM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/wiki-hygiene/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/wiki-hygiene/run.cjs
 *   node eval/wiki-hygiene/run.cjs
 */
import { stripDeadLinks } from "../../src/wiki-link-validator";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

console.log("\n=== stripDeadLinks ===");
{
  // known = {alive}. dead link in prose + table + frontmatter outgoing.
  const known = new Set(["alive", "src_note"]);
  const content = [
    "---",
    "wiki_sources:",
    '  - "[[src_note]]"',
    "wiki_outgoing_links:",
    '  - "[[alive]]"',
    '  - "[[dead]]"',
    "---",
    "# Title",
    "",
    "Refs [[alive]] and [[dead]] inline.",
    "",
    "| Field | Value |",
    "|-------|-------|",
    "| Rel | [[dead]] |",
  ].join("\n");
  const out = stripDeadLinks(content, known);
  check("dead link removed from body prose", !out.includes("[[dead]]"), out);
  check("alive link kept", out.includes("[[alive]]"));
  check("source-note link in wiki_sources untouched", out.includes('"[[src_note]]"'));
  check("wiki_outgoing_links re-synced (no dead)", /wiki_outgoing_links:\n {2}- "\[\[alive\]\]"\n---/.test(out), out);
  check("no double space left in prose", !/Refs {2}and/.test(out) && out.includes("Refs [[alive]] and"), out);
}
{
  // dead link at sentence end → no dangling space before period.
  const out = stripDeadLinks("# T\n\nSee [[gone]].\n", new Set<string>());
  check("dangling space before period tidied", out.includes("See.") || out.includes("See ."), JSON.stringify(out));
}
{
  // no frontmatter → operate on whole content as body, no crash.
  const out = stripDeadLinks("plain [[gone]] text", new Set<string>());
  check("no-frontmatter body cleaned", out === "plain text", JSON.stringify(out));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
