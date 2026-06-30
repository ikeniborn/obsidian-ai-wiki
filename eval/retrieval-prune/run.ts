/**
 * Out-of-vault unit test for pruneByRelevance. No Obsidian, no API key.
 * Run: npx tsx eval/retrieval-prune/run.ts
 */
import { pruneByRelevance } from "../../src/retrieval-prune";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// denseRef = 0.6, ratio = 0.6 → bar = 0.36
const denseByPid = { a: 0.55, b: 0.30, c: 0.36, d: 0.10 };

section("threshold");
{
  const r1 = pruneByRelevance(["a", "b", "c", "d"], denseByPid, 0.6, 0.6);
  check("keeps >= bar (a,c)", r1.keep.has("a") && r1.keep.has("c"));
  check("drops < bar (b,d)", !r1.keep.has("b") && !r1.keep.has("d"));
  check("pruned lists b,d", r1.pruned.length === 2 && r1.pruned.includes("b") && r1.pruned.includes("d"),
    `pruned=${r1.pruned.join(",")}`);
}

section("missing score");
{
  // missing score → kept (cannot evaluate → no quality loss)
  const r2 = pruneByRelevance(["x"], {}, 0.6, 0.6);
  check("missing score kept", r2.keep.has("x") && r2.pruned.length === 0);
}

section("boundary");
{
  // boundary exactly at bar → kept (>=)
  const r3 = pruneByRelevance(["e"], { e: 0.36 }, 0.6, 0.6);
  check("boundary kept", r3.keep.has("e"));
}

section("zero ref");
{
  // denseRef 0 → bar 0 → all kept
  const r4 = pruneByRelevance(["a", "d"], denseByPid, 0, 0.6);
  check("zero ref keeps all", r4.keep.size === 2 && r4.pruned.length === 0,
    `pruned=${r4.pruned.join(",")}`);
}

section("zero ratio");
{
  // ratio 0 → bar 0 → all kept (distinct from denseRef = 0)
  const r5 = pruneByRelevance(["a", "d"], denseByPid, 0.6, 0);
  check("zero ratio keeps all", r5.keep.size === 2 && r5.pruned.length === 0,
    `pruned=${r5.pruned.join(",")}`);
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
