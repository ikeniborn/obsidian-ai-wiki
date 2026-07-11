export interface GoldLabel {
  path: string;
  sourceRelPath: string;
  grade: 1 | 2 | 3;
  rationale: string;
}

export interface GoldSet {
  version: 1;
  source: string;
  queries: Record<string, { relevant: GoldLabel[] }>;
}

export interface GoldMetrics {
  recallAtK: number;
  ndcgAtK: number;
  mrr: number;
}

export function validateGoldSet(
  gold: GoldSet,
  queryIds: string[],
  knownPaths: Set<string>,
  knownSourceRelPaths?: Set<string>,
): void {
  if (gold.version !== 1) throw new Error(`unsupported gold set version: ${gold.version}`);
  const expected = new Set(queryIds);
  for (const queryId of Object.keys(gold.queries)) {
    if (!expected.has(queryId)) throw new Error(`unknown query in gold set: ${queryId}`);
  }
  for (const queryId of queryIds) {
    const labels = gold.queries[queryId]?.relevant;
    if (!labels || labels.length === 0) throw new Error(`missing gold labels for query: ${queryId}`);
    const seen = new Set<string>();
    for (const label of labels) {
      if (seen.has(label.path)) throw new Error(`duplicate gold label for ${queryId}: ${label.path}`);
      seen.add(label.path);
      if (!knownPaths.has(label.path)) throw new Error(`gold path not present in eval domain for ${queryId}: ${label.path}`);
      if (label.sourceRelPath.trim().length === 0) throw new Error(`missing gold sourceRelPath for ${queryId}: ${label.path}`);
      if (knownSourceRelPaths && !knownSourceRelPaths.has(label.sourceRelPath)) {
        throw new Error(`gold sourceRelPath not present in eval source for ${queryId}: ${label.sourceRelPath}`);
      }
      if (![1, 2, 3].includes(label.grade)) throw new Error(`invalid gold grade for ${queryId}: ${label.path}`);
      if (label.rationale.trim().length === 0) throw new Error(`missing gold rationale for ${queryId}: ${label.path}`);
    }
  }
}

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + ((2 ** grade - 1) / Math.log2(index + 2)), 0);
}

export function scoreGoldRanking(labels: GoldLabel[], rankedPaths: string[], k: number): GoldMetrics {
  const labelByPath = new Map(labels.map((label) => [label.path, label.grade]));
  const top = rankedPaths.slice(0, k);
  const relevantHits = top.filter((path) => labelByPath.has(path));
  const denominator = Math.min(k, labels.length);
  const recallAtK = denominator === 0 ? 0 : relevantHits.length / denominator;
  const rankedGrades = top.map((path) => labelByPath.get(path) ?? 0);
  const idealGrades = labels.map((label) => label.grade).sort((a, b) => b - a).slice(0, k);
  const ideal = dcg(idealGrades);
  const ndcgAtK = ideal === 0 ? 0 : dcg(rankedGrades) / ideal;
  const firstHit = top.findIndex((path) => labelByPath.has(path));
  const mrr = firstHit === -1 ? 0 : 1 / (firstHit + 1);
  return { recallAtK, ndcgAtK, mrr };
}
