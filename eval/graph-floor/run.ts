/**
 * Live capture: drives the REAL retrieval (seed dense pass + graph expansion) against the
 * deepseek/OpenAI-compatible embedding endpoint over the gold queries, writing capture.json
 * (GoldQuery records) for the offline analyzer. Requires a wiki vault with a prebuilt
 * embedding cache (_config/_embeddings.json) on disk.
 *
 * Env: WIKI_VAULT (vault root), EMBED_BASE_URL (…/v1), EMBED_MODEL, EMBED_DIM, EMBED_API_KEY.
 * Run: WIKI_VAULT=… EMBED_BASE_URL=… EMBED_MODEL=… EMBED_DIM=… EMBED_API_KEY=… npx tsx eval/graph-floor/run.ts
 */
import "./register";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PageSimilarityService } from "../../src/page-similarity";
import { retrieveDomainCandidates } from "../../src/phases/query";
import { parseIndexAnnotations } from "../../src/wiki-index";
import { domainWikiFolder, domainIndexPath } from "../../src/wiki-path";
import type { DomainEntry } from "../../src/domain";
import type { RunEvent } from "../../src/types";
import { buildVaultTools } from "./vault-fs";

// __dirname is available when tsx runs this file in CJS mode (no import.meta.url).
// register.ts's hooks (req.extensions[".md"] + Module._load for "obsidian") only
// work in CJS mode, so this file must not use import.meta.url.
declare const __dirname: string;
const here = __dirname;
const gold = JSON.parse(readFileSync(join(here, "queries.json"), "utf8")) as
  { id: string; question: string; domain: string; goldPages: string[] }[];

const VAULT = process.env.WIKI_VAULT;
const BASE = process.env.EMBED_BASE_URL;
const MODEL = process.env.EMBED_MODEL;
const DIM = Number(process.env.EMBED_DIM ?? "0") || undefined;
const KEY = process.env.EMBED_API_KEY ?? "";
if (!VAULT || !BASE || !MODEL) {
  console.error("Set WIKI_VAULT, EMBED_BASE_URL, EMBED_MODEL (and EMBED_DIM, EMBED_API_KEY).");
  process.exit(2);
}

const vault = buildVaultTools(VAULT);
const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0, bfsMinScoreRatio: 0 };
const signal = new AbortController().signal;
const estTokens = (s: string) => Math.ceil(s.length / 4);

function dom(folder: string): DomainEntry {
  return { id: folder, name: folder, wiki_folder: folder, source_paths: [], entity_types: [], analyzed_sources: {} } as DomainEntry;
}

void (async () => {
  const out: unknown[] = [];
  for (const g of gold) {
    const root = domainWikiFolder(g.domain);
    const similarity = new PageSimilarityService({
      mode: "embedding", model: MODEL, dimensions: DIM, topK: cfg.seedTopK, baseUrl: BASE, apiKey: KEY,
    });
    await similarity.loadCache(root, vault);
    const indexContent = await vault.read(domainIndexPath(root));
    const annotations = parseIndexAnnotations(indexContent);
    const allPaths = [...annotations.keys()].map((id) => `${root}/${id}.md`);
    const diag = await similarity.selectRelevantScoredDiag(g.question, annotations, allPaths);

    const genGen = retrieveDomainCandidates(dom(g.domain), g.question, vault, similarity, signal, cfg);
    let r = await genGen.next();
    let gstats: Extract<RunEvent, { kind: "graph_stats" }> | undefined;
    while (!r.done) {
      if ((r.value as RunEvent).kind === "graph_stats") gstats = r.value as Extract<RunEvent, { kind: "graph_stats" }>;
      r = await genGen.next();
    }
    const cand = r.value;
    if (!cand || !gstats) { console.error(`no candidates for ${g.id}`); continue; }

    const seedSet = new Set(cand.seeds);
    const candidates = gstats.expandedPages
      .filter((pid) => diag.denseByPid[pid] !== undefined)
      .map((pid) => ({
        pid,
        cosine: diag.denseByPid[pid],
        tokens: estTokens(cand.pages.get(`${root}/${pid}.md`) ?? ""),
      }));

    out.push({
      id: g.id, question: g.question, domain: g.domain, goldPages: g.goldPages,
      denseMax: diag.denseMax,
      domainCosines: Object.values(diag.denseByPid),
      candidates,
      goldSeeds: g.goldPages.filter((p) => seedSet.has(p)),
    });
    console.log(`captured ${g.id}: denseMax=${diag.denseMax.toFixed(3)} cands=${candidates.length}`);
  }
  writeFileSync(join(here, "capture.json"), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${out.length} records to eval/graph-floor/capture.json`);
})();
