/**
 * Out-of-vault eval for the source-deletion planner. Exercises the REAL pure
 * functions from src/source-deletion.ts against synthetic fixtures. No vault, no LLM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/source-deletion/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./eval/source-deletion/obsidian-stub.ts \
 *     --outfile=eval/source-deletion/run.cjs
 *   node eval/source-deletion/run.cjs
 */
import { computeDeletionPlan, isSourceFile, stripSourceToken } from "../../src/source-deletion";
import { parseWikiSources } from "../../src/utils/vault-walk";
import type { DomainEntry } from "../../src/domain";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// Helper: build a wiki page body with a plain resource list (YAML block form).
function page(sources: string[]): string {
  const list = sources.map((s) => `  - "${s}"`).join("\n");
  return `---\nresource:\n${list}\n---\n# Page\n`;
}

// Helper: build a wiki page body with a plain resource list (YAML flow form,
// the single-line shape the ingest prompt literally emits: resource: ["stem"]).
function pageFlow(sources: string[]): string {
  const list = sources.map((s) => `"${s}"`).join(", ");
  return `---\nresource: [${list}]\n---\n# Page\n`;
}

section("computeDeletionPlan");
{
  const pages = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_a.md", page(["note"])],            // sole-source → delete
    ["!Wiki/work/Type/wiki_work_b.md", page(["note", "other"])],   // multi → rebuild on "other"
    ["!Wiki/work/Type/wiki_work_c.md", page(["unrelated"])],       // ignore
    ["!Wiki/work/Type/wiki_work_d.md", page(["note", "other"])],   // multi → shares "other"
  ]);
  const stemToPath = new Map<string, string>([
    ["other", "src/other.md"],
    ["unrelated", "src/unrelated.md"],
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, stemToPath);

  check("sole-source page goes to toDelete",
    plan.toDelete.includes("!Wiki/work/Type/wiki_work_a.md") && plan.toDelete.length === 1,
    JSON.stringify(plan.toDelete));
  check("multi-source pages go to toRebuild",
    plan.toRebuild.includes("!Wiki/work/Type/wiki_work_b.md") &&
    plan.toRebuild.includes("!Wiki/work/Type/wiki_work_d.md") && plan.toRebuild.length === 2,
    JSON.stringify(plan.toRebuild));
  check("unrelated page ignored",
    !plan.toDelete.includes("!Wiki/work/Type/wiki_work_c.md") &&
    !plan.toRebuild.includes("!Wiki/work/Type/wiki_work_c.md"));
  check("remainingSources deduped and excludes target",
    plan.remainingSources.length === 1 && plan.remainingSources[0] === "src/other.md",
    JSON.stringify(plan.remainingSources));
}

section("stem matching edge cases");
{
  const pages = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_x.md", page(["note-2"])], // must NOT match "note"
  ]);
  const plan = computeDeletionPlan("src/note.md", pages, new Map());
  check("note does not false-match note-2",
    plan.toDelete.length === 0 && plan.toRebuild.length === 0, JSON.stringify(plan));

  const pages2 = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_y.md", page(["note", "ghost"])], // "ghost" resolves to nothing
  ]);
  const plan2 = computeDeletionPlan("src/note.md", pages2, new Map());
  check("unresolved remaining stem is dropped",
    plan2.toRebuild.length === 1 && plan2.remainingSources.length === 0, JSON.stringify(plan2));
}

section("isSourceFile");
{
  const domain = { id: "work", name: "Work", wiki_folder: "work", source_paths: ["src", "notes/foo.md"] } as DomainEntry;
  check("wiki page is not a source", isSourceFile("!Wiki/work/Type/wiki_work_a.md", domain) === false);
  check("file under source folder is a source", isSourceFile("src/note.md", domain) === true);
  check("exact file source entry matches", isSourceFile("notes/foo.md", domain) === true);
  check("unrelated file is not a source", isSourceFile("other/x.md", domain) === false);
}

section("flow-form resource (ingest prompt emits resource: [\"stem\"], Task 4 fix)");
{
  // sole-source flow-form page → toDelete
  const pagesA = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_flow_a.md", pageFlow(["note"])],
  ]);
  const planA = computeDeletionPlan("src/note.md", pagesA, new Map());
  check("flow-form sole-source page → toDelete",
    planA.toDelete.includes("!Wiki/work/Type/wiki_work_flow_a.md") && planA.toDelete.length === 1,
    JSON.stringify(planA));

  // multi-source flow-form page → toRebuild, target stem removed, other kept
  const pagesB = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_flow_b.md", pageFlow(["note", "other"])],
  ]);
  const stemToPath = new Map<string, string>([["other", "src/other.md"]]);
  const planB = computeDeletionPlan("src/note.md", pagesB, stemToPath);
  check("flow-form multi-source page → toRebuild",
    planB.toRebuild.includes("!Wiki/work/Type/wiki_work_flow_b.md") && planB.toRebuild.length === 1,
    JSON.stringify(planB));
  check("flow-form multi-source page → target stem removed, other kept",
    planB.remainingSources.length === 1 && planB.remainingSources[0] === "src/other.md",
    JSON.stringify(planB));

  // block-form vs flow-form parity for the same logical page
  const planBlock = computeDeletionPlan(
    "src/note.md", new Map([["p", page(["note", "other"])]]), stemToPath,
  );
  check("block-form and flow-form agree (remainingSources)",
    JSON.stringify(planBlock.remainingSources) === JSON.stringify(planB.remainingSources));
}

section("deletion guard — flow-form page survives unrelated deletion (highest-risk area)");
{
  // Page has resource: ["other"] (flow form) and NO wiki_sources: key at all —
  // matches a real migrated OKF page. Deleting an UNRELATED source must not
  // touch it (regression: block-list-only regex used to silently parse this as []).
  const pages = new Map<string, string>([
    ["!Wiki/work/Type/wiki_work_flow_c.md", pageFlow(["other"])],
  ]);
  const planUnrelated = computeDeletionPlan("src/note.md", pages, new Map());
  check("flow-form page with unrelated resource is NOT toDelete",
    !planUnrelated.toDelete.includes("!Wiki/work/Type/wiki_work_flow_c.md"),
    JSON.stringify(planUnrelated));
  check("flow-form page with unrelated resource is NOT toRebuild",
    !planUnrelated.toRebuild.includes("!Wiki/work/Type/wiki_work_flow_c.md"),
    JSON.stringify(planUnrelated));

  // Same page — deleting ITS actual (sole) source still works.
  const planSole = computeDeletionPlan("src/other.md", pages, new Map());
  check("flow-form sole-source deletion still works when it IS the target",
    planSole.toDelete.includes("!Wiki/work/Type/wiki_work_flow_c.md") && planSole.toDelete.length === 1,
    JSON.stringify(planSole));
}

section("parseWikiSources (vault-walk.ts) — block and flow resource forms");
{
  check("block form → bare stem",
    JSON.stringify(parseWikiSources('---\nresource:\n  - "alpha"\n---\nx')) === JSON.stringify(["alpha"]));
  check("flow form → bare stem",
    JSON.stringify(parseWikiSources('---\nresource: ["alpha"]\n---\nx')) === JSON.stringify(["alpha"]));
  check("flow form multiple entries",
    JSON.stringify(parseWikiSources('---\nresource: ["a", "b"]\n---\nx')) === JSON.stringify(["a", "b"]));
  check("no resource → []", parseWikiSources("---\ntitle: x\n---\nbody").length === 0);
}

section("stripSourceToken");
{
  check("double-quoted stem → bare stem", stripSourceToken(`"note"`) === "note");
  check("single-quoted stem → bare stem", stripSourceToken(`'note'`) === "note");
  check("plain stem passes through", stripSourceToken("note") === "note");
  check("interior whitespace trimmed", stripSourceToken(`  "note"  `) === "note");
}

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
