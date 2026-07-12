import { rrf } from "./rrf";

const STOP_WORDS = new Set([
  // EN
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  // RU
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще", "какие",
  "какой", "какая", "какое", "где", "через",
]);

const PAGE_LEAD_CAP = 500;
const PAGE_LONG_TEXT = 1500;
const CHUNK_LONG_TEXT = 1200;
const MAX_PAGE_SCORE = 6.45;

export interface LexicalEvidence {
  path: number;
  title: number;
  heading: number;
  description: number;
  body: number;
  exact: number;
  phrase: number;
  lengthPenalty: number;
}

export interface LexicalScore {
  score: number;
  evidence: LexicalEvidence;
}

export interface LexicalPageInput {
  id: string;
  path?: string;
  title?: string;
  description?: string;
  content?: string;
  annotation?: string;
}

export interface LexicalChunkInput {
  articleId: string;
  path: string;
  heading?: string;
  body?: string;
  embedText?: string;
  ordinal?: number;
}

export interface RankedLexicalPage {
  id: string;
  path?: string;
  score: number;
  evidence: LexicalEvidence;
}

export interface RankedLexicalChunk {
  articleId: string;
  path: string;
  heading?: string;
  body?: string;
  ordinal?: number;
  score: number;
  evidence: LexicalEvidence;
}

export interface FusedLexicalRank {
  id: string;
  score: number;
}

export function tokenizeLexical(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const raw of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2 && !/[a-zа-я]\d|\d[a-zа-я]/iu.test(raw)) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function emptyEvidence(lengthPenalty = 1): LexicalEvidence {
  return {
    path: 0,
    title: 0,
    heading: 0,
    description: 0,
    body: 0,
    exact: 0,
    phrase: 0,
    lengthPenalty,
  };
}

function stripFrontmatterAndTitle(content: string): string {
  const noFm = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();
  return noFm.replace(/^#\s+[^\n]*\n?/, "");
}

function coverage(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0;
  const tokens = tokenizeLexical(text);
  if (tokens.size === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) if (tokens.has(token)) hits++;
  return hits / queryTokens.size;
}

function exactHitRatio(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0 || !text) return 0;
  const tokens = tokenizeLexical(text);
  let hits = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) hits++;
  }
  return Math.min(hits, queryTokens.size) / queryTokens.size;
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function orderedTokens(queryTokens: Set<string>, text: string): string[] {
  const textTokens = tokenizeLexical(text);
  return [...queryTokens].filter((token) => textTokens.has(token));
}

function phraseAdjacentBonus(queryTokens: Set<string>, text: string): number {
  const matched = orderedTokens(queryTokens, text);
  if (matched.length < 2) return 0;
  const lowered = text.toLowerCase();
  for (let i = 0; i < matched.length - 1; i++) {
    const a = matched[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const b = matched[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`${a}[^\\p{L}\\p{N}]+${b}`, "u").test(lowered)) return 1;
  }
  return Math.min(0.75, matched.length / queryTokens.size);
}

function longTextPenalty(text: string, threshold: number, floor: number): number {
  if (text.length <= threshold) return 1;
  return Math.max(floor, threshold / text.length);
}

export function scoreLexicalPage(queryTokens: Set<string>, input: LexicalPageInput): LexicalScore {
  const description = [input.description, input.annotation].filter(Boolean).join("\n");
  const body = input.content ? stripFrontmatterAndTitle(input.content).slice(0, PAGE_LEAD_CAP) : "";
  const title = input.title ?? input.id;
  const path = input.path ?? input.id;
  const fullText = [path, title, description, body].join("\n");
  const evidence = emptyEvidence(longTextPenalty(description, PAGE_LONG_TEXT, 0.55));
  if (queryTokens.size === 0) return { score: 0, evidence };

  evidence.path = coverage(queryTokens, path) * 2.2;
  evidence.title = coverage(queryTokens, title) * 2.0;
  evidence.description = coverage(queryTokens, description) * 1.0;
  evidence.body = coverage(queryTokens, body) * 0.6;
  evidence.exact = exactHitRatio(queryTokens, fullText) * 0.4;
  evidence.phrase = phraseAdjacentBonus(queryTokens, fullText) * 0.25;

  const raw = evidence.path + evidence.title + evidence.description + evidence.body + evidence.exact + evidence.phrase;
  const score = raw * evidence.lengthPenalty;
  return { score, evidence };
}

export function scoreLexicalChunk(queryTokens: Set<string>, input: LexicalChunkInput): LexicalScore {
  const heading = input.heading ?? "";
  const body = input.body ?? input.embedText ?? "";
  const fullText = [input.path, heading, body].join("\n");
  const evidence = emptyEvidence(longTextPenalty(body, CHUNK_LONG_TEXT, 0.5));
  if (queryTokens.size === 0 || body.trim().length === 0) return { score: 0, evidence };

  evidence.path = coverage(queryTokens, input.path) * 1.5;
  evidence.heading = coverage(queryTokens, heading) * 2.3;
  evidence.body = coverage(queryTokens, body) * 1.0;
  evidence.exact = exactHitRatio(queryTokens, fullText) * 0.35;
  evidence.phrase = phraseAdjacentBonus(queryTokens, fullText) * 0.25;

  const raw = evidence.path + evidence.heading + evidence.body + evidence.exact + evidence.phrase;
  const score = raw * evidence.lengthPenalty;
  return { score, evidence };
}

export function rankLexicalPages(
  queryTokens: Set<string>,
  pages: LexicalPageInput[],
  limit: number,
): RankedLexicalPage[] {
  if (queryTokens.size === 0 || limit <= 0) return [];
  return pages
    .map((page) => ({ ...page, ...scoreLexicalPage(queryTokens, page) }))
    .filter((page) => page.score > 0)
    .sort((a, b) => (b.score - a.score) || compareStable(a.id, b.id) || compareStable(a.path ?? "", b.path ?? ""))
    .slice(0, limit)
    .map((page) => ({ id: page.id, path: page.path, score: page.score, evidence: page.evidence }));
}

export function rankLexicalChunks(
  queryTokens: Set<string>,
  chunks: LexicalChunkInput[],
  limit: number,
): RankedLexicalChunk[] {
  if (queryTokens.size === 0 || limit <= 0) return [];
  return chunks
    .map((chunk) => ({ ...chunk, ...scoreLexicalChunk(queryTokens, chunk) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) =>
      (b.score - a.score) ||
      compareStable(a.articleId, b.articleId) ||
      compareStable(a.path, b.path) ||
      ((a.ordinal ?? 0) - (b.ordinal ?? 0)) ||
      compareStable(a.heading ?? "", b.heading ?? "")
    )
    .slice(0, limit)
    .map((chunk) => ({
      articleId: chunk.articleId,
      path: chunk.path,
      heading: chunk.heading,
      body: chunk.body,
      ordinal: chunk.ordinal,
      score: chunk.score,
      evidence: chunk.evidence,
    }));
}

export function fuseLexicalRanks(
  pageRank: Array<{ id: string; score: number }>,
  chunkRank: Array<{ articleId: string; score: number }>,
  limit: number,
  rrfK = 60,
  extraRankedLists: string[][] = [],
): FusedLexicalRank[] {
  if (limit <= 0) return [];
  return rrf([
    uniqueIds(pageRank.map((page) => page.id)),
    uniqueIds(chunkRank.map((chunk) => chunk.articleId)),
    ...extraRankedLists.map(uniqueIds),
  ], rrfK)
    .slice(0, limit);
}

export function normalizeLexicalPageScore(score: number): number {
  return Math.max(0, Math.min(1, score / MAX_PAGE_SCORE));
}
