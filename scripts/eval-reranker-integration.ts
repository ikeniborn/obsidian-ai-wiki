#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { demoteBoilerplateRankedItems, normalizeBoilerplateDemotionConfig } from "../src/boilerplate-demotion";
import { fuseLexicalRanks, rankLexicalChunks, rankLexicalPages, type LexicalChunkInput } from "../src/lexical-retrieval";
import type { SelectedChunk } from "../src/page-similarity";
import { scoreGoldRanking, validateGoldSet, type GoldMetrics, type GoldSet } from "../src/retrieval-eval-metrics";
import {
  applyRerankerScores,
  normalizeRerankerConfig,
  parseRerankerResponseText,
  rerankChunks,
  type RerankerCandidate,
  type RerankerScore,
  type RerankerTransport,
} from "../src/reranker";
import { buildWikiGraph, bfsExpandRanked, pageId } from "../src/wiki-graph";
import { isChunkIndexRecord, isPageIndexRecord, parseWikiIndexJsonl } from "../src/wiki-index-jsonl";
import {
  buildEvalDomain,
  buildHldQueries,
  CURRENT_OVERLAP_AT_5,
  evalQueryTokens,
  overlapRatio,
  splitEvalSections,
  uniqueTop,
  type HldQuery,
} from "./eval-jsonl-domain-storage";

export type RerankerIntegrationVerdict = "accepted" | "needs_tuning" | "blocked" | "rejected";

export interface RunRerankerIntegrationEvalOptions {
  source: string;
  outPath: string;
  baseUrl?: string;
  endpointPath?: string;
  model?: string;
  apiKey?: string;
  evalRoot?: string;
  goldPath?: string;
  seedTopK?: number;
  graphDepth?: number;
  bfsTopK?: number;
  rerankerTopN?: number;
  contextTopN?: number;
  timeoutMs?: number;
  candidateTextChars?: number;
}

export interface RerankerIntegrationQueryResult {
  id: string;
  theme: string;
  question: string;
  baselineTop: string[];
  rerankedTop: string[];
  baselineMetrics: GoldMetrics;
  rerankedMetrics: GoldMetrics;
  baselineLegacyOverlapAt5: number;
  rerankedLegacyOverlapAt5: number;
  floor: number;
  goldLabels: Array<{ path: string; grade: number }>;
  candidatesSent: number;
  rerankDurationMs: number;
  fallbackReason?: string;
  status: RerankerIntegrationVerdict;
  reason?: string;
  variants: RerankerIntegrationQueryVariant[];
}

export interface RerankerIntegrationEvalResult {
  source: string;
  evalRoot: string;
  outPath: string;
  baseUrl: string;
  endpointPath: string;
  model: string;
  markdownFiles: number;
  verdict: RerankerIntegrationVerdict;
  queries: RerankerIntegrationQueryResult[];
  aggregateBaseline: GoldMetrics;
  aggregateReranked: GoldMetrics;
  p95RerankLatencyMs: number;
  p95LatencyRegressionMs: number;
  rerankCalls: number;
  blockedReason?: string;
  seedTopK: number;
  graphDepth: number;
  bfsTopK: number;
  rerankerTopN: number;
  contextTopN: number;
  timeoutMs: number;
  candidateTextChars: number;
  bestVariantId: string;
  variants: RerankerIntegrationVariantResult[];
}

export interface RerankerIntegrationQueryVariant {
  id: string;
  top: string[];
  metrics: GoldMetrics;
  legacyOverlapAt5: number;
  status: RerankerIntegrationVerdict;
  reason?: string;
}

export interface RerankerIntegrationVariantResult {
  id: string;
  mode: "full" | "guarded";
  alpha?: number;
  maxPromotion?: number;
  promotionScope?: "chunk" | "page";
  minPromotionScoreGap?: number;
  minPromotionBaselineRatio?: number;
  maxPromotionTargetIndex?: number;
  verdict: RerankerIntegrationVerdict;
  aggregate: GoldMetrics;
  deltaRecallAt5: number;
  deltaNdcgAt5: number;
  deltaMrr: number;
  p95LatencyRegressionMs: number;
  blockedReason?: string;
}

const DEFAULTS = {
  seedTopK: 8,
  graphDepth: 1,
  bfsTopK: 25,
  rerankerTopN: 30,
  contextTopN: 8,
  timeoutMs: 800,
  candidateTextChars: 120,
  demotionFactor: 0.15,
} as const;

const RERANK_VARIANTS = [
  { id: "full-rerank", mode: "full" as const },
  { id: "guarded-alpha-0.05-cap-0", mode: "guarded" as const, alpha: 0.05, maxPromotion: 0 },
  { id: "guarded-alpha-0.05-cap-1", mode: "guarded" as const, alpha: 0.05, maxPromotion: 1 },
  { id: "guarded-alpha-0.10-cap-1", mode: "guarded" as const, alpha: 0.10, maxPromotion: 1 },
  { id: "guarded-alpha-0.15-cap-1", mode: "guarded" as const, alpha: 0.15, maxPromotion: 1 },
  { id: "guarded-alpha-0.25-cap-1", mode: "guarded" as const, alpha: 0.25, maxPromotion: 1 },
  { id: "guarded-alpha-0.35-cap-1", mode: "guarded" as const, alpha: 0.35, maxPromotion: 1 },
  { id: "guarded-alpha-0.10-cap-2", mode: "guarded" as const, alpha: 0.10, maxPromotion: 2 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.10", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.10 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.15", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.15 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.20", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20 },
  { id: "page-aware-alpha-0.80-cap-1-gap-0.20", mode: "guarded" as const, alpha: 0.80, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 0.95 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 0.95, maxPromotionTargetIndex: 2 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.20-base-1.00", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.30-base-1.00", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.30, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.40-base-1.00", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.40, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.20-base-1.00-top3", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 1.0, maxPromotionTargetIndex: 2 },
  { id: "page-aware-alpha-0.60-cap-1-gap-0.30-base-1.00-top3", mode: "guarded" as const, alpha: 0.60, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.30, minPromotionBaselineRatio: 1.0, maxPromotionTargetIndex: 2 },
  { id: "page-aware-alpha-0.80-cap-1-gap-0.20-base-1.00", mode: "guarded" as const, alpha: 0.80, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.80-cap-1-gap-0.30-base-1.00", mode: "guarded" as const, alpha: 0.80, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.30, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.80-cap-1-gap-0.40-base-1.00", mode: "guarded" as const, alpha: 0.80, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.40, minPromotionBaselineRatio: 1.0 },
  { id: "page-aware-alpha-0.80-cap-1-gap-0.20-base-1.00-top3", mode: "guarded" as const, alpha: 0.80, maxPromotion: 1, promotionScope: "page" as const, minPromotionScoreGap: 0.20, minPromotionBaselineRatio: 1.0, maxPromotionTargetIndex: 2 },
];

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function intArg(args: string[], flag: string, fallback: number): number {
  const raw = argValue(args, flag);
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function intArgOrEnv(args: string[], flag: string, envName: string, fallback: number): number {
  const raw = argValue(args, flag) ?? process.env[envName];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = value ?? fallback;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function optionsFromArgs(args: string[]): RunRerankerIntegrationEvalOptions {
  const source = argValue(args, "--source");
  const outPath = argValue(args, "--out");
  if (!source || !outPath) {
    throw new Error("Usage: npx tsx scripts/eval-reranker-integration.ts --source <HLD path> --out <report.md> --base-url <url> --model <model> [--endpoint-path /rerank]");
  }
  return {
    source,
    outPath,
    baseUrl: argValue(args, "--base-url") ?? process.env.RERANK_BASE_URL,
    endpointPath: argValue(args, "--endpoint-path") ?? process.env.RERANK_ENDPOINT_PATH,
    model: argValue(args, "--model") ?? process.env.RERANK_MODEL,
    apiKey: argValue(args, "--api-key") ?? process.env.RERANK_API_KEY ?? "",
    evalRoot: argValue(args, "--eval-root"),
    goldPath: argValue(args, "--gold"),
    seedTopK: intArg(args, "--seed-top-k", DEFAULTS.seedTopK),
    graphDepth: intArg(args, "--graph-depth", DEFAULTS.graphDepth),
    bfsTopK: intArg(args, "--bfs-top-k", DEFAULTS.bfsTopK),
    rerankerTopN: intArg(args, "--reranker-top-n", DEFAULTS.rerankerTopN),
    contextTopN: intArg(args, "--context-top-n", DEFAULTS.contextTopN),
    timeoutMs: intArg(args, "--timeout-ms", DEFAULTS.timeoutMs),
    candidateTextChars: intArgOrEnv(args, "--candidate-text-chars", "CANDIDATE_TEXT_CHARS", DEFAULTS.candidateTextChars),
  };
}

async function fetchRerankScoresNode(input: {
  baseUrl: string;
  endpointPath: string;
  apiKey: string;
  query: string;
  model: string;
  candidates: RerankerCandidate[];
  signal: AbortSignal;
}): Promise<RerankerScore[]> {
  const endpointPath = input.endpointPath.startsWith("/") ? input.endpointPath : `/${input.endpointPath}`;
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}${endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: input.model,
      query: input.query,
      documents: input.candidates.map((candidate) => candidate.text),
    }),
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`rerank HTTP ${response.status}`);
  return parseRerankerResponseText(await response.text(), input.candidates);
}

function selectedChunkId(chunk: SelectedChunk): string {
  return `${chunk.articleId}::${chunk.ordinal}`;
}

function averageGoldMetrics(metrics: GoldMetrics[]): GoldMetrics {
  if (metrics.length === 0) return { recallAtK: 0, ndcgAtK: 0, mrr: 0 };
  return {
    recallAtK: metrics.reduce((sum, item) => sum + item.recallAtK, 0) / metrics.length,
    ndcgAtK: metrics.reduce((sum, item) => sum + item.ndcgAtK, 0) / metrics.length,
    mrr: metrics.reduce((sum, item) => sum + item.mrr, 0) / metrics.length,
  };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function optionsWithDefaults(options: RunRerankerIntegrationEvalOptions): Required<Pick<
  RunRerankerIntegrationEvalOptions,
  "seedTopK" | "graphDepth" | "bfsTopK" | "rerankerTopN" | "contextTopN" | "timeoutMs"
  | "candidateTextChars"
>> {
  const contextTopN = boundedInt(options.contextTopN, DEFAULTS.contextTopN, 1, 50);
  const requestedRerankerTopN = boundedInt(options.rerankerTopN, DEFAULTS.rerankerTopN, 1, 100);
  return {
    seedTopK: boundedInt(options.seedTopK, DEFAULTS.seedTopK, 1, 100),
    graphDepth: boundedInt(options.graphDepth, DEFAULTS.graphDepth, 0, 5),
    bfsTopK: boundedInt(options.bfsTopK, DEFAULTS.bfsTopK, 0, 100),
    rerankerTopN: Math.max(requestedRerankerTopN, contextTopN),
    contextTopN,
    timeoutMs: boundedInt(options.timeoutMs, DEFAULTS.timeoutMs, 100, 5000),
    candidateTextChars: boundedInt(options.candidateTextChars, DEFAULTS.candidateTextChars, 80, 1000),
  };
}

interface EvalPage {
  id: string;
  path: string;
  title: string;
  description: string;
  content: string;
}

function buildChunkInputs(files: Array<{ vaultPath: string; content: string }>): LexicalChunkInput[] {
  return files.flatMap((file) => splitEvalSections(file.content).map((section) => ({
    articleId: pageId(file.vaultPath),
    path: file.vaultPath,
    heading: section.heading,
    body: section.window,
    embedText: `${section.heading}\n${section.window}`.trim(),
    ordinal: section.ordinal,
  })));
}

async function buildCandidates(input: {
  query: HldQuery;
  pages: EvalPage[];
  chunks: LexicalChunkInput[];
  pageTextByPath: Map<string, string>;
  seedTopK: number;
  graphDepth: number;
  bfsTopK: number;
  rerankerTopN: number;
}): Promise<SelectedChunk[]> {
  const queryTokens = evalQueryTokens(input.query);
  const pageRank = rankLexicalPages(queryTokens, input.pages, input.seedTopK);
  const graph = buildWikiGraph(input.pageTextByPath);
  const expanded = await bfsExpandRanked(
    pageRank.map((page) => page.id),
    graph,
    input.graphDepth,
    input.pageTextByPath,
    input.query.question,
    input.bfsTopK,
  );
  const expandedChunks = input.chunks.filter((chunk) => expanded.selectedIds.has(chunk.articleId));
  const chunkRank = rankLexicalChunks(queryTokens, expandedChunks, input.rerankerTopN);
  const fused = fuseLexicalRanks(pageRank, chunkRank, input.rerankerTopN);
  const pathByArticleId = new Map(input.pages.map((page) => [page.id, page.path]));
  const demoted = demoteBoilerplateRankedItems(
    fused.map((item) => ({ ...item, path: pathByArticleId.get(item.id) ?? item.id })),
    normalizeBoilerplateDemotionConfig({ enabled: true, factor: DEFAULTS.demotionFactor }),
    input.rerankerTopN,
  );
  const articleOrder = new Map(demoted.map((item, index) => [item.id, index]));
  const selected: SelectedChunk[] = [];
  const seen = new Set<string>();
  const orderedChunks = [...chunkRank].sort((a, b) =>
    ((articleOrder.get(a.articleId) ?? Number.MAX_SAFE_INTEGER) - (articleOrder.get(b.articleId) ?? Number.MAX_SAFE_INTEGER)) ||
    (b.score - a.score) ||
    a.path.localeCompare(b.path) ||
    ((a.ordinal ?? 0) - (b.ordinal ?? 0))
  );

  for (const chunk of orderedChunks) {
    const selectedChunk: SelectedChunk = {
      articleId: chunk.articleId,
      path: chunk.path,
      heading: chunk.heading ?? "",
      body: chunk.body ?? chunk.embedText ?? "",
      score: chunk.score,
      source: articleOrder.has(chunk.articleId) ? "seed" : "graph",
      ordinal: chunk.ordinal ?? 0,
    };
    const id = selectedChunkId(selectedChunk);
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(selectedChunk);
    if (selected.length >= input.rerankerTopN) break;
  }
  return selected;
}

function blockedResult(
  options: RunRerankerIntegrationEvalOptions,
  evalRoot: string,
  baseUrl: string,
  endpointPath: string,
  model: string,
  blockedReason: string,
): RerankerIntegrationEvalResult {
  const defaults = optionsWithDefaults(options);
  return {
    source: options.source,
    evalRoot,
    outPath: options.outPath,
    baseUrl,
    endpointPath,
    model,
    markdownFiles: 0,
    verdict: "blocked",
    queries: [],
    aggregateBaseline: { recallAtK: 0, ndcgAtK: 0, mrr: 0 },
    aggregateReranked: { recallAtK: 0, ndcgAtK: 0, mrr: 0 },
    p95RerankLatencyMs: 0,
    p95LatencyRegressionMs: 0,
    rerankCalls: 0,
    blockedReason,
    ...defaults,
    bestVariantId: "",
    variants: [],
  };
}

function classifyResult(input: {
  queries: RerankerIntegrationQueryResult[];
  aggregateBaseline: GoldMetrics;
  aggregateReranked: GoldMetrics;
  rerankCalls: number;
  p95LatencyRegressionMs: number;
}): { verdict: RerankerIntegrationVerdict; blockedReason?: string } {
  const fallback = input.queries.find((query) => query.fallbackReason);
  if (fallback) return { verdict: "blocked", blockedReason: `${fallback.id}: ${fallback.fallbackReason}` };
  if (input.rerankCalls === 0) return { verdict: "blocked", blockedReason: "zero successful rerank calls" };
  if (input.p95LatencyRegressionMs >= 1000) return { verdict: "rejected" };
  const qualityRegressed =
    input.aggregateReranked.recallAtK < input.aggregateBaseline.recallAtK ||
    input.aggregateReranked.ndcgAtK < input.aggregateBaseline.ndcgAtK ||
    input.aggregateReranked.mrr < 0.90 ||
    input.queries.some((query) => query.rerankedLegacyOverlapAt5 < query.floor);
  return { verdict: qualityRegressed ? "needs_tuning" : "accepted" };
}

function classifyVariantResult(input: {
  queryVariants: RerankerIntegrationQueryVariant[];
  aggregateBaseline: GoldMetrics;
  aggregateVariant: GoldMetrics;
  rerankCalls: number;
  p95LatencyRegressionMs: number;
}): { verdict: RerankerIntegrationVerdict; blockedReason?: string } {
  const fallback = input.queryVariants.find((query) => query.reason);
  if (fallback) return { verdict: "blocked", blockedReason: `${fallback.id}: ${fallback.reason}` };
  if (input.rerankCalls === 0) return { verdict: "blocked", blockedReason: "zero successful rerank calls" };
  if (input.p95LatencyRegressionMs >= 1000) return { verdict: "rejected" };
  const qualityRegressed =
    input.aggregateVariant.recallAtK < input.aggregateBaseline.recallAtK ||
    input.aggregateVariant.ndcgAtK < input.aggregateBaseline.ndcgAtK ||
    input.aggregateVariant.mrr < 0.90 ||
    input.queryVariants.some((query) => query.status === "needs_tuning");
  return { verdict: qualityRegressed ? "needs_tuning" : "accepted" };
}

function chooseBestVariant(variants: RerankerIntegrationVariantResult[]): RerankerIntegrationVariantResult | undefined {
  const guarded = variants.filter((variant) => variant.mode === "guarded");
  const pool = guarded.length > 0 ? guarded : variants;
  return [...pool].sort((a, b) => {
    const acceptedDelta = Number(b.verdict === "accepted") - Number(a.verdict === "accepted");
    if (acceptedDelta !== 0) return acceptedDelta;
    if (b.aggregate.ndcgAtK !== a.aggregate.ndcgAtK) return b.aggregate.ndcgAtK - a.aggregate.ndcgAtK;
    if (b.aggregate.recallAtK !== a.aggregate.recallAtK) return b.aggregate.recallAtK - a.aggregate.recallAtK;
    if (b.aggregate.mrr !== a.aggregate.mrr) return b.aggregate.mrr - a.aggregate.mrr;
    return (a.alpha ?? Number.MAX_SAFE_INTEGER) - (b.alpha ?? Number.MAX_SAFE_INTEGER);
  })[0];
}

export async function runRerankerIntegrationEval(
  options: RunRerankerIntegrationEvalOptions,
): Promise<RerankerIntegrationEvalResult> {
  const baseUrl = options.baseUrl?.trim() ?? "";
  const endpointPath = options.endpointPath?.trim() || "/rerank";
  const model = options.model?.trim() ?? "";
  const evalRoot = options.evalRoot ?? path.join(path.dirname(options.outPath), ".reranker-integration-hld-eval");
  const defaults = optionsWithDefaults(options);

  if (!baseUrl || !model) {
    const result = blockedResult(options, evalRoot, baseUrl, endpointPath, model, "missing baseUrl or model");
    await writeReport(result);
    return result;
  }

  const built = await buildEvalDomain(options.source, evalRoot);
  const goldPath = options.goldPath ?? path.join(process.cwd(), "docs/superpowers/evals/hld-gold-set.json");
  const gold = JSON.parse(await readFile(goldPath, "utf8")) as GoldSet;
  const index = parseWikiIndexJsonl(await readFile(built.indexPath, "utf8"), built.indexPath);
  const pageRecords = index.filter(isPageIndexRecord);
  const chunkRecordKeys = new Set(index
    .filter(isChunkIndexRecord)
    .map((record) => `${record.articleId}:${record.ordinal}`));
  validateGoldSet(
    gold,
    buildHldQueries().map((query) => query.id),
    new Set(pageRecords.map((record) => record.path)),
    new Set(built.files.map((file) => file.relPath)),
  );

  const contentByPath = new Map(built.files.map((file) => [file.vaultPath, file.content]));
  const pages: EvalPage[] = pageRecords.map((record) => ({
    id: record.articleId,
    path: record.path,
    title: path.basename(record.path, ".md"),
    description: record.description,
    content: contentByPath.get(record.path) ?? "",
  }));
  const allChunks = buildChunkInputs(built.files)
    .filter((chunk) => chunkRecordKeys.has(`${chunk.articleId}:${chunk.ordinal ?? 0}`));
  const rerankerConfig = normalizeRerankerConfig({
    enabled: true,
    model,
    rerankerTopN: defaults.rerankerTopN,
    contextTopN: defaults.contextTopN,
    timeoutMs: defaults.timeoutMs,
    candidateTextChars: defaults.candidateTextChars,
  });
  const transport: RerankerTransport = (input) => fetchRerankScoresNode({
    baseUrl: input.baseUrl,
    endpointPath,
    apiKey: input.apiKey,
    query: input.query,
    model: input.config.model,
    candidates: input.candidates,
    signal: input.signal,
  });

  let rerankCalls = 0;
  const queries: RerankerIntegrationQueryResult[] = [];
  for (const query of buildHldQueries()) {
    const labels = gold.queries[query.id].relevant;
    const candidates = await buildCandidates({
      query,
      pages,
      chunks: allChunks,
      pageTextByPath: contentByPath,
      ...defaults,
    });
    const baselineTop = uniqueTop(candidates.map((chunk) => chunk.path), defaults.contextTopN);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Reranker timeout", "AbortError"));
    }, rerankerConfig.timeoutMs);
    const reranked = await rerankChunks(query.question, candidates, {
      config: rerankerConfig,
      baseUrl,
      apiKey: options.apiKey ?? "",
      signal: controller.signal,
      transport,
    }).finally(() => clearTimeout(timeout));
    if (!reranked.fallbackReason && reranked.candidates > 0) rerankCalls++;

    const baselineMetrics = scoreGoldRanking(labels, baselineTop, 5);
    const baselineLegacyOverlapAt5 = overlapRatio(baselineTop, baselineTop, 5);
    const floor = CURRENT_OVERLAP_AT_5[query.id] ?? 0;
    const variants = RERANK_VARIANTS.map((variant): RerankerIntegrationQueryVariant => {
      const variantChunks = reranked.fallbackReason
        ? reranked.chunks
        : applyRerankerScores(candidates, reranked.scores ?? [], candidates.length, {
          mode: variant.mode,
          alpha: variant.alpha,
          maxPromotion: variant.maxPromotion,
          promotionScope: variant.promotionScope ?? "chunk",
          minPromotionScoreGap: variant.minPromotionScoreGap ?? 0,
          minPromotionBaselineRatio: variant.minPromotionBaselineRatio ?? 0,
          maxPromotionTargetIndex: variant.maxPromotionTargetIndex ?? Number.MAX_SAFE_INTEGER,
        });
      const top = uniqueTop(variantChunks.map((chunk) => chunk.path), defaults.contextTopN);
      const metrics = scoreGoldRanking(labels, top, 5);
      const legacyOverlapAt5 = overlapRatio(baselineTop, top, 5);
      const status: RerankerIntegrationVerdict = reranked.fallbackReason
        ? "blocked"
        : legacyOverlapAt5 < floor ||
            metrics.recallAtK < baselineMetrics.recallAtK ||
            metrics.ndcgAtK < baselineMetrics.ndcgAtK ||
            metrics.mrr < 0.90
          ? "needs_tuning"
          : "accepted";
      return {
        id: variant.id,
        top,
        metrics,
        legacyOverlapAt5,
        status,
        reason: reranked.fallbackReason,
      };
    });
    const defaultVariant = variants.find((variant) => variant.id === "guarded-alpha-0.05-cap-0") ?? variants[0];
    queries.push({
      ...query,
      baselineTop,
      rerankedTop: defaultVariant.top,
      baselineMetrics,
      rerankedMetrics: defaultVariant.metrics,
      baselineLegacyOverlapAt5,
      rerankedLegacyOverlapAt5: defaultVariant.legacyOverlapAt5,
      floor,
      goldLabels: labels.map((label) => ({ path: label.path, grade: label.grade })),
      candidatesSent: reranked.candidates,
      rerankDurationMs: reranked.durationMs,
      fallbackReason: reranked.fallbackReason,
      status: defaultVariant.status,
      reason: reranked.fallbackReason,
      variants,
    });
  }

  const aggregateBaseline = averageGoldMetrics(queries.map((query) => query.baselineMetrics));
  const p95RerankLatencyMs = p95(queries.map((query) => query.rerankDurationMs));
  const p95LatencyRegressionMs = p95RerankLatencyMs;
  const variants: RerankerIntegrationVariantResult[] = RERANK_VARIANTS.map((variant) => {
    const queryVariants = queries
      .map((query) => query.variants.find((item) => item.id === variant.id))
      .filter((item): item is RerankerIntegrationQueryVariant => !!item);
    const aggregate = averageGoldMetrics(queryVariants.map((item) => item.metrics));
    const classified = classifyVariantResult({
      queryVariants,
      aggregateBaseline,
      aggregateVariant: aggregate,
      rerankCalls,
      p95LatencyRegressionMs,
    });
    return {
      id: variant.id,
      mode: variant.mode,
      alpha: variant.alpha,
      maxPromotion: variant.maxPromotion,
      promotionScope: variant.promotionScope,
      minPromotionScoreGap: variant.minPromotionScoreGap,
      minPromotionBaselineRatio: variant.minPromotionBaselineRatio,
      maxPromotionTargetIndex: variant.maxPromotionTargetIndex,
      verdict: classified.verdict,
      aggregate,
      deltaRecallAt5: aggregate.recallAtK - aggregateBaseline.recallAtK,
      deltaNdcgAt5: aggregate.ndcgAtK - aggregateBaseline.ndcgAtK,
      deltaMrr: aggregate.mrr - aggregateBaseline.mrr,
      p95LatencyRegressionMs,
      blockedReason: classified.blockedReason,
    };
  });
  const bestVariant = chooseBestVariant(variants);
  const bestVariantId = bestVariant?.id ?? "";
  for (const query of queries) {
    const selected = query.variants.find((variant) => variant.id === bestVariantId);
    if (!selected) continue;
    query.rerankedTop = selected.top;
    query.rerankedMetrics = selected.metrics;
    query.rerankedLegacyOverlapAt5 = selected.legacyOverlapAt5;
    query.status = selected.status;
    query.reason = selected.reason;
  }
  const aggregateReranked = bestVariant?.aggregate ?? averageGoldMetrics(queries.map((query) => query.rerankedMetrics));
  const classified = classifyResult({
    queries,
    aggregateBaseline,
    aggregateReranked,
    rerankCalls,
    p95LatencyRegressionMs,
  });
  const result: RerankerIntegrationEvalResult = {
    source: options.source,
    evalRoot,
    outPath: options.outPath,
    baseUrl,
    endpointPath,
    model,
    markdownFiles: built.files.length,
    verdict: bestVariant?.verdict ?? classified.verdict,
    queries,
    aggregateBaseline,
    aggregateReranked,
    p95RerankLatencyMs,
    p95LatencyRegressionMs,
    rerankCalls,
    blockedReason: bestVariant?.blockedReason ?? classified.blockedReason,
    ...defaults,
    bestVariantId,
    variants,
  };
  await writeReport(result);
  return result;
}

function metricSummary(metrics: GoldMetrics): string {
  return `Recall@5 ${metrics.recallAtK.toFixed(2)}, nDCG@5 ${metrics.ndcgAtK.toFixed(2)}, MRR ${metrics.mrr.toFixed(2)}`;
}

function renderPathList(paths: string[], grades: Map<string, number>): string[] {
  return paths.map((pathValue) => {
    const grade = grades.get(pathValue) ?? 0;
    return `- \`${pathValue}\` (gold grade ${grade})`;
  });
}

function sanitizeEndpointForReport(baseUrl: string): string {
  if (!baseUrl) return "(missing)";
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|auth/i.test(key)) url.searchParams.set(key, "<redacted>");
    }
    return url.toString().replace(/%3Credacted%3E/gi, "<redacted>").replace(/\/$/, "");
  } catch {
    return baseUrl.replace(/(key|token|secret|auth)=([^&\s]+)/gi, "$1=<redacted>");
  }
}

function renderReport(result: RerankerIntegrationEvalResult): string {
  const lines: string[] = [];
  lines.push("# Reranker Integration HLD Eval");
  lines.push("");
  lines.push(`Source: \`${result.source}\``);
  lines.push(`Eval root: \`${result.evalRoot}\``);
  lines.push(`Endpoint: \`${sanitizeEndpointForReport(result.baseUrl)}${result.endpointPath}\``);
  lines.push(`Model: \`${result.model || "(missing)"}\``);
  lines.push(`Top-K flow: \`${result.seedTopK} -> ${result.graphDepth}/${result.bfsTopK} -> ${result.rerankerTopN} -> ${result.contextTopN}\``);
  lines.push(`Reranker top N: \`${result.rerankerTopN}\``);
  lines.push(`Context top N: \`${result.contextTopN}\``);
  lines.push(`Timeout: \`${result.timeoutMs} ms\``);
  lines.push(`Candidate text cap: \`${result.candidateTextChars} chars\``);
  lines.push(`Verdict: \`${result.verdict}\``);
  lines.push(`Best variant: \`${result.bestVariantId || "(none)"}\``);
  if (result.blockedReason) lines.push(`Blocked reason: ${result.blockedReason}`);
  lines.push("");
  lines.push("## Aggregate");
  lines.push(`Markdown files: ${result.markdownFiles}`);
  lines.push(`Baseline: ${metricSummary(result.aggregateBaseline)}`);
  lines.push(`Reranked: ${metricSummary(result.aggregateReranked)}`);
  lines.push(`Delta Recall@5: ${(result.aggregateReranked.recallAtK - result.aggregateBaseline.recallAtK).toFixed(2)}`);
  lines.push(`Delta nDCG@5: ${(result.aggregateReranked.ndcgAtK - result.aggregateBaseline.ndcgAtK).toFixed(2)}`);
  lines.push(`Delta MRR: ${(result.aggregateReranked.mrr - result.aggregateBaseline.mrr).toFixed(2)}`);
  lines.push(`p95 rerank latency: ${result.p95RerankLatencyMs} ms`);
  lines.push(`p95 latency regression: ${result.p95LatencyRegressionMs} ms`);
  lines.push(`Successful rerank calls: ${result.rerankCalls}`);
  lines.push("");
  lines.push("## Variants");
  lines.push("| Variant | Mode | Scope | Alpha | Max promotion | Min gap | Base ratio | Max target | Verdict | Recall@5 | nDCG@5 | MRR | Delta Recall | Delta nDCG | Delta MRR | Blocked reason |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const variant of result.variants) {
    lines.push(`| \`${variant.id}\` | ${variant.mode} | ${variant.promotionScope ?? "chunk"} | ${variant.alpha?.toFixed(2) ?? "-"} | ${variant.maxPromotion ?? "-"} | ${variant.minPromotionScoreGap?.toFixed(2) ?? "-"} | ${variant.minPromotionBaselineRatio?.toFixed(2) ?? "-"} | ${variant.maxPromotionTargetIndex ?? "-"} | \`${variant.verdict}\` | ${variant.aggregate.recallAtK.toFixed(2)} | ${variant.aggregate.ndcgAtK.toFixed(2)} | ${variant.aggregate.mrr.toFixed(2)} | ${variant.deltaRecallAt5.toFixed(2)} | ${variant.deltaNdcgAt5.toFixed(2)} | ${variant.deltaMrr.toFixed(2)} | ${variant.blockedReason ?? "-"} |`);
  }
  lines.push("");
  lines.push("## Queries");
  for (const query of result.queries) {
    const grades = new Map(query.goldLabels.map((label): [string, number] => [label.path, label.grade]));
    lines.push(`### ${query.id}`);
    lines.push(`Theme: ${query.theme}`);
    lines.push(`Question: ${query.question}`);
    lines.push(`Status: \`${query.status}\``);
    if (query.reason) lines.push(`Reason: ${query.reason}`);
    lines.push(`Candidates sent: ${query.candidatesSent}`);
    lines.push(`Rerank latency: ${query.rerankDurationMs} ms`);
    lines.push(`Floor: ${query.floor.toFixed(2)}`);
    lines.push(`Baseline metrics: ${metricSummary(query.baselineMetrics)}`);
    lines.push(`Reranked metrics: ${metricSummary(query.rerankedMetrics)}`);
    lines.push(`Baseline LegacyOverlap@5: ${query.baselineLegacyOverlapAt5.toFixed(2)}`);
    lines.push(`Reranked LegacyOverlap@5: ${query.rerankedLegacyOverlapAt5.toFixed(2)}`);
    lines.push("Baseline top:");
    lines.push(...renderPathList(query.baselineTop, grades));
    lines.push("Reranked top:");
    lines.push(...renderPathList(query.rerankedTop, grades));
    lines.push("");
  }
  lines.push("## Decision");
  lines.push("This report is model-on integration evidence for the selected rerank endpoint and model. It does not alter plugin runtime defaults and does not make reranking required for normal plugin use.");
  if (result.verdict === "accepted") {
    lines.push("The endpoint produced successful rerank calls and passed quality and latency gates.");
  } else if (result.verdict === "blocked") {
    lines.push("The eval is blocked; missing or malformed endpoint/model evidence cannot be accepted.");
  } else if (result.verdict === "rejected") {
    lines.push("The eval is rejected by a hard latency gate.");
  } else {
    lines.push("The endpoint responded, but quality gates need tuning before acceptance.");
  }
  lines.push("");
  return lines.join("\n");
}

async function writeReport(result: RerankerIntegrationEvalResult): Promise<void> {
  await mkdir(path.dirname(result.outPath), { recursive: true });
  await writeFile(result.outPath, renderReport(result), "utf8");
}

async function main(args: string[]): Promise<void> {
  const result = await runRerankerIntegrationEval(optionsFromArgs(args));
  console.log(`wrote ${result.outPath}`);
  if (result.verdict === "blocked" || result.verdict === "rejected") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[eval-reranker-integration] ${(err as Error).message}`);
    process.exit(1);
  });
}
