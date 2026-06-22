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
import { deriveFallbackAnnotation } from "../../src/wiki-index";

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
  check("dangling space before period tidied", out.includes("See."), JSON.stringify(out));
}
{
  // no frontmatter → operate on whole content as body, no crash.
  const out = stripDeadLinks("plain [[gone]] text", new Set<string>());
  check("no-frontmatter body cleaned", out === "plain text", JSON.stringify(out));
}

console.log("\n=== deriveFallbackAnnotation ===");
{
  const content = [
    "---", "wiki_status: stub", "---",
    "# CH_METE_S3_DDRD",
    "",
    "CH_METE_S3_DDRD is a Clickhouse table type. It exports to S3.",
    "",
    "## Details",
    "more text",
  ].join("\n");
  const a = deriveFallbackAnnotation(content, "entities");
  check("starts with H1", a.startsWith("CH_METE_S3_DDRD — "), a);
  check("contains first sentence", a.includes("CH_METE_S3_DDRD is a Clickhouse table type."), a);
  check("has Type", a.includes("Type: entities"), a);
  check("single line", !a.includes("\n"), a);
}
{
  const a = deriveFallbackAnnotation("# Only Title\n", undefined);
  check("missing body → still has title + general type", a.startsWith("Only Title") && a.includes("Type: general"), a);
}
{
  const longBody = "# T\n\n" + "word ".repeat(400);
  const a = deriveFallbackAnnotation(longBody, "tasks");
  check("truncated to <= 800 chars", a.length <= 800, String(a.length));
}
{
  const a = deriveFallbackAnnotation("# T\n\nLinks [[wiki_x_minio]] here.\n", "entities");
  check("wikilink brackets unwrapped in annotation", !a.includes("[[") && a.includes("wiki_x_minio"), a);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
