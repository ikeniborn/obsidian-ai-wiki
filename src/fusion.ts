// src/fusion.ts
// Tier 2 — vector ⊕ graph fusion. Over the union U = seeds ∪ BFS-expanded pages,
// build two ranked lists and fuse them with the existing rrf():
//   vector list — U by similarity score descending (seed + expanded scores).
//   graph list  — U by graph proximity: hop ascending (seed = hop 0), tie-broken
//                 by backlink inDegree descending.
// Every union page appears in both lists, so the fusion is well-formed and
// scale-free. Pure — no Obsidian APIs.
import { rrf } from "./rrf";
import { bfsExpandWithHops, inDegree, type WikiGraph } from "./wiki-graph";

export function fuseVectorGraph(
  seeds: string[],
  selectedIds: Set<string>,
  seedScores: Record<string, number>,
  expandedScores: Record<string, number>,
  graph: WikiGraph,
  depth: number,
  rrfK: number,
): string[] {
  const union = [...selectedIds];
  if (union.length === 0) return [];

  // `?? ` keeps an explicit 0 score; only missing keys fall through to 0.
  const scoreOf = (id: string): number => seedScores[id] ?? expandedScores[id] ?? 0;

  // Vector list: score desc; equal scores keep union order (stable sort).
  const vectorList = [...union].sort((a, b) => scoreOf(b) - scoreOf(a));

  // Graph list: hop asc, then inDegree desc; equal keys keep union order.
  const { byHop } = bfsExpandWithHops(seeds, graph, depth);
  const hopOf = new Map<string, number>();
  for (const s of seeds) hopOf.set(s, 0);
  for (const [hop, ids] of Object.entries(byHop)) {
    const h = Number(hop);
    for (const id of ids) if (!hopOf.has(id)) hopOf.set(id, h);
  }
  const missingHop = depth + 1;
  const deg = inDegree(graph);
  const graphList = [...union].sort((a, b) => {
    const ha = hopOf.get(a) ?? missingHop;
    const hb = hopOf.get(b) ?? missingHop;
    if (ha !== hb) return ha - hb;
    return (deg.get(b) ?? 0) - (deg.get(a) ?? 0);
  });

  return rrf([vectorList, graphList], rrfK).map((x) => x.id);
}
