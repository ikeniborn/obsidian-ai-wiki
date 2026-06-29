/**
 * Out-of-vault eval for cross-domain wiki search (no Obsidian, no API key).
 * Deterministic: drives the REAL mergeCandidates / runCrossDomainQuery in Jaccard
 * mode over inlined fixtures. Run: npx tsx eval/cross-domain/run.ts
 */
import { mergeCandidates } from "../../src/phases/query-cross-domain";
import type { DomainCandidates } from "../../src/phases/query";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

function fakeCandidates(domainId: string, ids: string[], scores: number[]): DomainCandidates {
  const seedScores: Record<string, number> = {};
  ids.forEach((id, i) => { seedScores[id] = scores[i]; });
  const graph = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const pages = new Map<string, string>(ids.map((id) => [`!Wiki/${domainId}/${id}.md`, `# ${id}`]));
  const annotations = new Map<string, string>(ids.map((id) => [id, `${id} annotation`]));
  return {
    domainId, pages, seeds: ids, candidateIds: new Set(ids),
    seedScores, expandedScores: {}, graph, annotations, indexContent: "",
    retrievalMode: "jaccard", denseMax: 0, seedFallback: "none", seedOutputTokens: 0,
  };
}

section("mergeCandidates");
{
  const a = fakeCandidates("work", ["wiki_work_a", "wiki_work_b"], [0.9, 0.3]);
  const b = fakeCandidates("home", ["wiki_home_x", "wiki_home_y"], [0.8, 0.2]);
  const merged = mergeCandidates([a, b], 3, 1, 60);

  check("pool = union of all candidates",
    merged.allCandidates.size === 4 &&
    ["wiki_work_a", "wiki_work_b", "wiki_home_x", "wiki_home_y"].every((id) => merged.allCandidates.has(id)),
    `got ${[...merged.allCandidates].join(",")}`);
  check("finalIds length <= seedTopK", merged.finalIds.length === 3, `got ${merged.finalIds.length}`);
  const domainsInFinal = new Set(merged.finalIds.map((id) => id.split("_")[1]));
  check("final spans >1 domain", domainsInFinal.size > 1, `domains: ${[...domainsInFinal].join(",")}`);
  check("mergedPages has 4 entries", merged.mergedPages.size === 4);
  check("mergedSeedSet has all seeds", merged.mergedSeedSet.size === 4);
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
