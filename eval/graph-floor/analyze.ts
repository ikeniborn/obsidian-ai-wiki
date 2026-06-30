// Pure sweep/summary over captured graph-candidate cosines (eval/graph-floor/capture.json,
// produced live by run.ts). No network — the floor's real math (robustLow + pruneByRelevance)
// run over recorded distributions. Importable (pure) and runnable (prints the sweep table).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneByRelevance, robustLow, FLOOR_LO_PCT } from "../../src/retrieval-prune";

export interface GoldQuery {
  id: string;
  question: string;
  domain: string;
  goldPages: string[];
  denseMax: number;
  domainCosines: number[];
  candidates: { pid: string; cosine: number; tokens: number }[];
  goldSeeds: string[];
}

export interface QuerySweep { kept: string[]; prunedTokens: number; totalTokens: number; recall: number }

export function sweepQuery(q: GoldQuery, ratio: number): QuerySweep {
  const loRef = robustLow(q.domainCosines, FLOOR_LO_PCT);
  const denseByPid: Record<string, number> = {};
  for (const c of q.candidates) denseByPid[c.pid] = c.cosine;
  const ids = q.candidates.map((c) => c.pid);
  const { keep } = pruneByRelevance(ids, denseByPid, q.denseMax, loRef, ratio);
  let prunedTokens = 0;
  let totalTokens = 0;
  for (const c of q.candidates) { totalTokens += c.tokens; if (!keep.has(c.pid)) prunedTokens += c.tokens; }
  const goldCand = q.goldPages.filter((g) => ids.includes(g));
  const present = q.goldSeeds.length + goldCand.length;
  const kept = q.goldSeeds.length + goldCand.filter((g) => keep.has(g)).length;
  const recall = present === 0 ? 1 : kept / present;
  return { kept: [...keep], prunedTokens, totalTokens, recall };
}

export interface RatioRow { ratio: number; tokenCutPct: number; minRecall: number; failing: number }

export function summarize(queries: GoldQuery[], ratios: number[]): RatioRow[] {
  return ratios.map((ratio) => {
    let pruned = 0;
    let total = 0;
    let minRecall = 1;
    let failing = 0;
    for (const q of queries) {
      const s = sweepQuery(q, ratio);
      pruned += s.prunedTokens;
      total += s.totalTokens;
      if (s.recall < minRecall) minRecall = s.recall;
      if (s.recall < 1) failing += 1;
    }
    return { ratio, tokenCutPct: total === 0 ? 0 : (pruned / total) * 100, minRecall, failing };
  });
}

/** Best = the largest non-zero ratio with no recall loss. null if none. */
export function recommend(rows: RatioRow[]): RatioRow | null {
  const safe = rows.filter((r) => r.failing === 0 && r.ratio > 0);
  if (safe.length === 0) return null;
  return safe.reduce((a, b) => (b.tokenCutPct > a.tokenCutPct ? b : a));
}

export const RATIOS = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

// Printable entry: `npx tsx eval/graph-floor/analyze.ts [capture.json]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = process.argv[2] ?? join(here, "capture.json");
  const queries = JSON.parse(readFileSync(path, "utf8")) as GoldQuery[];
  console.log(`\n=== Calibration sweep (${queries.length} captured queries) ===`);
  console.log("ratio  tokenCut%  minRecall  failing");
  const rows = summarize(queries, RATIOS);
  for (const r of rows) {
    console.log(`${r.ratio.toFixed(2)}   ${r.tokenCutPct.toFixed(1).padStart(7)}   ${r.minRecall.toFixed(2).padStart(7)}   ${String(r.failing).padStart(5)}`);
  }
  const best = recommend(rows);
  console.log(best
    ? `\nRecommended default ratio: ${best.ratio} (tokenCut ${best.tokenCutPct.toFixed(1)}%, recall 100%)`
    : "\nNo non-zero ratio keeps recall=100% — raise FLOOR_LO_PCT or revisit the gold set.");
}
