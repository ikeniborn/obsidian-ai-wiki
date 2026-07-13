import type { DomainCandidates } from "./query";
import { fuseVectorGraph } from "../fusion";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { PageSimilarityService, renderContextChunks, type SelectedChunk } from "../page-similarity";
import { retrieveDomainCandidates, type RetrieveCfg } from "./query";
import { answerFromContext } from "./query-answer";
import { render } from "./template";
import queryTemplate from "../../prompts/query.md";
import { promptVersionOf } from "../prompt-version";
import { demoteBoilerplateRankedIds, type BoilerplateDemotionConfig } from "../boilerplate-demotion";
import {
  normalizeRerankerConfig,
  rerankChunks,
  type RerankerRuntime,
} from "../reranker";

export interface MergedPool {
  mergedPages: Map<string, string>;
  mergedSeeds: string[];
  mergedSeedSet: Set<string>;
  mergedSeedScores: Record<string, number>;
  mergedExpandedScores: Record<string, number>;
  allCandidates: Set<string>;
  mergedGraph: Map<string, Set<string>>;
  mergedAnnotations: Map<string, string>;
  fusedOrder: string[];
  finalIds: string[];
}

interface CrossDomainQueryCfg extends RetrieveCfg {
  rerankerRuntime?: RerankerRuntime;
}

const DEFAULT_RERANKER_RUNTIME: RerankerRuntime = {
  config: normalizeRerankerConfig(undefined),
  baseUrl: "",
  apiKey: "",
};

/**
 * Stage 2: union the per-domain candidate sets (stems are globally unique, so the
 * merge is collision-free), RRF-fuse vector + graph over the union, and take the
 * top-`candidateTopN`. No new pages are introduced — only the stage-1 pool is re-ranked.
 */
export function mergeCandidates(
  pool: DomainCandidates[],
  candidateTopN: number,
  graphDepth: number,
  rrfK: number,
  boilerplateDemotion?: BoilerplateDemotionConfig,
): MergedPool {
  const mergedPages = new Map<string, string>();
  const mergedSeeds: string[] = [];
  const mergedSeedScores: Record<string, number> = {};
  const mergedExpandedScores: Record<string, number> = {};
  const allCandidates = new Set<string>();
  const mergedGraph = new Map<string, Set<string>>();
  const mergedAnnotations = new Map<string, string>();

  for (const c of pool) {
    for (const [p, body] of c.pages) mergedPages.set(p, body);
    for (const s of c.seeds) mergedSeeds.push(s);
    for (const [k, v] of Object.entries(c.seedScores)) mergedSeedScores[k] = v;
    for (const [k, v] of Object.entries(c.expandedScores)) mergedExpandedScores[k] = v;
    for (const id of c.candidateIds) allCandidates.add(id);
    for (const [k, v] of c.annotations) mergedAnnotations.set(k, v);
    for (const [node, edges] of c.graph) {
      const cur = mergedGraph.get(node);
      if (cur) { for (const e of edges) cur.add(e); }      // defensive: duplicate stem (broken mask)
      else mergedGraph.set(node, new Set(edges));
    }
  }

  const mergedSeedSet = new Set(mergedSeeds);
  const fusedOrder = fuseVectorGraph(
    mergedSeeds, allCandidates, mergedSeedScores, mergedExpandedScores, mergedGraph, graphDepth, rrfK,
  );
  const cap = Math.max(1, Math.min(100, Math.floor(candidateTopN)));
  const finalIds = demoteBoilerplateRankedIds(
    fusedOrder,
    boilerplateDemotion ?? { enabled: false, factor: 0 },
    cap,
  );

  return {
    mergedPages, mergedSeeds, mergedSeedSet, mergedSeedScores, mergedExpandedScores,
    allCandidates, mergedGraph, mergedAnnotations, fusedOrder, finalIds,
  };
}

export async function* runCrossDomainQuery(
  question: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  signal: AbortSignal,
  cfg: CrossDomainQueryCfg,
  rrfK: number,
  wikiLinkValidationRetries: number,
  opts: LlmCallOptions,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent, void> {
  const q = question.trim();
  if (!q) { yield { kind: "error", message: "query: question required" }; return; }
  if (domains.length === 0) { yield { kind: "error", message: "No domains configured. Add a domain in settings." }; return; }

  const start = Date.now();
  let outputTokens = 0;
  const querySimilarity = similarity ? similarity.withBoilerplateDemotion(cfg.boilerplateDemotion) : undefined;
  const rerankerRuntime = cfg.rerankerRuntime ?? DEFAULT_RERANKER_RUNTIME;
  const candidateLimit = rerankerRuntime.config.rerankerTopN;
  const contextLimit = rerankerRuntime.config.contextTopN;

  // Stage 1 — gather candidates per domain, sequentially.
  const poolList: DomainCandidates[] = [];
  for (const domain of domains) {
    if (signal.aborted) return;
    yield { kind: "tool_use", name: `Domain: ${domain.name}`, input: {} };
    const cand = yield* retrieveDomainCandidates(domain, q, vaultTools, querySimilarity, signal, cfg);
    yield { kind: "tool_result", ok: !!cand, preview: cand ? `${cand.candidateIds.size} candidates` : "skipped" };
    if (cand) poolList.push(cand);
  }
  if (signal.aborted) return;
  if (poolList.length === 0) { yield { kind: "error", message: "No relevant pages found across domains." }; return; }

  // Stage 2 — merge + fuse + cap.
  const merged = mergeCandidates(poolList, candidateLimit, cfg.graphDepth, rrfK, cfg.boilerplateDemotion);
  const finalSet = new Set(merged.finalIds);

  const fallbackSimilarity = new PageSimilarityService({
    mode: "jaccard",
    topK: candidateLimit,
    boilerplateDemotion: cfg.boilerplateDemotion,
  });
  const chunkSimilarity = querySimilarity ?? fallbackSimilarity;
  const articleScores = { ...merged.mergedExpandedScores, ...merged.mergedSeedScores };
  const selectedChunks: SelectedChunk[] = await chunkSimilarity.selectRelevantChunks(
    q,
    merged.mergedPages,
    finalSet,
    merged.mergedSeedSet,
    articleScores,
    candidateLimit,
  );
  if (signal.aborted) return;
  if (selectedChunks.length === 0) {
    yield { kind: "error", message: "No relevant pages found across domains." };
    return;
  }
  const reranked = await rerankChunks(q, selectedChunks, {
    config: rerankerRuntime.config,
    baseUrl: rerankerRuntime.baseUrl,
    apiKey: rerankerRuntime.apiKey,
    signal,
  });
  if (signal.aborted) return;

  const contextChunks = reranked.chunks.slice(0, contextLimit);
  const contextBlock = renderContextChunks(contextChunks);
  const finalChunkIds = new Set(contextChunks.map((chunk) => chunk.articleId));

  // Domains whose candidates survive into the final capped set (robust to underscores in domain ids).
  const finalDomains = [...new Set(
    poolList
      .filter((candidate) => [...candidate.candidateIds].some((id) => finalChunkIds.has(id)))
      .map((candidate) => candidate.domainId)
  )];
  const finalNames = finalDomains.map((id) => domains.find((d) => d.id === id)?.name ?? id);
  const domainName = `All domains (${finalDomains.length}): ${finalNames.join(", ")}`;

  const wikiFirst = [...finalChunkIds].sort((a, b) => Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
  const availableLinksBlock = wikiFirst.length === 0 ? "" : [
    "Valid WikiLink targets (use EXACTLY these, copy verbatim):",
    ...wikiFirst.map((s) => `- ${s}`),
    "ONLY link to a target from this list. Never invent or abbreviate stems.",
  ].join("\n");

  const entityTypesBlock = buildCrossDomainEntityTypes(domains, finalDomains);
  const indexBlock = buildCrossDomainIndexBlock(merged.mergedAnnotations, [...finalChunkIds]);
  const rerankerDiagnostics = {
    enabled: rerankerRuntime.config.enabled,
    candidates: reranked.candidates,
    selected: contextChunks.length,
    durationMs: reranked.durationMs,
    fallbackReason: reranked.fallbackReason,
  };

  const systemPrompt = render(queryTemplate, {
    domain_name: domainName,
    available_links_block: availableLinksBlock,
    entity_types_block: entityTypesBlock,
    index_block: indexBlock ? `\nWiki index (candidates):\n${indexBlock}` : "",
  });

  yield {
    kind: "query_stats",
    crossDomain: true,
    domainsStudied: poolList.length,
    domainsTotal: domains.length,
    fromDomains: finalNames,
    pagesScanned: poolList.reduce((sum, candidate) => sum + candidate.pagesScanned, 0),
    pagesSelected: finalChunkIds.size,
    candidatePages: finalSet.size,
    chunksSelected: contextChunks.length,
    rerankerEnabled: rerankerRuntime.config.enabled,
    rerankerTopN: rerankerRuntime.config.rerankerTopN,
    contextTopN: rerankerRuntime.config.contextTopN,
    reranker: rerankerDiagnostics,
  };
  if (signal.aborted) return;

  const ans = yield* answerFromContext({
    llm, model, opts, signal, systemPrompt, question: q,
    contextBlock, selectedIds: finalChunkIds, wikiLinkValidationRetries,
  });
  outputTokens += ans.outputTokens;
  if (signal.aborted) return;

  yield {
    kind: "eval_meta",
    fields: {
      question: q,
      answer: ans.answer,
      found_pages: [...finalChunkIds],
      found_chunks: contextChunks.map((chunk) => ({
        articleId: chunk.articleId,
        heading: chunk.heading,
        score: chunk.score,
      })),
      promptVersion: promptVersionOf(queryTemplate),
      retrievalConfig: {
        mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
        seedTopK: cfg.seedTopK,
        bfsTopK: cfg.bfsTopK,
        bfsMinScoreRatio: cfg.bfsMinScoreRatio ?? 0,
        bfsFusion: true,
        seedSimilarityThreshold: cfg.seedSimilarityThreshold,
        hybridRetrieval: similarity?.config.mode === "hybrid",
        hierarchicalChunkRetrieval: true,
        crossDomain: true,
        domainsSearched: domains.length,
        rerankerEnabled: rerankerRuntime.config.enabled,
        rerankerTopN: rerankerRuntime.config.rerankerTopN,
        contextTopN: rerankerRuntime.config.contextTopN,
        reranker: rerankerDiagnostics,
      },
    },
  };

  yield { kind: "result", durationMs: Date.now() - start, text: ans.answer, outputTokens: outputTokens || undefined };
}

export function buildCrossDomainEntityTypes(domains: DomainEntry[], domainIds: string[]): string {
  const blocks: string[] = [];
  for (const d of domains) {
    if (!domainIds.includes(d.id) || !d.entity_types?.length) continue;
    const types = d.entity_types.map((et) => `  - ${et.type}: ${et.description}`).join("\n");
    const notes = d.language_notes ? `\nLanguage rules: ${d.language_notes}` : "";
    blocks.push(`Entity types of "${d.name}":\n${types}${notes}`);
  }
  return blocks.join("\n");
}

function buildCrossDomainIndexBlock(annotations: Map<string, string>, finalIds: string[]): string {
  return finalIds
    .map((id) => { const a = annotations.get(id); return a ? `${id}: ${a}` : null; })
    .filter((x): x is string => x !== null)
    .join("\n");
}
