// Keyless deterministic self-check for the analyzer. Run: npx tsx eval/graph-floor/analyze.test.ts
import { sweepQuery, summarize, recommend, type GoldQuery } from "./analyze";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

const q: GoldQuery = {
  id: "t", question: "q", domain: "d", goldPages: ["g", "s"],
  denseMax: 0.59, domainCosines: [0.40, 0.45, 0.50, 0.55, 0.59],
  candidates: [
    { pid: "g", cosine: 0.57, tokens: 100 },
    { pid: "noise", cosine: 0.42, tokens: 100 },
  ],
  goldSeeds: ["s"], // gold page "s" was a seed → always kept
};

const off = sweepQuery(q, 0);
check("ratio 0 prunes nothing", off.prunedTokens === 0 && off.recall === 1);
const on = sweepQuery(q, 0.6);
check("ratio 0.6 prunes noise", on.prunedTokens === 100 && on.kept.includes("g"), `kept=${on.kept.join(",")}`);
check("ratio 0.6 keeps gold candidate + gold seed (recall 1)", on.recall === 1);
const rows = summarize([q], [0, 0.6, 0.95]);
check("summarize tokenCut rises with ratio", rows[1].tokenCutPct > rows[0].tokenCutPct);
check("recommend picks a safe non-zero ratio", (recommend(rows)?.failing ?? 1) === 0);

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
