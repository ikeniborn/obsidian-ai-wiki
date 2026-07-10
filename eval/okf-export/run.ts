// Pure eval for the OKF export helpers (src/okf-export-utils.ts). No vault, no LLM,
// no obsidian import in the module under test — only `normalizeTag` from
// raw-frontmatter — so plain `npx tsx eval/okf-export/run.ts` should work.
import {
  buildPidToRelpath,
  rewriteWikilinks,
  normalizeExportTags,
  deriveTitle,
} from "../../src/okf-export-utils";
import { buildOkfBundle } from "../../src/okf-export";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

// ---------------------------------------------------------------------------
// buildPidToRelpath + rewriteWikilinks — plain / alias / dead links
// ---------------------------------------------------------------------------
const pidToRel = buildPidToRelpath(["person/wiki_d_alice.md", "tool/wiki_d_docker.md"]);
check("buildPidToRelpath keys by stem", pidToRel.get("wiki_d_alice") === "person/wiki_d_alice.md");
check("buildPidToRelpath keys by stem (2)", pidToRel.get("wiki_d_docker") === "tool/wiki_d_docker.md");

{
  const { body, dead } = rewriteWikilinks("See [[wiki_d_alice]] for details.", pidToRel);
  check("plain link rewritten", body.includes("[wiki_d_alice](person/wiki_d_alice.md)"), body);
  check("plain link — no dead entries", dead.length === 0, JSON.stringify(dead));
}

{
  const { body, dead } = rewriteWikilinks("Uses [[wiki_d_docker|Docker]] for builds.", pidToRel);
  check("alias link rewritten", body.includes("[Docker](tool/wiki_d_docker.md)"), body);
  check("alias link — no dead entries", dead.length === 0, JSON.stringify(dead));
}

{
  const { body, dead } = rewriteWikilinks("Haunted by [[wiki_d_ghost]].", pidToRel);
  check("dead link degrades to text (no markdown link)", !body.includes("](") , body);
  check("dead link text preserved", body.includes("wiki_d_ghost"), body);
  check("dead link recorded in dead[]", dead.includes("wiki_d_ghost"), JSON.stringify(dead));
}

{
  const { body, dead } = rewriteWikilinks("Ghost alias [[wiki_d_ghost|Casper]].", pidToRel);
  check("dead aliased link degrades to alias text", body.includes("Casper") && !body.includes("](") , body);
  check("dead aliased link recorded by stem", dead.includes("wiki_d_ghost"), JSON.stringify(dead));
}

// ---------------------------------------------------------------------------
// normalizeExportTags — kebab, dedupe
// ---------------------------------------------------------------------------
check(
  "normalizeExportTags kebabs + dedupes",
  JSON.stringify(normalizeExportTags(["a/b", "a/b", "C D"])) === JSON.stringify(["a-b", "c-d"]),
  JSON.stringify(normalizeExportTags(["a/b", "a/b", "C D"])),
);

// ---------------------------------------------------------------------------
// deriveTitle — H1 or slug fallback
// ---------------------------------------------------------------------------
check(
  "deriveTitle reads H1 after stripped frontmatter",
  deriveTitle("---\n---\n# Alice Cooper\nx", "wiki_d_alice") === "Alice Cooper",
);
check(
  "deriveTitle falls back to slug when no H1",
  deriveTitle("no heading", "wiki_d_alice") === "wiki_d_alice",
);

// ---------------------------------------------------------------------------
// buildOkfBundle — frontmatter passthrough + title/tags + body link rewrite,
// generated index.md/log.md, reserved-slug collision warnings
// ---------------------------------------------------------------------------
{
  const pages = [
    {
      relpath: "person/wiki_d_alice.md",
      content: `---\ntype: person\nresource: ["Src"]\ntimestamp: 2026-07-09\ntags: [team/eng]\n---\n# Alice\nLead engineer.\n\n## Related\n- [[wiki_d_docker]]\n`,
    },
    { relpath: "tool/wiki_d_docker.md", content: `---\ntype: tool\ntimestamp: 2026-07-09\n---\n# Docker\n` },
  ];
  const bundle = buildOkfBundle(pages, new Map([["wiki_d_alice", "Alice leads billing."]]), "log line\n");
  const alice = bundle.files.find((f) => f.relpath === "person/wiki_d_alice.md")!;
  check("bundle rewrites body ## Related link", alice.content.includes("[wiki_d_docker](tool/wiki_d_docker.md)"), alice.content);
  check("bundle derives title", /^title: Alice$/m.test(alice.content), alice.content);
  check("bundle backfills description from index", /^description: Alice leads billing\.$/m.test(alice.content), alice.content);
  check("bundle kebabs tags", /team-eng/.test(alice.content), alice.content);
  check("bundle keeps resource plain", /resource:\s*\n\s*-\s*Src|resource:\s*\[\s*Src/.test(alice.content), alice.content);
  check("bundle generates index.md", bundle.files.some((f) => f.relpath === "index.md"));
  check("bundle index has description line", bundle.files.find((f) => f.relpath === "index.md")!.content.includes("Alice leads billing."));
  check("bundle generates log.md", bundle.files.some((f) => f.relpath === "log.md" && f.content.includes("log line")));
  check("bundle no dead-link warnings here", bundle.warnings.length === 0, JSON.stringify(bundle.warnings));
}

{
  const collide = [{ relpath: "index.md", content: "---\ntype: concept\n---\n# real page\n" }];
  const b2 = buildOkfBundle(collide, new Map(), "");
  check("reserved-slug collision warned", b2.warnings.some((w) => w.includes("index.md")), JSON.stringify(b2.warnings));
}

{
  const pages = [{ relpath: "x/wiki_d_x.md", content: `---\ntype: concept\n---\n# X\nSee [[wiki_d_ghost]].\n` }];
  const b3 = buildOkfBundle(pages, new Map(), "");
  check("dead body link recorded in warnings", b3.warnings.some((w) => w.includes("wiki_d_ghost")), JSON.stringify(b3.warnings));
}

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
