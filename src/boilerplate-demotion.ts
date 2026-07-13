export const DEFAULT_BOILERPLATE_DEMOTION_FACTOR = 0.15;

export interface BoilerplateDemotionConfig {
  enabled: boolean;
  factor: number;
}

export interface BoilerplateDemotionInput {
  enabled?: boolean;
  factor?: number;
}

export interface RankedBoilerplateItem {
  path?: string;
  score?: number;
}

export function isBoilerplatePath(vaultPath: string | undefined): boolean {
  void vaultPath;
  return false;
}

export function normalizeBoilerplateDemotionConfig(input?: BoilerplateDemotionInput): BoilerplateDemotionConfig {
  const enabled = input?.enabled ?? false;
  const factor = input?.factor ?? DEFAULT_BOILERPLATE_DEMOTION_FACTOR;
  if (!Number.isFinite(factor)) return { enabled, factor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR };
  return { enabled, factor: Math.max(0, Math.min(1, factor)) };
}

export function demoteBoilerplateRankedItems<T extends RankedBoilerplateItem>(
  rankedItems: T[],
  config: BoilerplateDemotionConfig,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  if (!config.enabled || config.factor <= 0) return rankedItems.slice(0, limit);
  const penalty = Math.max(1, Math.ceil(config.factor * Math.max(limit, rankedItems.length) * 2));
  return rankedItems
    .map((item, index) => ({ item, index, rank: index + (isBoilerplatePath(item.path) ? penalty : 0) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function demoteBoilerplateRankedIds(
  rankedIds: string[],
  config: BoilerplateDemotionConfig,
  limit: number,
): string[] {
  return demoteBoilerplateRankedItems(
    rankedIds.map((id, index) => ({ id, path: id, score: rankedIds.length - index })),
    config,
    limit,
  ).map((item) => item.id);
}
