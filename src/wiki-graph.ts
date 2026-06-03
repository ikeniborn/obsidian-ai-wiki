import { basename } from "path-browserify";
import { tokenize, scoreSeed } from "./wiki-seeds";
import type { PageSimilarityService } from "./page-similarity";

export type WikiGraph = Map<string, Set<string>>;

export function pageId(vaultPath: string): string {
  return basename(vaultPath, ".md");
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
export async function bfsExpandRanked(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
  pages: Map<string, string>,
  query: string,
  bfsTopK: number,
  annotations?: Map<string, string>,
  similarity?: PageSimilarityService,
): Promise<Set<string>> {
  const allBfs = bfsExpand(seeds, graph, depth);
  const seedSet = new Set(seeds);

  if (bfsTopK <= 0) return allBfs;

  const nonSeeds = [...allBfs].filter(pid => !seedSet.has(pid));
  if (nonSeeds.length === 0) return new Set(seedSet);

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
        annotations ?? new Map(),
        nonSeedPaths,
      );
      const topPids = scored.slice(0, bfsTopK).map(({ path }) => pageId(path));
      return new Set([...seedSet, ...topPids]);
    } catch (err) {
      console.warn("[bfsExpandRanked] similarity threw, returning full BFS:", err);
      return allBfs;
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

  const topPids = scored.slice(0, bfsTopK).map(x => x.pid);
  return new Set([...seedSet, ...topPids]);
}

export function checkGraphStructure(graph: WikiGraph): string {
  const inDegree = new Map<string, number>();
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    for (const tgt of graph.get(node)!) {
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
    }
  }

  const issues: string[] = [];
  for (const [node, neighbors] of graph) {
    const outDeg = neighbors.size;
    const inDeg = inDegree.get(node) ?? 0;

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
