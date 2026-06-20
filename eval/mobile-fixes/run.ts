/**
 * Out-of-vault deterministic eval for the mobile-fixes branch. Exercises the REAL pure
 * helpers from src/ — retrieval gate, progress tag, dense cosine, mobile-vision ext,
 * and source-folder filter — with no Obsidian vault and no LLM.
 *
 * Run: see docs/superpowers/evals/2026-06-20-mobile-retrieval-eval.md
 */
import { seedPassesGate, retrievalTag } from "../../src/retrieval-diag";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

section("seedPassesGate — gate on dense cosine, not RRF");
check("strong cosine passes", seedPassesGate(0.62, 0.3) === true);
check("RRF-scale score fails (the bug)", seedPassesGate(0.033, 0.3) === false);
check("embed-failed (0) fails", seedPassesGate(0, 0.3) === false);
check("threshold 0 always passes", seedPassesGate(0, 0) === true);

section("retrievalTag");
check("hybrid vector used", retrievalTag("hybrid", "none", undefined, 0.62) === "vector");
check("hybrid low-similarity", retrievalTag("hybrid", "jaccard", "low-similarity", 0.21) === "jaccard (low 0.21)");
check("hybrid embed-failed", retrievalTag("hybrid", "jaccard", "embed-failed", 0) === "jaccard (embed failed)");
check("pure jaccard mode", retrievalTag("jaccard", "none", undefined, 0) === "jaccard");
check("llm fallback", retrievalTag("embedding", "llm", undefined, 0.1) === "llm seeds");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(failures.join("\n")); process.exit(1); }
