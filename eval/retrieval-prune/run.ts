/**
 * Out-of-vault unit test for pruneByRelevance. No Obsidian, no API key.
 * Run: npx tsx eval/retrieval-prune/run.ts
 */
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../../src/retrieval-prune";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// deepseek-like compressed domain: cosines clustered high, one outlier low.
const domainCosines = [0.40, 0.44, 0.47, 0.50, 0.52, 0.55, 0.59];
const loRef = robustLow(domainCosines, FLOOR_LO_PCT); // p5 ≈ 0.412

section("robustLow percentile");
{
  check("empty → 0", robustLow([], 0.05) === 0);
  check("single → itself", robustLow([0.5], 0.05) === 0.5);
  check("p0 → min", robustLow(domainCosines, 0) === 0.40);
  check("p100 → max", robustLow(domainCosines, 1) === 0.59);
  check("p5 between min and 2nd", loRef > 0.40 && loRef < 0.44, `loRef=${loRef}`);
}

section("spread-relative bar (denseRef=0.59)");
{
  // bar = loRef + 0.6·(0.59 − loRef) ≈ 0.412 + 0.6·0.178 ≈ 0.519
  const denseByPid = { hi: 0.57, mid: 0.50, lo: 0.44, out: 0.40 };
  const r = pruneByRelevance(["hi", "mid", "lo", "out"], denseByPid, 0.59, loRef, 0.6);
  const bar = r.bar;
  check("bar within (loRef, denseRef)", bar > loRef && bar < 0.59, `bar=${bar}`);
  check("keeps >= bar (hi)", r.keep.has("hi"));
  check("drops < bar (mid,lo,out)", !r.keep.has("mid") && !r.keep.has("lo") && !r.keep.has("out"),
    `kept=${[...r.keep].join(",")}`);
  check("prunes the compressed tail (was a no-op under ratio·denseMax)", r.pruned.length === 3,
    `pruned=${r.pruned.join(",")}`);
  check("not collapsed", r.collapsed === false);
}

section("boundary kept (>=)");
{
  const bar = loRef + 0.6 * (0.59 - loRef);
  const r = pruneByRelevance(["e"], { e: bar }, 0.59, loRef, 0.6);
  check("score exactly at bar kept", r.keep.has("e") && r.pruned.length === 0);
}

section("missing score kept");
{
  const r = pruneByRelevance(["x"], {}, 0.59, loRef, 0.6);
  check("missing score kept", r.keep.has("x") && r.pruned.length === 0);
}

section("range collapsed → skip (keep-all)");
{
  // denseRef ≈ loRef → cannot normalize → keep everything, collapsed flag set.
  const denseByPid = { a: 0.50, b: 0.41 };
  const r = pruneByRelevance(["a", "b"], denseByPid, 0.50, 0.50, 0.6);
  check("collapsed flagged", r.collapsed === true);
  check("collapsed keeps all", r.keep.size === 2 && r.pruned.length === 0);
}

section("zero ratio → keep-all (off switch)");
{
  const denseByPid = { a: 0.57, b: 0.40 };
  const r = pruneByRelevance(["a", "b"], denseByPid, 0.59, loRef, 0);
  check("ratio 0 keeps all", r.keep.size === 2 && r.pruned.length === 0);
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
