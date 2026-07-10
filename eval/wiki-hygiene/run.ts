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
import { deriveFallbackDescription, reconcileIndex } from "../../src/wiki-index";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

console.log("\n=== stripDeadLinks ===");
{
  // known = {alive, src_note}. dead link in prose + table; resource in frontmatter.
  const known = new Set(["alive", "src_note"]);
  const content = [
    "---",
    "resource:",
    '  - "src_note"',
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
  check("resource entry untouched", out.includes('"src_note"'));
  // Task 4: stripDeadLinks no longer re-syncs a frontmatter outgoing-link array —
  // the ## Related body section is canonical now, so frontmatter is left as-is.
  check("frontmatter left untouched (no more link re-sync)",
    out.startsWith('---\nresource:\n  - "src_note"\n---\n'), out);
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
{
  const out = stripDeadLinks("a [[x]] [[y]] b", new Set<string>());
  check("adjacent dead links collapse to single space", out === "a b", JSON.stringify(out));
}

console.log("\n=== deriveFallbackDescription ===");
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
  const a = deriveFallbackDescription(content, "entities");
  check("starts with H1", a.startsWith("CH_METE_S3_DDRD — "), a);
  check("contains first sentence", a.includes("CH_METE_S3_DDRD is a Clickhouse table type."), a);
  check("has Type", a.includes("Type: entities"), a);
  check("single line", !a.includes("\n"), a);
}
{
  const a = deriveFallbackDescription("# Only Title\n", undefined);
  check("missing body → still has title + general type", a.startsWith("Only Title") && a.includes("Type: general"), a);
}
{
  const longBody = "# T\n\n" + "word ".repeat(400);
  const a = deriveFallbackDescription(longBody, "tasks");
  check("truncated to <= 800 chars", a.length <= 800, String(a.length));
}
{
  const a = deriveFallbackDescription("# T\n\nLinks [[wiki_x_minio]] here.\n", "entities");
  check("wikilink brackets unwrapped in annotation", !a.includes("[[") && a.includes("wiki_x_minio"), a);
}

{
  const a = deriveFallbackDescription("---\r\nwiki_status: stub\r\n---\r\n# CRLF Title\r\n\r\nFirst sentence here.\r\n", "entities");
  check("CRLF frontmatter stripped", a.startsWith("CRLF Title — ") && !a.includes("wiki_status"), a);
}
{
  const a = deriveFallbackDescription("# Code Page\n\n```sql\nSELECT 1;\n```\n\nReal prose sentence.\n", "entities");
  check("code fence skipped in fallback", !a.includes("```") && !a.includes("SELECT"), a);
}

console.log("\n=== reconcileIndex ===");
{
  const wikiFolder = "!Wiki/dom";
  const index = [
    "# Wiki Index",
    "",
    "## tasks",
    "- wiki_dom_keep — kept. Type: task.",
    "- wiki_dom_orphan — orphan, file gone. Type: task.",
  ].join("\n");
  const pages = [
    { path: "!Wiki/dom/tasks/wiki_dom_keep.md", content: "# Keep\n\nbody", annotation: "kept. Type: task." },
    { path: "!Wiki/dom/entities/wiki_dom_new.md", content: "# New\n\nNew entity body.", annotation: "" },
    { path: "!Wiki/dom/_index.md", content: "ignore me" },
  ];
  const r = reconcileIndex(index, wikiFolder, pages);
  check("orphan flagged for removal", r.removes.includes("wiki_dom_orphan"), JSON.stringify(r.removes));
  check("kept page not re-added", !r.adds.some((a) => a.pid === "wiki_dom_keep"), JSON.stringify(r.adds));
  check("new page added", r.adds.some((a) => a.pid === "wiki_dom_new"), JSON.stringify(r.adds));
  check("new page got fallback annotation", (r.adds.find((a) => a.pid === "wiki_dom_new")?.annotation.includes("New entity body.")) ?? false, JSON.stringify(r.adds));
  check("meta file ignored", !r.adds.some((a) => a.pid.includes("index")), JSON.stringify(r.adds));
}
{
  // page already-annotated keeps its annotation, not the fallback.
  const r = reconcileIndex("# Wiki Index\n", "!Wiki/dom", [
    { path: "!Wiki/dom/tasks/wiki_dom_a.md", content: "# A\n\nbody.", annotation: "real ann. Type: task." },
  ]);
  check("real annotation preserved on add", r.adds[0]?.annotation === "real ann. Type: task.", JSON.stringify(r.adds));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
