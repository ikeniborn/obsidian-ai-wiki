// src/retrieval-prune.ts
// Membership floor for graph-expanded pages: drop those whose raw dense cosine
// falls below ratio·denseRef. Pure — the caller supplies pre-computed cosines, so
// this adds no embedding calls. A page with no score is KEPT (cannot evaluate →
// no quality loss); only confidently-weak pages are dropped. Seeds are never passed
// in (they are always kept by the caller).

export function pruneByRelevance(
  expandedIds: string[],
  denseByPid: Record<string, number>,
  denseRef: number,
  ratio: number,
): { keep: Set<string>; pruned: string[] } {
  const bar = ratio * denseRef;
  const keep = new Set<string>();
  const pruned: string[] = [];
  for (const id of expandedIds) {
    const score = denseByPid[id];
    if (score === undefined || score >= bar) keep.add(id);
    else pruned.push(id);
  }
  return { keep, pruned };
}
