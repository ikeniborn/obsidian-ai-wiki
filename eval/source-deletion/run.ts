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
import type { DomainEntry } from "../../src/domain";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// Helper: build a wiki page body with a wiki_sources list.
function page(sources: string[]): string {
  const list = sources.map((s) => `  - "[[${s}]]"`).join("\n");
  return `---\nwiki_sources:\n${list}\n---\n# Page\n`;
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

section("stripSourceToken");
{
  check("double-quoted wikilink → bare stem", stripSourceToken(`"[[note]]"`) === "note");
  check("single-quoted wikilink → bare stem", stripSourceToken(`'[[note]]'`) === "note");
  check("plain wikilink → bare stem", stripSourceToken("[[note]]") === "note");
  check("interior whitespace trimmed", stripSourceToken(`  "[[note]]"  `) === "note");
}

console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
