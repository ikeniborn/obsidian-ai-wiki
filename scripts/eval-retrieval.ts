// Retrieval orchestration (Component 4, approach A — thin orchestration).
// MIRRORS the seed-selection + BFS block of src/phases/query.ts:69-135 by
// calling the same public functions in the same order. It does NOT run runQuery
// and does NOT modify query.ts. If Tier 2 changes production ordering, update
// this file in the same change (drift mitigation).
import type { VaultTools } from "../src/vault-tools";
import { PageSimilarityService } from "../src/page-similarity";
import { buildWikiGraph, pageId, bfsExpandRanked, type WikiGraph } from "../src/wiki-graph";
import { fuseVectorGraph } from "../src/fusion";
import { selectSeeds } from "../src/wiki-seeds";
import type { ConfigRecord } from "./eval-config";
import type { FsShim } from "./eval-vault";

// Union-layer BFS top-k. Mirrors query.ts's bfsTopK default (10); kept generous
// so union Recall@8 is not pre-truncated.
const UNION_BFS_TOPK = 10;

export interface RunInputs {
  wikiVaultPath: string;
  fs: FsShim;
  annotations: Map<string, string>;
  allAnnotatedPaths: string[]; // `${wikiVaultPath}/${id}.md` per annotation key
  pages: Map<string, string>; // vaultRelativePath → content
  graph: WikiGraph;
  embed: { baseUrl?: string; apiKey?: string; model?: string; dimensions?: number };
}

export interface QuestionRanks {
  seed: string[]; // ranked pageIds (seed layer)
  union: string[]; // ranked pageIds (seeds first, then BFS-expanded)
}

export type Runner = (question: string) => Promise<QuestionRanks>;

/**
 * Build a per-question runner for one config. For dense (embedding) configs this
 * loads the embedding cache once. Logs a warning if dense is requested without a
 * live endpoint (it will fall back to jaccard internally — not silently labeled "dense").
 */
export async function makeRunner(cfg: ConfigRecord, inputs: RunInputs): Promise<Runner> {
  const { wikiVaultPath, fs, annotations, allAnnotatedPaths, pages, graph, embed } = inputs;

  // syntheticPages: empty-body Map keyed by annotated path, as query.ts builds
  // for the non-embedding seed path.
  const syntheticPages = new Map<string, string>(
    [...annotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );

  if (cfg.mode === "embedding" || cfg.mode === "hybrid") {
    const service = new PageSimilarityService({
      mode: cfg.mode,
      model: embed.model,
      dimensions: embed.dimensions,
      baseUrl: embed.baseUrl,
      apiKey: embed.apiKey,
      topK: cfg.topK,
      rrfK: 60,
    });
    // loadCache only needs `read`; cast the fs shim to the VaultTools shape.
    await service.loadCache(wikiVaultPath, fs as unknown as VaultTools);
    if (!embed.baseUrl || !embed.model) {
      console.warn(
        `[eval] config "${cfg.name}" requested ${cfg.mode}, but no embedding endpoint/model ` +
          `configured. Dense half falls back to jaccard internally.`,
      );
    }
    return async (question) => {
      const scored = await service.selectRelevantScored(question, annotations, allAnnotatedPaths);
      const top = scored.slice(0, cfg.topK);
      const seeds = top.map((x) => pageId(x.path));
      const seedScores = Object.fromEntries(top.map((x) => [pageId(x.path), x.score]));
      const { selectedIds, expandedScores } = await bfsExpandRanked(
        seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
      );
      const union = cfg.fuse
        ? fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graph, cfg.bfsDepth, 60)
        : [...selectedIds];
      return { seed: seeds, union };
    };
  }

  // jaccard
  const service = new PageSimilarityService({ mode: "jaccard", topK: cfg.topK });
  return async (question) => {
    // minScore = 0 so the full ranked list is visible (Recall@k not pre-truncated).
    const seedResults = selectSeeds(question, syntheticPages, cfg.topK, 0, annotations);
    const seeds = seedResults.map((x) => x.id);
    const { selectedIds } = await bfsExpandRanked(
      seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
    );
    return { seed: seeds, union: [...selectedIds] };
  };
}

/** Convenience: build the graph from pages (kept here so eval.ts stays thin). */
export function buildGraph(pages: Map<string, string>): WikiGraph {
  return buildWikiGraph(pages);
}
