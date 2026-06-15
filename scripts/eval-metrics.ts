// Pure retrieval metrics over a ranked pageId list and a gold pageId set.
// Obsidian-free and fs-free so they unit-test under vitest without aliases.

/** Recall@k = |gold ∩ ranked[0..k)| / |gold|. 0 when gold is empty. */
export function recallAt(ranked: string[], gold: string[], k: number): number {
  if (gold.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  let hit = 0;
  for (const g of gold) if (top.has(g)) hit++;
  return hit / gold.length;
}

/** Reciprocal rank of the first gold hit (1-based). 0 if none appear. */
export function mrr(ranked: string[], gold: string[]): number {
  const goldSet = new Set(gold);
  for (let i = 0; i < ranked.length; i++) {
    if (goldSet.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}
