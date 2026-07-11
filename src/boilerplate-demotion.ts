import path from "path-browserify";

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
  if (!vaultPath) return false;
  const name = path.basename(vaultPath).replace(/\.md$/i, "").toLowerCase();
  return name === "template-readme" || name.startsWith("template-hld-");
}

export function normalizeBoilerplateDemotionConfig(input?: BoilerplateDemotionInput): BoilerplateDemotionConfig {
  const enabled = input?.enabled ?? true;
  const factor = input?.factor ?? DEFAULT_BOILERPLATE_DEMOTION_FACTOR;
  if (Number.isNaN(factor)) return { enabled, factor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR };
  return { enabled, factor: Math.max(0, Math.min(1, factor)) };
}

export function applyBoilerplateScoreDemotion(
  score: number,
  vaultPath: string | undefined,
  config: BoilerplateDemotionConfig,
): number {
  if (!config.enabled || config.factor <= 0 || !isBoilerplatePath(vaultPath)) return score;
  return score * (1 - config.factor);
}

export function demoteBoilerplateRankedItems<T extends RankedBoilerplateItem>(
  rankedItems: T[],
  config: BoilerplateDemotionConfig,
  limit: number,
): T[] {
  if (!config.enabled || config.factor <= 0) return rankedItems.slice(0, limit);
  const penalty = Math.max(1, Math.ceil(config.factor * Math.max(limit, rankedItems.length) * 2));
  return rankedItems
    .map((item, index) => ({ item, index, rank: index + (isBoilerplatePath(item.path) ? penalty : 0) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .slice(0, limit)
    .map(({ item }) => item);
}
