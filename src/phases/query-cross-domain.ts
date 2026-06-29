import type { DomainCandidates } from "./query";
import { fuseVectorGraph } from "../fusion";

export interface MergedPool {
  mergedPages: Map<string, string>;
  mergedSeeds: string[];
  mergedSeedSet: Set<string>;
  mergedSeedScores: Record<string, number>;
  mergedExpandedScores: Record<string, number>;
  allCandidates: Set<string>;
  mergedGraph: Map<string, Set<string>>;
  mergedAnnotations: Map<string, string>;
  fusedOrder: string[];
  finalIds: string[];
}

/**
 * Stage 2: union the per-domain candidate sets (stems are globally unique, so the
 * merge is collision-free), RRF-fuse vector + graph over the union, and take the
 * top-`seedTopK`. No new pages are introduced — only the stage-1 pool is re-ranked.
 */
export function mergeCandidates(
  pool: DomainCandidates[],
  seedTopK: number,
  graphDepth: number,
  rrfK: number,
): MergedPool {
  const mergedPages = new Map<string, string>();
  const mergedSeeds: string[] = [];
  const mergedSeedScores: Record<string, number> = {};
  const mergedExpandedScores: Record<string, number> = {};
  const allCandidates = new Set<string>();
  const mergedGraph = new Map<string, Set<string>>();
  const mergedAnnotations = new Map<string, string>();

  for (const c of pool) {
    for (const [p, body] of c.pages) mergedPages.set(p, body);
    for (const s of c.seeds) mergedSeeds.push(s);
    for (const [k, v] of Object.entries(c.seedScores)) mergedSeedScores[k] = v;
    for (const [k, v] of Object.entries(c.expandedScores)) mergedExpandedScores[k] = v;
    for (const id of c.candidateIds) allCandidates.add(id);
    for (const [k, v] of c.annotations) mergedAnnotations.set(k, v);
    for (const [node, edges] of c.graph) {
      const cur = mergedGraph.get(node);
      if (cur) { for (const e of edges) cur.add(e); }      // defensive: duplicate stem (broken mask)
      else mergedGraph.set(node, new Set(edges));
    }
  }

  const mergedSeedSet = new Set(mergedSeeds);
  const fusedOrder = fuseVectorGraph(
    mergedSeeds, allCandidates, mergedSeedScores, mergedExpandedScores, mergedGraph, graphDepth, rrfK,
  );
  const cap = Math.max(1, Math.min(50, Math.floor(seedTopK)));
  const finalIds = fusedOrder.slice(0, cap);

  return {
    mergedPages, mergedSeeds, mergedSeedSet, mergedSeedScores, mergedExpandedScores,
    allCandidates, mergedGraph, mergedAnnotations, fusedOrder, finalIds,
  };
}
