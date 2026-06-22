/**
 * Out-of-vault eval for isWikiArticlePath. Exercises the REAL pure function
 * from src/wiki-path.ts against synthetic paths. No vault, no LLM, no DOM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/format-button/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/format-button/run.cjs
 *   node eval/format-button/run.cjs
 */
import { isWikiArticlePath } from "../../src/wiki-path";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

console.log("\n=== isWikiArticlePath ===");
check("wiki root exactly is wiki", isWikiArticlePath("!Wiki") === true);
check("domain wiki article is wiki", isWikiArticlePath("!Wiki/Alpha/Page.md") === true);
check("wiki config file is wiki", isWikiArticlePath("!Wiki/_config/_index.md") === true);
check("plain source file is not wiki", isWikiArticlePath("Sources/doc.md") === false);
check("note outside wiki is not wiki", isWikiArticlePath("notes/x.md") === false);
check("prefix without slash boundary is not wiki", isWikiArticlePath("!WikiOther/z.md") === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
