/**
 * Out-of-vault eval for resolveRerunDomain. Exercises the REAL pure function
 * from src/rerun-domain.ts against synthetic fixtures. No vault, no LLM, no DOM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/rerun-domain/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/rerun-domain/run.cjs
 *   node eval/rerun-domain/run.cjs
 */
import { resolveRerunDomain } from "../../src/rerun-domain";
import type { DomainEntry } from "../../src/domain";
import type { RunHistoryEntry } from "../../src/types";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

function entry(domainId?: string): RunHistoryEntry {
  return {
    id: "1", operation: "query", args: ["q"], domainId,
    startedAt: 0, finishedAt: 0, status: "done", finalText: "", steps: [],
  };
}
const domains: DomainEntry[] = [
  { id: "alpha", name: "Alpha", wiki_folder: "alpha" },
  { id: "beta", name: "Beta", wiki_folder: "beta" },
];

console.log("\n=== resolveRerunDomain ===");
{
  const r = resolveRerunDomain(entry("beta"), domains);
  check("valid domainId resolves", r.ok && r.domainId === "beta", JSON.stringify(r));
}
{
  const r = resolveRerunDomain(entry(undefined), domains);
  check("missing domainId → missing", !r.ok && r.reason === "missing", JSON.stringify(r));
}
{
  const r = resolveRerunDomain(entry(""), domains);
  check("empty domainId → missing", !r.ok && r.reason === "missing", JSON.stringify(r));
}
{
  const r = resolveRerunDomain(entry("gamma"), domains);
  check("unknown domainId → not-found", !r.ok && r.reason === "not-found", JSON.stringify(r));
}
{
  const r = resolveRerunDomain(entry("*"), domains);
  check("cross-domain '*' resolves ok even when no domain has id '*'", r.ok && r.domainId === "*", JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
