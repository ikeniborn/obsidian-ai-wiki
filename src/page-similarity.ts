import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";

export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
}

export class PageSimilarityService {
  constructor(private config: SimilarityConfig) {}

  async selectRelevant(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<string[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.topK).map((x) => x.path);
  }

  async refreshCache(
    _domainRoot: string,
    _vaultTools: VaultTools,
    _indexAnnotations: Map<string, string>,
  ): Promise<void> {
    // Jaccard mode: no cache to refresh
  }
}
