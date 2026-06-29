/**
 * Out-of-vault eval for cross-domain wiki search (no Obsidian, no API key).
 * Deterministic: drives the REAL mergeCandidates / runCrossDomainQuery in Jaccard
 * mode over inlined fixtures. Run: npx tsx eval/cross-domain/run.ts
 */
// register MUST be first: installs .md loader + obsidian stub before any src/ module loads.
import "./register";
import { mergeCandidates, runCrossDomainQuery, buildCrossDomainEntityTypes } from "../../src/phases/query-cross-domain";
import { retrieveDomainCandidates } from "../../src/phases/query";
import type { DomainCandidates } from "../../src/phases/query";
import type { VaultTools } from "../../src/vault-tools";
import type { LlmClient, RunEvent } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

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

// Minimal in-memory VaultTools: jaccard mode (no embeddings).
function fakeVault(files: Record<string, string>): VaultTools {
  const map = new Map(Object.entries(files));
  return {
    read: async (p: string) => { const v = map.get(p); if (v === undefined) throw new Error("ENOENT " + p); return v; },
    write: async () => {},
    exists: async (p: string) => map.has(p),
    mkdir: async () => {},
    remove: async () => {},
    listFiles: async (dir: string) => [...map.keys()].filter((p) => p.startsWith(dir)),
    readAll: async (paths: string[]) => new Map(paths.map((p) => [p, map.get(p) ?? ""])),
  } as unknown as VaultTools;
}

// Fake LLM: records call count; streaming returns one canned content chunk.
function fakeLlm(answer: string): { llm: LlmClient; calls: () => number } {
  let calls = 0;
  const llm = {
    chat: { completions: { create: async (params: { stream?: boolean }) => {
      calls++;
      if (params.stream) {
        return (async function* () { yield { choices: [{ delta: { content: answer } }] }; })();
      }
      return { choices: [{ message: { content: answer } }] };
    } } },
  } as unknown as LlmClient;
  return { llm, calls: () => calls };
}

async function drive(gen: AsyncGenerator<RunEvent, void>): Promise<RunEvent[]> {
  const evs: RunEvent[] = [];
  for await (const e of gen) evs.push(e);
  return evs;
}

const dom = (id: string): DomainEntry => ({
  id, name: id, wiki_folder: id, source_paths: [], entity_types: [], analyzed_sources: {},
} as DomainEntry);

void (async () => {
  section("runCrossDomainQuery");
  {
    const files = {
      "!Wiki/work/_config/_index.md": "- [[wiki_work_neural]] — neural networks deep learning",
      "!Wiki/work/EntityType/wiki_work_neural.md": "# Neural\nneural networks deep learning models",
      "!Wiki/home/_config/_index.md": "- [[wiki_home_garden]] — neural pruning of garden plants",
      "!Wiki/home/EntityType/wiki_home_garden.md": "# Garden\nneural pruning garden plants",
    };
    const vault = fakeVault(files);
    const { llm, calls } = fakeLlm("Answer about [[wiki_work_neural]].");
    const signal = new AbortController().signal;
    const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };

    const evs = await drive(runCrossDomainQuery(
      "neural", vault, llm, "fake-model", [dom("work"), dom("home")], signal, cfg, 60, 3, {},
    ));

    const evalMeta = evs.find((e) => e.kind === "eval_meta") as Extract<RunEvent, { kind: "eval_meta" }> | undefined;
    const result = evs.find((e) => e.kind === "result") as Extract<RunEvent, { kind: "result" }> | undefined;

    check("exactly one LLM completion call", calls() === 1, `calls=${calls()}`);
    check("emits a result with the answer", !!result && result.text.includes("wiki_work_neural"));
    check("eval_meta.crossDomain true", !!evalMeta && (evalMeta.fields.retrievalConfig as { crossDomain?: boolean })?.crossDomain === true);
    check("found_pages non-empty", !!evalMeta && Array.isArray(evalMeta.fields.found_pages) && (evalMeta.fields.found_pages as string[]).length > 0);
    check("per-domain progress emitted", evs.some((e) => e.kind === "tool_use" && (e as { name: string }).name.startsWith("Domain:")));
  }

  section("edge cases");
  {
    const vault = fakeVault({});
    const { llm } = fakeLlm("x");
    const signal = new AbortController().signal;
    const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };
    const evs = await drive(runCrossDomainQuery("q", vault, llm, "m", [dom("work"), dom("home")], signal, cfg, 60, 3, {}));
    check("all-empty → error event", evs.some((e) => e.kind === "error" && /across domains/i.test((e as { message: string }).message)));
  }

  section("retrieveDomainCandidates (jaccard, single domain)");
  {
    const files = {
      "!Wiki/work/_config/_index.md": "- [[wiki_work_neural]] — neural networks deep learning",
      "!Wiki/work/EntityType/wiki_work_neural.md": "# Neural\nneural networks deep learning models",
      "!Wiki/work/EntityType/wiki_work_garden.md": "# Garden\ncompletely unrelated gardening text",
    };
    const vault = fakeVault(files);
    const signal = new AbortController().signal;
    const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };
    const gen = retrieveDomainCandidates(dom("work"), "neural networks", vault, undefined, signal, cfg);
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    const cand = r.value;

    check("jaccard pool non-empty", !!cand && cand.candidateIds.size > 0);
    check("relevant seed selected", !!cand && cand.seeds.includes("wiki_work_neural"));
    check("retrievalMode jaccard", !!cand && cand.retrievalMode === "jaccard");
    check("empty domain returns null", await (async () => {
      const g = retrieveDomainCandidates(dom("empty"), "x", fakeVault({}), undefined, signal, cfg);
      let rr = await g.next(); while (!rr.done) rr = await g.next(); return rr.value === null;
    })());
  }

  section("buildCrossDomainEntityTypes (covers exactly finalIds domains)");
  {
    const domains = [
      { id: "work", name: "Work", wiki_folder: "work", source_paths: [], analyzed_sources: {},
        entity_types: [{ type: "Tool", description: "a tool" }] } as unknown as DomainEntry,
      { id: "home", name: "Home", wiki_folder: "home", source_paths: [], analyzed_sources: {},
        entity_types: [{ type: "Plant", description: "a plant" }] } as unknown as DomainEntry,
    ];
    // finalIds contains only a "work" stem → only Work's entity types should appear.
    const block = buildCrossDomainEntityTypes(domains, ["work"]);
    check("includes the contributing domain's entity type", block.includes("Tool") && block.includes("Work"));
    check("excludes a non-contributing domain", !block.includes("Plant") && !block.includes("Home"));
  }

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
})();
