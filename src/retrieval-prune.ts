// src/retrieval-prune.ts
// Membership floor for graph-expanded pages. The bar is spread-relative: it sits a
// fraction `ratio` of the way up the domain's actual cosine dynamic range
// [loRef … denseRef], where denseRef is the best seed's cosine and loRef is a robust
// low percentile of all domain cosines. This is stable across embedding models whose
// absolute cosine range is compressed (e.g. deepseek ~0.40–0.59), unlike an absolute
// `ratio·denseRef` bar. Pure — the caller supplies pre-computed cosines, so this adds
// no embedding calls. A page with no score is KEPT (cannot evaluate → no quality loss);
// seeds are never passed in (always kept by the caller).

/** Low percentile of domain cosines used as the bar's lower anchor. Calibrated in
 *  eval/graph-floor (Task 6); p5 by default. */
export const FLOOR_LO_PCT = 0.05;

/** Dynamic range below which the bar cannot be normalized → floor skips (keep-all). */
export const FLOOR_EPS = 1e-6;

/** Linear-interpolated percentile of `values` at fraction `pct` (0..1). Empty → 0. */
export function robustLow(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = pct * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

export interface PruneResult {
  keep: Set<string>;
  pruned: string[];
  bar: number;
  collapsed: boolean;
}

export function pruneByRelevance(
  expandedIds: string[],
  denseByPid: Record<string, number>,
  denseRef: number,
  loRef: number,
  ratio: number,
): PruneResult {
  const keep = new Set<string>();
  const pruned: string[] = [];
  // ratio = 0 is the off switch; degenerate range cannot be normalized → keep-all.
  const collapsed = denseRef - loRef < FLOOR_EPS;
  if (ratio <= 0 || collapsed) {
    for (const id of expandedIds) keep.add(id);
    return { keep, pruned, bar: loRef, collapsed };
  }
  const bar = loRef + ratio * (denseRef - loRef);
  for (const id of expandedIds) {
    const score = denseByPid[id];
    if (score === undefined || score >= bar) keep.add(id);
    else pruned.push(id);
  }
  return { keep, pruned, bar, collapsed: false };
}
