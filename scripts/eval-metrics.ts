// Pure retrieval metrics over a ranked pageId list and a gold pageId set.
// Obsidian-free and fs-free for easy reuse without aliases.

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

/** Fixed reporting cut-offs for Recall@k. MRR is unbounded rank. */
export const K_VALUES = [3, 5, 8] as const;

export interface LayerMetrics {
  recall: Record<number, number>; // keyed by k
  mrr: number;
}

/**
 * Average recall (per k) and mrr over aligned per-question ranked/gold lists.
 * `ranked[i]` and `gold[i]` describe the same question.
 */
export function averageLayer(
  ranked: string[][],
  gold: string[][],
  ks: number[],
): LayerMetrics {
  const n = ranked.length;
  const recall: Record<number, number> = {};
  for (const k of ks) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += recallAt(ranked[i], gold[i], k);
    recall[k] = n ? sum / n : 0;
  }
  let mrrSum = 0;
  for (let i = 0; i < n; i++) mrrSum += mrr(ranked[i], gold[i]);
  return { recall, mrr: n ? mrrSum / n : 0 };
}
