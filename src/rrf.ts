// src/rrf.ts
// Reciprocal Rank Fusion. Scale-free fusion of several ranked ID lists:
// score(id) = Σ over lists 1/(k + rank), rank 1-based. Higher = better.
// Reused by Tier 1 hybrid retrieval (dense ⊕ jaccard) and later Tier 2 (vector ⊕ BFS).
export function rrf(rankedLists: string[][], k = 60): { id: string; score: number }[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    }
  }
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score || firstSeen.get(a.id)! - firstSeen.get(b.id)!);
}
