import type { SelectedChunk } from "./page-similarity";

export const DEFAULT_RERANKER_SETTINGS = {
  enabled: false,
  model: "",
  rerankerTopN: 30,
  contextTopN: 8,
  timeoutMs: 800,
} as const;

export const DEFAULT_RERANKER_BLEND_ALPHA = 0.60;
export const DEFAULT_RERANKER_MAX_PROMOTION = 1;
export const DEFAULT_RERANKER_PROMOTION_SCOPE = "page";
export const DEFAULT_RERANKER_MIN_PROMOTION_SCORE_GAP = 0.20;
export const DEFAULT_RERANKER_MIN_PROMOTION_BASELINE_RATIO = 0.95;
export const DEFAULT_RERANKER_MAX_PROMOTION_TARGET_INDEX = 2;
export const DEFAULT_RERANKER_CANDIDATE_TEXT_CHARS = 120;
export const MAX_RERANKER_CANDIDATE_TEXT_CHARS = DEFAULT_RERANKER_CANDIDATE_TEXT_CHARS;

export interface RerankerConfigInput {
  enabled?: boolean;
  model?: string;
  rerankerTopN?: number;
  contextTopN?: number;
  timeoutMs?: number;
  candidateTextChars?: number;
}

export interface RerankerConfig {
  enabled: boolean;
  model: string;
  rerankerTopN: number;
  contextTopN: number;
  timeoutMs: number;
  candidateTextChars: number;
}

export interface RerankerCandidate {
  id: string;
  text: string;
  chunk: SelectedChunk;
}

export interface RerankerScore {
  id: string;
  score: number;
}

export interface ApplyRerankerScoresOptions {
  mode?: "guarded" | "full";
  alpha?: number;
  maxPromotion?: number;
  promotionScope?: "chunk" | "page";
  minPromotionScoreGap?: number;
  minPromotionBaselineRatio?: number;
  maxPromotionTargetIndex?: number;
}

export type RerankerFallbackReason =
  | "disabled"
  | "missing-model"
  | "empty-candidates"
  | "timeout"
  | "error"
  | "malformed-response";

export type RerankerTransport = (input: {
  query: string;
  candidates: RerankerCandidate[];
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
}) => Promise<RerankerScore[]>;

export interface RerankerRuntime {
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
}

export interface RerankChunksOptions extends RerankerRuntime {
  signal: AbortSignal;
  transport?: RerankerTransport;
}

export interface RerankChunksResult {
  chunks: SelectedChunk[];
  durationMs: number;
  candidates: number;
  scores?: RerankerScore[];
  fallbackReason?: RerankerFallbackReason;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function normalizeRerankerConfig(input?: RerankerConfigInput): RerankerConfig {
  const contextTopN = clampInt(input?.contextTopN, DEFAULT_RERANKER_SETTINGS.contextTopN, 1, 50);
  const requestedRerankerTopN = clampInt(
    input?.rerankerTopN,
    DEFAULT_RERANKER_SETTINGS.rerankerTopN,
    1,
    100,
  );
  const model = typeof input?.model === "string"
    ? input.model.trim()
    : DEFAULT_RERANKER_SETTINGS.model;

  return {
    enabled: input?.enabled ?? DEFAULT_RERANKER_SETTINGS.enabled,
    model,
    rerankerTopN: Math.max(requestedRerankerTopN, contextTopN),
    contextTopN,
    timeoutMs: clampInt(input?.timeoutMs, DEFAULT_RERANKER_SETTINGS.timeoutMs, 100, 5000),
    candidateTextChars: clampInt(input?.candidateTextChars, DEFAULT_RERANKER_CANDIDATE_TEXT_CHARS, 80, 1000),
  };
}

export function rerankerChunkId(chunk: SelectedChunk): string {
  return `${chunk.articleId}::${chunk.ordinal}`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function titleFromPath(pathValue: string): string {
  const fileName = pathValue.split("/").pop() ?? pathValue;
  return fileName.replace(/\.md$/i, "");
}

function queryTokens(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []))];
}

function queryAwareExcerpt(query: string, body: string, maxChars: number): string {
  const normalizedBody = normalizeWhitespace(body);
  if (normalizedBody.length <= maxChars) return normalizedBody;

  const lower = normalizedBody.toLowerCase();
  const matchIndex = queryTokens(query)
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (matchIndex === undefined) return normalizedBody.slice(0, maxChars).trim();

  const start = Math.max(0, matchIndex - Math.floor(maxChars / 3));
  return normalizedBody.slice(start, start + maxChars).trim();
}

function buildCandidateText(query: string, chunk: SelectedChunk, maxChars: number): string {
  const prefix = [
    `Title: ${titleFromPath(chunk.path)}`,
    `Path: ${chunk.path}`,
    `Heading: ${normalizeWhitespace(chunk.heading)}`,
    "Text:",
  ].join("\n");
  const excerptBudget = Math.max(0, maxChars - prefix.length - 1);
  const excerpt = queryAwareExcerpt(query, chunk.body, excerptBudget);
  return `${prefix} ${excerpt}`.trim().slice(0, maxChars);
}

export function buildRerankerCandidates(
  query: string,
  chunks: SelectedChunk[],
  config: RerankerConfig,
): RerankerCandidate[] {
  const candidateTextChars = Number.isFinite(config.candidateTextChars)
    ? config.candidateTextChars
    : DEFAULT_RERANKER_CANDIDATE_TEXT_CHARS;
  return chunks.slice(0, config.rerankerTopN).map((chunk) => ({
    id: rerankerChunkId(chunk),
    text: buildCandidateText(query, chunk, candidateTextChars),
    chunk,
  }));
}

export function applyRerankerScores(
  original: SelectedChunk[],
  scores: RerankerScore[],
  limit: number,
  options: ApplyRerankerScoresOptions = {},
): SelectedChunk[] {
  type RankedRerankerItem = {
    chunk: SelectedChunk;
    index: number;
    score: number | undefined;
    finalScore: number;
  };
  const mode = options.mode ?? "guarded";
  const alpha = Number.isFinite(options.alpha) ? Math.max(0, options.alpha ?? DEFAULT_RERANKER_BLEND_ALPHA) : DEFAULT_RERANKER_BLEND_ALPHA;
  const maxPromotion = Number.isFinite(options.maxPromotion)
    ? Math.max(0, Math.floor(options.maxPromotion ?? DEFAULT_RERANKER_MAX_PROMOTION))
    : DEFAULT_RERANKER_MAX_PROMOTION;
  const promotionScope = options.promotionScope ?? DEFAULT_RERANKER_PROMOTION_SCOPE;
  const minPromotionScoreGap = Number.isFinite(options.minPromotionScoreGap)
    ? Math.max(0, options.minPromotionScoreGap ?? DEFAULT_RERANKER_MIN_PROMOTION_SCORE_GAP)
    : DEFAULT_RERANKER_MIN_PROMOTION_SCORE_GAP;
  const minPromotionBaselineRatio = Number.isFinite(options.minPromotionBaselineRatio)
    ? Math.max(0, options.minPromotionBaselineRatio ?? DEFAULT_RERANKER_MIN_PROMOTION_BASELINE_RATIO)
    : DEFAULT_RERANKER_MIN_PROMOTION_BASELINE_RATIO;
  const maxPromotionTargetIndex = Number.isFinite(options.maxPromotionTargetIndex)
    ? Math.max(0, Math.floor(options.maxPromotionTargetIndex ?? DEFAULT_RERANKER_MAX_PROMOTION_TARGET_INDEX))
    : DEFAULT_RERANKER_MAX_PROMOTION_TARGET_INDEX;
  const scoreById = new Map(
    scores
      .filter((score) => Number.isFinite(score.score))
      .map((score) => [score.id, score.score]),
  );
  const finiteScores = [...scoreById.values()];
  const minScore = finiteScores.length > 0 ? Math.min(...finiteScores) : 0;
  const maxScore = finiteScores.length > 0 ? Math.max(...finiteScores) : 0;
  const spread = maxScore - minScore;

  function normalizedScore(score: number | undefined): number {
    if (score === undefined) return 0;
    if (spread <= 0) return 1;
    return (score - minScore) / spread;
  }

  if (mode === "guarded" && promotionScope === "page") {
    type PageItem = {
      articleId: string;
      index: number;
      score: number | undefined;
      baselineScore: number;
      chunks: SelectedChunk[];
    };
    const pageItems: PageItem[] = [];
    const pageByArticleId = new Map<string, PageItem>();
    for (const chunk of original) {
      const existing = pageByArticleId.get(chunk.articleId);
      const score = scoreById.get(rerankerChunkId(chunk));
      if (existing) {
        existing.chunks.push(chunk);
        existing.baselineScore = Math.max(existing.baselineScore, chunk.score);
        if (score !== undefined && (existing.score === undefined || score > existing.score)) {
          existing.score = score;
        }
        continue;
      }
      const item: PageItem = {
        articleId: chunk.articleId,
        index: pageItems.length,
        score,
        baselineScore: chunk.score,
        chunks: [chunk],
      };
      pageItems.push(item);
      pageByArticleId.set(chunk.articleId, item);
    }

    const rankedPages = [...pageItems].sort((a, b) => {
      const aFinal = (1 / (a.index + 1)) + (alpha * normalizedScore(a.score));
      const bFinal = (1 / (b.index + 1)) + (alpha * normalizedScore(b.score));
      if (aFinal !== bFinal) return bFinal - aFinal;
      return a.index - b.index;
    });

    const cappedPages = new Array<PageItem | undefined>(rankedPages.length).fill(undefined);
    for (const item of rankedPages) {
      let target = Math.max(0, item.index - maxPromotion);
      const baselineTarget = pageItems[target];
      const promotes = target < item.index;
      if (promotes && target > maxPromotionTargetIndex) {
        target = item.index;
      }
      if (promotes && normalizedScore(item.score) - normalizedScore(baselineTarget?.score) < minPromotionScoreGap) {
        target = item.index;
      }
      if (
        promotes &&
        target < item.index &&
        minPromotionBaselineRatio > 0 &&
        item.baselineScore < (baselineTarget?.baselineScore ?? 0) * minPromotionBaselineRatio
      ) {
        target = item.index;
      }
      while (target < cappedPages.length && cappedPages[target] !== undefined) target += 1;
      if (target < cappedPages.length) cappedPages[target] = item;
    }

    const orderedPages = cappedPages.filter((item): item is PageItem => item !== undefined);
    const out: SelectedChunk[] = [];
    const maxChunksPerPage = Math.max(0, ...orderedPages.map((page) => page.chunks.length));
    for (let chunkIndex = 0; chunkIndex < maxChunksPerPage; chunkIndex++) {
      for (const page of orderedPages) {
        const chunk = page.chunks[chunkIndex];
        if (chunk) out.push(chunk);
      }
    }
    return out.slice(0, Math.max(0, limit));
  }

  const ranked: RankedRerankerItem[] = original
    .map((chunk, index) => ({ chunk, index, score: scoreById.get(rerankerChunkId(chunk)), finalScore: 0 }))
    .sort((a, b) => {
      const aScored = a.score !== undefined;
      const bScored = b.score !== undefined;

      if (mode === "full") {
        if (aScored && bScored) return (b.score! - a.score!) || (a.index - b.index);
        if (aScored) return -1;
        if (bScored) return 1;
        return a.index - b.index;
      }

      const aFinal = (1 / (a.index + 1)) + (alpha * normalizedScore(a.score));
      const bFinal = (1 / (b.index + 1)) + (alpha * normalizedScore(b.score));
      a.finalScore = aFinal;
      b.finalScore = bFinal;
      if (aFinal !== bFinal) return bFinal - aFinal;
      return a.index - b.index;
    });

  if (mode === "full") {
    return ranked.map((item) => item.chunk).slice(0, Math.max(0, limit));
  }

  const capped = new Array<RankedRerankerItem | undefined>(ranked.length).fill(undefined);
  for (const item of ranked) {
    let target = Math.max(0, item.index - maxPromotion);
    while (target < capped.length && capped[target] !== undefined) target += 1;
    if (target < capped.length) capped[target] = item;
  }
  return capped
    .filter((item): item is RankedRerankerItem => item !== undefined)
    .map((item) => item.chunk)
    .slice(0, Math.max(0, limit));
}

function fallbackResult(
  chunks: SelectedChunk[],
  started: number,
  contextLimit: number,
  candidates: number,
  fallbackReason: RerankerFallbackReason,
): RerankChunksResult {
  return {
    chunks: chunks.slice(0, contextLimit),
    durationMs: Date.now() - started,
    candidates,
    fallbackReason,
  };
}

function hasMalformedScores(scores: RerankerScore[]): boolean {
  return scores.length === 0
    || scores.some((score) => !score.id || !Number.isFinite(score.score));
}

export class RerankerMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankerMalformedResponseError";
  }
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "RerankerTimeoutError"
    || err.name === "TimeoutError"
    || (err.name === "AbortError" && err.message.toLowerCase().includes("timeout"));
}

function isMalformedResponseError(err: unknown): boolean {
  return err instanceof Error && err.name === "RerankerMalformedResponseError";
}

export async function rerankChunks(
  query: string,
  chunks: SelectedChunk[],
  options: RerankChunksOptions,
): Promise<RerankChunksResult> {
  const started = Date.now();
  const contextLimit = options.config.contextTopN;

  if (!options.config.enabled) {
    return fallbackResult(chunks, started, contextLimit, 0, "disabled");
  }
  if (!options.config.model) {
    return fallbackResult(chunks, started, contextLimit, 0, "missing-model");
  }

  const candidates = buildRerankerCandidates(query, chunks, options.config);
  if (candidates.length === 0) {
    return {
      chunks: [],
      durationMs: Date.now() - started,
      candidates: 0,
      fallbackReason: "empty-candidates",
    };
  }

  try {
    const transport = options.transport ?? fetchRerankerScores;
    const scores = await transport({
      query,
      candidates,
      config: options.config,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      signal: options.signal,
    });

    if (hasMalformedScores(scores)) {
      return fallbackResult(chunks, started, contextLimit, candidates.length, "malformed-response");
    }

    return {
      chunks: applyRerankerScores(chunks, scores, contextLimit),
      durationMs: Date.now() - started,
      candidates: candidates.length,
      scores,
    };
  } catch (err) {
    return fallbackResult(
      chunks,
      started,
      contextLimit,
      candidates.length,
      isTimeoutError(err)
        ? "timeout"
        : isMalformedResponseError(err)
          ? "malformed-response"
          : "error",
    );
  }
}

function malformed(message: string): RerankerMalformedResponseError {
  return new RerankerMalformedResponseError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRerankerResponseText(
  text: string,
  candidates: RerankerCandidate[],
): RerankerScore[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw malformed(err instanceof Error ? err.message : "Invalid JSON");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw malformed("Reranker response must contain a results array");
  }

  return parsed.results.map((item): RerankerScore => {
    if (!isRecord(item)) {
      throw malformed("Reranker result item must be an object");
    }

    const index = item.index;
    const score = typeof item.relevance_score === "number"
      ? item.relevance_score
      : item.score;

    if (
      typeof index !== "number"
      || !Number.isInteger(index)
      || index < 0
      || index >= candidates.length
      || typeof score !== "number"
      || !Number.isFinite(score)
    ) {
      throw malformed("Reranker result item has invalid index or score");
    }

    return { id: candidates[index].id, score };
  });
}

export async function raceRerankerRequest<T>(
  request: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException("Reranker aborted", "AbortError");
  }

  let timeoutId: number | undefined;
  let abortHandler: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new DOMException("Reranker timeout", "AbortError"));
    }, timeoutMs);
  });
  const abort = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new DOMException("Reranker aborted", "AbortError"));
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });

  try {
    return await Promise.race([request, timeout, abort]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

export const fetchRerankerScores: RerankerTransport = async (input) => {
  const { requestUrl } = await import("obsidian");

  // requestUrl itself is not cancellable; this race only bounds adapter wait time.
  const response = await raceRerankerRequest(
    requestUrl({
      url: `${input.baseUrl.replace(/\/$/, "")}/rerank`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.config.model,
        query: input.query,
        documents: input.candidates.map((candidate) => candidate.text),
      }),
      throw: true,
    }),
    input.signal,
    input.config.timeoutMs,
  );

  return parseRerankerResponseText(response.text, input.candidates);
};

/**
 * Verify the reranker model is reachable by scoring a single trivial pair.
 * Returns { ok:true } on a valid non-empty score list, else { ok:false, error }.
 * The transport is injectable for testing (defaults to the live HTTP transport).
 */
export async function probeRerankerModel(
  baseUrl: string,
  apiKey: string,
  config: RerankerConfig,
  transport: RerankerTransport = fetchRerankerScores,
): Promise<{ ok: boolean; error?: string }> {
  const candidates = [{ id: "probe", text: "ping" }] as unknown as RerankerCandidate[];
  try {
    const scores = await transport({
      query: "ping",
      candidates,
      config,
      baseUrl,
      apiKey,
      signal: new AbortController().signal,
    });
    if (!Array.isArray(scores) || scores.length === 0) {
      return { ok: false, error: "empty or malformed rerank response" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
