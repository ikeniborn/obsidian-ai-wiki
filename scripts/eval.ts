#!/usr/bin/env node
// Retrieval eval harness (Component 1). Measures Recall@k + MRR of the wiki
// retrieval pipeline against a fixed gold set, for one or more configs.
//
// Usage:
//   tsx scripts/eval.ts --vault <path> --gold <gold.json>
//        [--wiki <subfolder>] [--config dense|jaccard] [--bfs-depth 0|1|2]
//        [--top-k N] [--out run.json] [--baseline run.json]
//
// Env (dense/embedding mode): EVAL_EMBED_BASE_URL, EVAL_EMBED_API_KEY (optional).
import { readFile, writeFile } from "node:fs/promises";
import { pageId } from "../src/wiki-graph";
import { parseGold } from "./eval-gold";
import { resolveConfigs } from "./eval-config";
import { averageLayer, K_VALUES } from "./eval-metrics";
import { formatTable, type Snapshot } from "./eval-report";
import {
  makeFsShim, locateWikiFolder, loadIndexAnnotations, loadWikiPages, readEmbeddingHeader,
} from "./eval-vault";
import { makeRunner, buildGraph, type RunInputs } from "./eval-retrieval";

interface Args {
  vault: string;
  gold: string;
  wiki?: string;
  config?: string;
  bfsDepth: number;
  topK: number;
  out?: string;
  baseline?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const vault = get("--vault");
  const gold = get("--gold");
  if (!vault) throw new Error("--vault <path> is required");
  if (!gold) throw new Error("--gold <gold.json> is required");
  return {
    vault,
    gold,
    wiki: get("--wiki"),
    config: get("--config"),
    bfsDepth: get("--bfs-depth") !== undefined ? Number(get("--bfs-depth")) : 1,
    topK: get("--top-k") !== undefined ? Number(get("--top-k")) : 8,
    out: get("--out"),
    baseline: get("--baseline"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const goldPairs = parseGold(await readFile(args.gold, "utf8")); // throws if empty/malformed
  const fs = makeFsShim(args.vault);
  const wikiVaultPath = await locateWikiFolder(args.vault, args.wiki);
  const annotations = await loadIndexAnnotations(fs, wikiVaultPath);
  const pages = await loadWikiPages(args.vault, wikiVaultPath);
  const graph = buildGraph(pages);
  const embed = {
    baseUrl: process.env.EVAL_EMBED_BASE_URL,
    apiKey: process.env.EVAL_EMBED_API_KEY,
    ...(await readEmbeddingHeader(fs, wikiVaultPath)), // model + dimensions
  };

  // Warn about gold ids that can never be retrieved (stale gold entries).
  const knownIds = new Set([...pages.keys()].map((p) => pageId(p)));
  for (const { q, gold } of goldPairs) {
    for (const g of gold) {
      if (!knownIds.has(g)) {
        console.warn(`[eval] gold id "${g}" (q: "${q}") not present in vault — counts as a miss`);
      }
    }
  }

  const inputs: RunInputs = {
    wikiVaultPath,
    fs,
    annotations,
    allAnnotatedPaths: [...annotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`),
    pages,
    graph,
    embed,
  };

  const configs = resolveConfigs(args.config, args.bfsDepth, args.topK);
  const ks = [...K_VALUES];
  const snapshot: Snapshot = { vault: args.vault, k: ks, configs: [] };

  for (const cfg of configs) {
    const runner = await makeRunner(cfg, inputs);
    const seedRanks: string[][] = [];
    const unionRanks: string[][] = [];
    const golds: string[][] = [];
    for (const { q, gold } of goldPairs) {
      const ranks = await runner(q);
      seedRanks.push(ranks.seed);
      unionRanks.push(ranks.union);
      golds.push(gold);
    }
    snapshot.configs.push({
      name: cfg.name,
      seed: averageLayer(seedRanks, golds, ks),
      union: averageLayer(unionRanks, golds, ks),
    });
  }

  const baseline = args.baseline
    ? (JSON.parse(await readFile(args.baseline, "utf8")) as Snapshot)
    : undefined;

  console.log(formatTable(snapshot, baseline));

  if (args.out) {
    await writeFile(args.out, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`\nwrote ${args.out}`);
  }
}

main().catch((err) => {
  console.error(`[eval] ${(err as Error).message}`);
  process.exit(1);
});
