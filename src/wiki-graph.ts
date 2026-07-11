import path from "path-browserify";
import { tokenize, scoreSeed } from "./wiki-seeds";
import type { PageSimilarityService } from "./page-similarity";

export type WikiGraph = Map<string, Set<string>>;

export function pageId(vaultPath: string): string {
  return path.basename(vaultPath, ".md");
}

export function buildWikiGraph(pages: Map<string, string>): WikiGraph {
  const graph: WikiGraph = new Map();
  for (const vaultPath of pages.keys()) {
    graph.set(pageId(vaultPath), new Set());
  }
  for (const [vaultPath, content] of pages) {
    const src = pageId(vaultPath);
    for (const match of content.matchAll(/\[\[([^\]|#]+)/g)) {
      const tgt = match[1].trim();
      if (tgt) graph.get(src)!.add(tgt);
    }
  }
  return graph;
}

/**
 * BFS-expansion seeds → set of reachable pageIds within `depth` hops.
 * Graph is treated as **undirected**: edge `A → B` lets BFS traverse `B → A` too.
 * Rationale: wiki backlinks are symmetric in user mental model — a page referenced
 * by a seed should also be considered context, regardless of which direction the
 * `[[link]]` was authored. Seeds not present in the graph are silently skipped.
 */
export function bfsExpand(seeds: string[], graph: WikiGraph, depth: number): Set<string> {
  if (seeds.length === 0) return new Set();

  // Pre-compute reverse index
  const reverse = new Map<string, Set<string>>();
  for (const [src, targets] of graph) {
    for (const tgt of targets) {
      if (!reverse.has(tgt)) reverse.set(tgt, new Set());
      reverse.get(tgt)!.add(src);
    }
  }

  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor) && graph.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
      for (const neighbor of reverse.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  return visited;
}

/**
 * BFS-expansion that tracks which pages are discovered at each hop depth.
 * Returns both the expanded set of all reachable pages and a mapping of hop → pages discovered at that hop.
 * Graph is treated as **undirected**: edge `A → B` lets BFS traverse `B → A` too.
 * Seeds not present in the graph are included in expanded but do not contribute to expansion.
 */
export function bfsExpandWithHops(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
): { expanded: Set<string>; byHop: Record<number, string[]> } {
  if (seeds.length === 0) return { expanded: new Set(), byHop: {} };

  // Pre-compute reverse index (same logic as bfsExpand)
  const reverse = new Map<string, Set<string>>();
  for (const [src, targets] of graph) {
    for (const tgt of targets) {
      if (!reverse.has(tgt)) reverse.set(tgt, new Set());
      reverse.get(tgt)!.add(src);
    }
  }

  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);
  const byHop: Record<number, string[]> = {};

  for (let hop = 1; hop <= depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor) && graph.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
      for (const neighbor of reverse.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
    }
    if (next.size === 0) break;
    byHop[hop] = [...next];
    frontier = next;
  }

  return { expanded: visited, byHop };
}

/**
 * BFS-expansion with ranking: expands seeds up to `depth` hops, then returns seeds + top-K
 * non-seed pages ranked by embedding similarity (if available) or Jaccard overlap as fallback.
 * bfsTopK=0 returns all BFS pages unfiltered.
 */
export type BfsExpandResult = { selectedIds: Set<string>; expandedScores: Record<string, number> };

export async function bfsExpandRanked(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
  pages: Map<string, string>,
  query: string,
  bfsTopK: number,
  annotations?: Map<string, string>,
  similarity?: PageSimilarityService,
): Promise<BfsExpandResult> {
  const allBfs = bfsExpand(seeds, graph, depth);
  const seedSet = new Set(seeds);

  if (bfsTopK <= 0) return { selectedIds: allBfs, expandedScores: {} };

  const nonSeeds = [...allBfs].filter(pid => !seedSet.has(pid));
  if (nonSeeds.length === 0) return { selectedIds: new Set(seedSet), expandedScores: {} };

  // Reverse lookup: pageId → vaultPath
  const pidToPath = new Map<string, string>();
  for (const vaultPath of pages.keys()) {
    pidToPath.set(pageId(vaultPath), vaultPath);
  }

  const nonSeedPaths = nonSeeds.flatMap(pid => {
    const p = pidToPath.get(pid);
    return p ? [p] : [];
  });

  if (similarity) {
    try {
      const scored = await similarity.selectRelevantScored(
        query,
        annotations ?? new Map<string, string>(),
        nonSeedPaths,
      );
      const top = scored.slice(0, bfsTopK);
      const expandedScores: Record<string, number> = {};
      for (const { path, score } of top) expandedScores[pageId(path)] = score;
      return { selectedIds: new Set([...seedSet, ...Object.keys(expandedScores)]), expandedScores };
    } catch (err) {
      console.warn("[bfsExpandRanked] similarity threw, returning full BFS:", err);
      return { selectedIds: allBfs, expandedScores: {} };
    }
  }

  // Jaccard fallback
  const questionTokens = tokenize(query);
  const scored = nonSeeds.map(pid => {
    const path = pidToPath.get(pid);
    const content = path ? (pages.get(path) ?? "") : "";
    return { pid, score: scoreSeed(questionTokens, pid, content) };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, bfsTopK);
  const expandedScores: Record<string, number> = {};
  for (const { pid, score } of top) expandedScores[pid] = score;
  return { selectedIds: new Set([...seedSet, ...Object.keys(expandedScores)]), expandedScores };
}

/**
 * Backlink count per node: how many pages link TO each node. Targets that appear
 * only as link destinations (phantom pages) are counted too. Shared by the graph
 * health check and Tier 2 fusion's graph-proximity tie-break.
 */
export function inDegree(graph: WikiGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const node of graph.keys()) {
    if (!deg.has(node)) deg.set(node, 0);
    for (const tgt of graph.get(node)!) {
      deg.set(tgt, (deg.get(tgt) ?? 0) + 1);
    }
  }
  return deg;
}

export function checkGraphStructure(graph: WikiGraph): string {
  const deg = inDegree(graph);

  const issues: string[] = [];
  for (const [node, neighbors] of graph) {
    const outDeg = neighbors.size;
    const inDeg = deg.get(node) ?? 0;

    if (inDeg === 0 && outDeg === 0) {
      issues.push(`- ${node}: isolated node (no links in or out)`);
    }
    for (const tgt of neighbors) {
      if (graph.has(tgt) && !graph.get(tgt)!.has(node)) {
        issues.push(`- ${node} → [[${tgt}]] not reciprocated`);
      }
    }
  }
  return issues.join("\n");
}
