import { tokenize, scoreSeed } from "./wiki-seeds";
import { scoreLexicalChunk } from "./lexical-retrieval";
import { demoteBoilerplateRankedItems } from "./boilerplate-demotion";
import type { BoilerplateDemotionConfig } from "./boilerplate-demotion";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";
import { domainIndexPath, legacyDomainEmbeddingsPath } from "./wiki-path";
import {
  embeddingChunkToChunkRecord,
  isChunkIndexRecord,
  isPageIndexRecord,
  type WikiIndexRecord,
} from "./wiki-index-jsonl";
import { readWikiIndexRecords, transformWikiIndexRecords } from "./wiki-index-store";
import { rrf } from "./rrf";
import type { SeedDiag } from "./retrieval-diag";

export interface ChunkingConfig {
  maxChars: number;
  overlapChars: number;
  minChars: number;
  maxCount: number;
}

export const DEFAULT_CHUNKING: ChunkingConfig = {
  maxChars: 1200,
  overlapChars: 200,
  minChars: 200,
  maxCount: 12,
};

export interface SimilarityConfig {
  mode: "jaccard" | "embedding" | "hybrid";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
  chunking?: ChunkingConfig;
  rrfK?: number;
  boilerplateDemotion?: BoilerplateDemotionConfig;
}

export interface EmbeddingChunk {
  vector: string;  // base64 Float32Array
  hash: string;
  kind: "summary" | "section";
  heading?: string;
  ordinal?: number;
}

export interface EmbeddingCacheEntry {
  chunks: EmbeddingChunk[];
}

export interface EmbeddingCacheFile {
  version: 3;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function encodeVector(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function decodeVector(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function vectorToNumbers(b64: string): number[] {
  return [...decodeVector(b64)];
}

function numbersToVector(values: number[]): string {
  return encodeVector(new Float32Array(values));
}

function fallbackChunkPath(domainRoot: string, pid: string): string {
  return `${domainRoot}/${pid}.md`;
}

function cacheFromIndexRecords(
  records: WikiIndexRecord[],
  model: string,
  dimensions: number,
): EmbeddingCacheFile {
  const entries: Record<string, EmbeddingCacheEntry> = {};
  for (const record of records) {
    if (!isChunkIndexRecord(record)) continue;
    if (record.vectorModel !== model || record.dimensions !== dimensions) continue;
    const chunk: EmbeddingChunk = {
      vector: numbersToVector(record.vector),
      hash: record.embedTextHash,
      kind: record.ordinal === 0 && record.heading === "" ? "summary" : "section",
      heading: record.heading,
      ordinal: record.ordinal,
    };
    (entries[record.articleId] ??= { chunks: [] }).chunks.push(chunk);
  }
  return { version: 3, model, dimensions, entries };
}

function replaceChunkRecordsFromCache(
  cacheFile: EmbeddingCacheFile,
  domainRoot: string,
  existingRecords: WikiIndexRecord[],
  articleIds: Set<string>,
): WikiIndexRecord[] {
  const preserved = existingRecords.filter((record) =>
    !isChunkIndexRecord(record) || !articleIds.has(record.articleId));
  const pagePaths = new Map(
    existingRecords.filter(isPageIndexRecord).map((record) => [record.articleId, record.path]),
  );
  const now = new Date().toISOString();
  const chunkRecords: WikiIndexRecord[] = [];
  for (const pid of articleIds) {
    const entry = cacheFile.entries[pid];
    if (!entry) continue;
    for (const chunk of entry.chunks) {
      if (!chunk.vector) continue;
      chunkRecords.push(embeddingChunkToChunkRecord({
        articleId: pid,
        path: pagePaths.get(pid) ?? fallbackChunkPath(domainRoot, pid),
        heading: chunk.heading ?? "",
        ordinal: chunk.ordinal ?? 0,
        bodyHash: chunk.hash,
        embedTextHash: chunk.hash,
        vector: vectorToNumbers(chunk.vector),
        vectorModel: cacheFile.model,
        dimensions: cacheFile.dimensions,
        updatedAt: now,
      }));
    }
  }
  return [...preserved, ...chunkRecords];
}

function summaryVectors(entry: EmbeddingCacheEntry | undefined): Float32Array[] | undefined {
  if (!entry) return undefined;
  return entry.chunks
    .filter((chunk) => chunk.kind === "summary" && chunk.vector !== "")
    .map((chunk) => decodeVector(chunk.vector));
}

function annotationHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export interface SectionWindow { heading: string; window: string; }

function stripFrontmatterAndTitle(body: string): string {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();
  // drop a single leading "# H1" title line
  return noFm.replace(/^#\s+[^\n]*\n?/, "");
}

interface RawUnit { heading: string; body: string; }

function toUnits(text: string): RawUnit[] {
  const lines = text.split("\n");
  const units: RawUnit[] = [];
  let cur: RawUnit | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {                 // new H2 — H3+ stays inside the current unit
      if (cur) units.push(cur);
      cur = { heading: line.trim(), body: "" };
    } else if (!cur) {
      // lead text before the first H2 — its own headless unit
      cur = { heading: "", body: line + "\n" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur) units.push(cur);
  // drop units that are entirely whitespace
  return units
    .map((u) => ({ heading: u.heading, body: u.body.trim() }))
    .filter((u) => u.heading.length > 0 || u.body.length > 0);
}

function unitLen(u: RawUnit): number { return u.heading.length + u.body.length; }

function mergeShort(units: RawUnit[], minChars: number): RawUnit[] {
  const out: RawUnit[] = [];
  for (const u of units) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    // Only merge a short unit into the previous one when prev is a headed section
    // that is itself long enough (>= minChars). This prevents two consecutive short
    // sections from collapsing into a single unit and losing both H2 labels.
    if (unitLen(u) < minChars && prev !== null && prev.heading.length > 0 && unitLen(prev) >= minChars) {
      prev.body = `${prev.body}\n\n${u.heading} ${u.body}`.trim();
    } else {
      out.push({ heading: u.heading, body: u.body });
    }
  }
  return out;
}

function windowUnit(u: RawUnit, maxChars: number, overlapChars: number): SectionWindow[] {
  const text = u.body;
  if (text.length <= maxChars) return [{ heading: u.heading, window: text }];
  const windows: SectionWindow[] = [];
  const step = Math.max(1, maxChars - overlapChars);
  for (let i = 0; i < text.length; i += step) {
    windows.push({ heading: u.heading, window: text.slice(i, i + maxChars) });
    if (i + maxChars >= text.length) break;
  }
  return windows;
}

// Body sections holding relocated frontmatter links (see migrate-okf-frontmatter.ts's
// `relocateFrontmatterLinks`) — pure reference data, never worth embedding for
// retrieval. Headings are fixed English literals across all output languages (they
// mirror the literal `## Related` / `## External links` strings that migration and
// ingest write), matched case-insensitively.
const EXCLUDED_SECTION_HEADINGS = new Set(["## related", "## external links"]);

export function splitSections(body: string, chunking: ChunkingConfig): SectionWindow[] {
  const stripped = stripFrontmatterAndTitle(body).trim();
  if (!stripped) return [];
  const units = toUnits(stripped).filter((u) => !EXCLUDED_SECTION_HEADINGS.has(u.heading.toLowerCase()));
  const merged = mergeShort(units, chunking.minChars);
  let windows: SectionWindow[] = [];
  for (const u of merged) {
    windows.push(...windowUnit(u, chunking.maxChars, chunking.overlapChars));
  }
  if (windows.length === 0) return [];
  if (windows.length > chunking.maxCount) {
    const kept = windows.slice(0, chunking.maxCount - 1);
    const foldedCount = windows.length - kept.length;
    const foldedBody = windows
      .slice(chunking.maxCount - 1)
      .map((w) => `${w.heading} ${w.window}`)
      .join("\n\n")
      .slice(0, chunking.maxChars);
    kept.push({ heading: `## (+${foldedCount} sections folded)`, window: foldedBody });
    windows = kept;
  }
  return windows;
}

export interface ChunkInput {
  kind: "summary" | "section";
  embedText: string;
  hash: string;
  heading?: string;
  window?: string;
  ordinal?: number;
}

export interface SelectedChunk {
  articleId: string;
  path: string;
  heading: string;
  body: string;
  score: number;
  source: "seed" | "graph";
  articleScore?: number;
  ordinal: number;
}

interface CandidateSection {
  articleId: string;
  path: string;
  heading: string;
  body: string;
  embedText: string;
  hash: string;
  source: "seed" | "graph";
  articleScore?: number;
  ordinal: number;
}

export function buildChunkInputs(
  annotation: string,
  body: string,
  chunking: ChunkingConfig,
): ChunkInput[] {
  const inputs: ChunkInput[] = [
    { kind: "summary", embedText: annotation, hash: annotationHash(`summary\n${annotation}`), ordinal: 0 },
  ];
  splitSections(body, chunking).forEach(({ heading, window }, ordinal) => {
    const embedText = `${heading}\n${window}`.trim();
    inputs.push({
      kind: "section",
      embedText,
      hash: annotationHash(`section\n${ordinal}\n${embedText}`),
      heading,
      window,
      ordinal: ordinal + 1,
    });
  });
  return inputs;
}

function sameChunkSet(left: EmbeddingChunk[], right: EmbeddingChunk[]): boolean {
  return left.length === right.length && left.every((chunk, index) => {
    const other = right[index];
    return other !== undefined &&
      chunk.hash === other.hash &&
      chunk.kind === other.kind &&
      (chunk.heading ?? "") === (other.heading ?? "") &&
      chunk.ordinal === other.ordinal;
  });
}

function collectCandidateSections(
  pages: Map<string, string>,
  candidateIds: Set<string>,
  seedIds: Set<string>,
  articleScores: Record<string, number>,
  chunking: ChunkingConfig,
): CandidateSection[] {
  const sections: CandidateSection[] = [];
  for (const [path, content] of pages) {
    const articleId = pageId(path);
    if (!candidateIds.has(articleId)) continue;
    splitSections(content, chunking).forEach(({ heading, window }, ordinal) => {
      const embedText = `${heading}\n${window}`.trim();
      if (!embedText) return;
      sections.push({
        articleId,
        path,
        heading,
        body: window,
        embedText,
        hash: annotationHash(`section\n${ordinal}\n${embedText}`),
        source: seedIds.has(articleId) ? "seed" : "graph",
        articleScore: articleScores[articleId],
        ordinal,
      });
    });
  }
  return sections;
}

function sortSelectedChunks(items: SelectedChunk[]): SelectedChunk[] {
  return items.sort((a, b) =>
    (b.score - a.score) ||
    (Number(b.source === "seed") - Number(a.source === "seed")) ||
    ((b.articleScore ?? 0) - (a.articleScore ?? 0)) ||
    a.articleId.localeCompare(b.articleId) ||
    (a.ordinal - b.ordinal) ||
    a.path.localeCompare(b.path) ||
    a.heading.localeCompare(b.heading)
  );
}

function demoteScoredPaths<T extends { path: string; score: number }>(
  scored: T[],
  boilerplateDemotion: BoilerplateDemotionConfig | undefined,
  limit: number,
): T[] {
  return demoteBoilerplateRankedItems(
    scored,
    boilerplateDemotion ?? { enabled: false, factor: 0 },
    limit,
  );
}

function rankChunksJaccard(
  queryTokens: Set<string>,
  sections: CandidateSection[],
  limit: number,
  boilerplateDemotion?: BoilerplateDemotionConfig,
): SelectedChunk[] {
  const scored: SelectedChunk[] = [];
  for (const section of sections) {
    const score = scoreLexicalChunk(queryTokens, {
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      embedText: section.embedText,
      ordinal: section.ordinal,
    }).score;
    if (score <= 0) continue;
    scored.push({
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      score,
      source: section.source,
      articleScore: section.articleScore,
      ordinal: section.ordinal,
    });
  }
  return demoteBoilerplateRankedItems(
    sortSelectedChunks(scored),
    boilerplateDemotion ?? { enabled: false, factor: 0 },
    limit,
  );
}

function isUsableVector(vec: Float32Array | undefined, dimensions?: number): vec is Float32Array {
  if (!vec || vec.length === 0 || (dimensions && vec.length !== dimensions)) return false;
  for (const value of vec) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function jaccardCoeff(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Page score = best cosine across the page's chunk vectors. Floors at 0: a page whose
// chunks are all orthogonal/antipodal to the query scores 0 and is dropped by the
// caller's `score > 0` filter — matching the old single-vector behaviour.
export function maxCosine(query: Float32Array, vecs: Float32Array[]): number {
  let best = 0;
  for (const v of vecs) {
    if (v.length === 0) continue;
    const c = cosine(query, v);
    if (c > best) best = c;
  }
  return best;
}

const EMBEDDING_BATCH_SIZE = 100;

// Per-side candidate pool before RRF fusion in hybrid mode. Fixed (not the full
// vault) so cost stays flat; RRF then returns the caller's topK.
const RRF_CANDIDATE_POOL = 50;

export function buildEmbeddingRequestBody(
  model: string,
  inputs: string[],
  dimensions?: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input: inputs };
  if (dimensions && dimensions > 0) body.dimensions = dimensions;
  return body;
}

async function fetchEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
  dimensions?: number,
): Promise<Float32Array[]> {
  const { requestUrl } = await import("./request-url");
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  // Send `dimensions` (OpenAI-standard MRL truncation) when configured, so the whole
  // pipeline and the probe agree on the requested size. Models that don't support it
  // either ignore the field (return native size) or error — the probe surfaces which.
  const body = buildEmbeddingRequestBody(model, inputs, dimensions);
  const resp = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    throw: false,
  });
  if (resp.status >= 400) {
    const detail = resp.text ? ` — ${resp.text.slice(0, 200)}` : "";
    throw new Error(`Embedding API error: ${resp.status}${detail}`);
  }
  const json = JSON.parse(resp.text) as { data: { embedding: number[] }[] };
  return json.data.map((d) => new Float32Array(d.embedding));
}

export interface DimensionProbe {
  /** Vector length the model actually returned. */
  actual: number;
  /** The dimension we asked for (the configured value), if any. */
  requested?: number;
  /** True when a `requested` size was sent and the model honored it exactly. */
  honored: boolean;
}

/**
 * Probe an embedding model by embedding a single tiny input and reading the returned
 * vector length. When `requested` is given it is sent as the `dimensions` field so the
 * model can either honor it (MRL truncation) or ignore it (returns its native size) —
 * the caller compares `actual` vs `requested` to tell the user whether their configured
 * value is valid. Returns a result object; on success, `probe` is set; on any
 * HTTP/parse failure, `error` is set (the "или ошибка" case).
 */
export async function probeEmbeddingDimensionsResult(
  baseUrl: string,
  apiKey: string,
  model: string,
  requested?: number,
): Promise<{ probe?: DimensionProbe; error?: string }> {
  try {
    const [vec] = await fetchEmbeddings(baseUrl, apiKey, model, ["ping"], requested);
    if (!vec || vec.length === 0) return { error: "empty embedding response" };
    return {
      probe: {
        actual: vec.length,
        requested: requested && requested > 0 ? requested : undefined,
        honored: !requested || requested <= 0 || vec.length === requested,
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function probeEmbeddingDimensions(
  baseUrl: string,
  apiKey: string,
  model: string,
  requested?: number,
): Promise<DimensionProbe | null> {
  return (await probeEmbeddingDimensionsResult(baseUrl, apiKey, model, requested)).probe ?? null;
}

export interface ExtractedEntity {
  name: string;
  type?: string;
  context_snippet?: string;
}

export interface EntityRetrievalResult {
  results: Map<string, string[]>;
  allFailed: boolean;
  failReason?: string;
}

function entityKey(e: { name: string; type?: string }): string {
  return `${e.name}::${e.type ?? ""}`;
}

function entityQuery(e: ExtractedEntity): string {
  return [e.name, e.type, e.context_snippet].filter(Boolean).join(" — ");
}

interface Pending { pid: string; idx: number; embedText: string; }

export class PageSimilarityService {
  private cache: EmbeddingCacheFile | null = null;

  constructor(readonly config: SimilarityConfig) {}

  // Corpus for jaccard-mode dedup scoring (pid -> annotation). Set by the caller
  // (Ingest) which already holds the index annotations; also settable in tests.
  private jaccardCorpus: Map<string, string> = new Map();
  setJaccardCorpus(corpus: Map<string, string>): void { this.jaccardCorpus = corpus; }

  setCacheForTest(cache: EmbeddingCacheFile): void { this.cache = cache; }

  withBoilerplateDemotion(boilerplateDemotion?: BoilerplateDemotionConfig): PageSimilarityService {
    const service = new PageSimilarityService({ ...this.config, boilerplateDemotion });
    service.cache = this.cache;
    service.jaccardCorpus = new Map(this.jaccardCorpus);
    return service;
  }

  async selectRelevantChunks(
    query: string,
    pages: Map<string, string>,
    candidateIds: Set<string>,
    seedIds: Set<string>,
    articleScores: Record<string, number>,
    limit: number,
  ): Promise<SelectedChunk[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0 || candidateIds.size === 0 || limit <= 0) return [];
    const chunking = this.config.chunking ?? DEFAULT_CHUNKING;
    const sections = collectCandidateSections(pages, candidateIds, seedIds, articleScores, chunking);
    if (sections.length === 0) return [];
    if (this.config.mode === "jaccard") return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);

    const { baseUrl, apiKey, model } = this.config;
    if (!baseUrl || !model) return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);

    let queryVec: Float32Array;
    try {
      const vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, [query.slice(0, 2000)], this.config.dimensions);
      if (!isUsableVector(vecs[0], this.config.dimensions)) return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);
      queryVec = vecs[0];
    } catch {
      return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);
    }

    const vectors = new Map<string, Float32Array>();
    if (this.cache && this.cache.model === model && this.cache.dimensions === this.config.dimensions) {
      for (const section of sections) {
        const entry = this.cache.entries[section.articleId];
        const cached = entry?.chunks.find((chunk) => chunk.kind === "section" && chunk.hash === section.hash && chunk.vector);
        if (!cached) continue;
        try {
          const vec = decodeVector(cached.vector);
          if (isUsableVector(vec, this.config.dimensions)) vectors.set(section.hash, vec);
        } catch {
          // Treat corrupt cache entries as misses; the live embedding path can refill them.
        }
      }
    }

    const missing = sections.filter((section) => !vectors.has(section.hash));
    for (let i = 0; i < missing.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = missing.slice(i, i + EMBEDDING_BATCH_SIZE);
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, batch.map((section) => section.embedText), this.config.dimensions);
        if (vecs.length !== batch.length || vecs.some((vec) => !isUsableVector(vec, this.config.dimensions))) {
          return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);
        }
        for (let j = 0; j < batch.length; j++) {
          vectors.set(batch[j].hash, vecs[j]);
        }
      } catch {
        return rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion);
      }
    }

    const scored: SelectedChunk[] = [];
    for (const section of sections) {
      const vec = vectors.get(section.hash);
      if (!vec) continue;
      const score = maxCosine(queryVec, [vec]);
      if (score <= 0) continue;
      scored.push({
        articleId: section.articleId,
        path: section.path,
        heading: section.heading,
        body: section.body,
        score,
        source: section.source,
        articleScore: section.articleScore,
        ordinal: section.ordinal,
      });
    }
    return demoteScoredPaths(sortSelectedChunks(scored), this.config.boilerplateDemotion, limit);
  }

  /**
   * All unordered page pairs whose max-pool cosine ≥ threshold. Embedding-only (uses the
   * loaded cache). Skips entirely when the page count exceeds maxPages (cost guard);
   * the caller logs skippedPageCount.
   */
  pairwiseNearDuplicates(
    threshold: number,
    maxPages: number,
  ): { pairs: { a: string; b: string; score: number }[]; skippedPageCount: number } {
    if (!this.cache) return { pairs: [], skippedPageCount: 0 };
    const pids = Object.keys(this.cache.entries);
    if (pids.length > maxPages) return { pairs: [], skippedPageCount: pids.length };
    const vecs = new Map<string, Float32Array[]>(
      pids.map((pid) => [pid, this.cache!.entries[pid].chunks.map((c) => decodeVector(c.vector))]),
    );
    const pairs: { a: string; b: string; score: number }[] = [];
    for (let i = 0; i < pids.length; i++) {
      for (let j = i + 1; j < pids.length; j++) {
        const va = vecs.get(pids[i])!, vb = vecs.get(pids[j])!;
        let best = 0;
        for (const x of va) for (const y of vb) { const c = cosine(x, y); if (c > best) best = c; }
        if (best >= threshold) pairs.push({ a: pids[i], b: pids[j], score: best });
      }
    }
    pairs.sort((p, q) => q.score - p.score);
    return { pairs, skippedPageCount: 0 };
  }

  /**
   * Max similarity of `candidateText` to any existing page, excluding `excludePids`.
   * embedding/hybrid: max-pool cosine over the loaded cache. jaccard: Jaccard coefficient
   * over the supplied corpus. Returns { pid:"", score:0 } when nothing scores or on embed failure.
   */
  async maxSimilarityToExisting(
    candidateText: string,
    excludePids: Set<string>,
  ): Promise<{ pid: string; score: number }> {
    if (this.config.mode === "jaccard") {
      const cand = tokenize(candidateText);
      let best = { pid: "", score: 0 };
      for (const [pid, annotation] of this.jaccardCorpus) {
        if (excludePids.has(pid)) continue;
        const score = jaccardCoeff(cand, tokenize(annotation));
        if (score > best.score) best = { pid, score };
      }
      return best;
    }
    // embedding / hybrid
    const { baseUrl, apiKey, model } = this.config;
    if (!this.cache || !baseUrl || !model) return { pid: "", score: 0 };
    let candVec: Float32Array;
    try {
      [candVec] = await fetchEmbeddings(baseUrl, apiKey ?? "", model, [candidateText.slice(0, 2000)], this.config.dimensions);
    } catch {
      return { pid: "", score: 0 }; // never fire the gate on a failed signal
    }
    let best = { pid: "", score: 0 };
    for (const [pid, entry] of Object.entries(this.cache.entries)) {
      if (excludePids.has(pid)) continue;
      const vecs = entry.chunks.map((c) => decodeVector(c.vector));
      const score = maxCosine(candVec, vecs);
      if (score > best.score) best = { pid, score };
    }
    return best;
  }

  async selectRelevant(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<string[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    if (this.config.mode === "jaccard") {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }
    if (this.config.mode === "hybrid") {
      return (await this.selectHybridScored(sourceContent, indexAnnotations, allPaths, queryTokens))
        .map((x) => x.path);
    }
    return this.selectEmbedding(sourceContent, indexAnnotations, allPaths, queryTokens);
  }

  async selectRelevantScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<{ path: string; score: number }[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    if (this.config.mode === "jaccard") {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }
    if (this.config.mode === "hybrid") {
      return this.selectHybridScored(sourceContent, indexAnnotations, allPaths, queryTokens);
    }
    return this.selectEmbeddingScored(sourceContent, indexAnnotations, allPaths, queryTokens);
  }

  async selectByEntities(
    entities: ExtractedEntity[],
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<EntityRetrievalResult> {
    if (entities.length === 0) return { results: new Map<string, string[]>(), allFailed: false };

    if (this.config.mode === "jaccard") {
      return this.jaccardFallbackAll(entities, indexAnnotations, allPaths);
    }

    return this.selectByEntitiesEmbedding(entities, indexAnnotations, allPaths);
  }

  private scoreJaccardOnce(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): string[] {
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
    return demoteScoredPaths(scored, this.config.boilerplateDemotion, this.config.topK).map((x) => x.path);
  }

  private jaccardFallbackAll(
    entities: ExtractedEntity[],
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): EntityRetrievalResult {
    const results = new Map<string, string[]>();
    for (const e of entities) {
      results.set(entityKey(e), this.scoreJaccardOnce(tokenize(entityQuery(e)), indexAnnotations, allPaths));
    }
    // Local scoring cannot fail; an empty result just means "no related pages".
    return { results, allFailed: false };
  }

  private async selectByEntitiesEmbedding(
    entities: ExtractedEntity[],
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<EntityRetrievalResult> {
    const { baseUrl, apiKey, model, topK } = this.config;
    const results = new Map<string, string[]>();

    if (!baseUrl || !model || !apiKey) {
      return this.jaccardFallbackAll(entities, indexAnnotations, allPaths);
    }

    let entityVecs: Float32Array[];
    try {
      entityVecs = await fetchEmbeddings(baseUrl, apiKey, model, entities.map(entityQuery), this.config.dimensions);
    } catch (e) {
      // Embeddings are configured but the endpoint failed for the whole entity
      // set — a genuine infrastructure failure. Degrade to jaccard for results,
      // but signal the failure so ingest can abort with a clear message.
      return { ...this.jaccardFallbackAll(entities, indexAnnotations, allPaths), allFailed: true, failReason: (e as Error).message };
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array[]>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const vecs = summaryVectors(this.cache.entries[pids[i]]);
        if (vecs !== undefined) pageVecs.set(pids[i], vecs);
      }
    }

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i]) continue;
      if (pageVecs.has(pids[i])) continue;
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) {
        batches.push(cur);
        cur = { pids: [], texts: [] };
      }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts, this.config.dimensions);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], [vecs[i]]);
      } catch {
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], []);
      }
    }

    for (let ei = 0; ei < entities.length; ei++) {
      const e = entities[ei];
      const queryVec = entityVecs[ei];
      const queryTokens = tokenize(entityQuery(e));
      const scored: { path: string; score: number }[] = [];
      for (let pi = 0; pi < allPaths.length; pi++) {
        const pid = pids[pi];
        const vecs = pageVecs.get(pid);
        if (!vecs) continue;
        const score = vecs.length === 0
          ? scoreSeed(queryTokens, pid, "", annotations[pi])
          : maxCosine(queryVec, vecs);
        if (score > 0) scored.push({ path: allPaths[pi], score });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, topK).map((x) => x.path);
      results.set(entityKey(e), top);
    }

    // Reaching here means entity vectors were fetched successfully; empty
    // per-entity results are normal, not a failure.
    return { results, allFailed: false };
  }

  private selectJaccard(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): string[] {
    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return demoteScoredPaths(scored, this.config.boilerplateDemotion, this.config.topK).map((x) => x.path);
  }

  private async selectEmbedding(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<string[]> {
    const { baseUrl, apiKey, model, topK } = this.config;
    if (!baseUrl || !model) {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }

    // Query vector
    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey ?? "", model, [truncated], this.config.dimensions);
    } catch {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }

    // Page vectors — process in batches
    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array[]>();

    // Load chunk vectors from in-memory cache (populated by refreshCache)
    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const vecs = summaryVectors(this.cache.entries[pids[i]]);
        if (vecs !== undefined) pageVecs.set(pids[i], vecs);
      }
    }

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i]) continue;
      if (pageVecs.has(pids[i])) continue;  // already have from cache
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) {
        batches.push(cur);
        cur = { pids: [], texts: [] };
      }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, batch.texts, this.config.dimensions);
      } catch {
        // Fallback: mark this batch's pages for Jaccard (empty vector list)
        for (const pid of batch.pids) {
          const annotation = indexAnnotations.get(pid) ?? "";
          const score = scoreSeed(queryTokens, pid, "", annotation);
          if (score > 0) pageVecs.set(pid, []);
        }
        continue;
      }
      for (let i = 0; i < batch.pids.length; i++) {
        pageVecs.set(batch.pids[i], [vecs[i]]);
      }
    }

    // Score by raw similarity. Dense ranking is not boilerplate-demoted.
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vecs = pageVecs.get(pid);
      if (!vecs) continue;
      const score = vecs.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[i])
        : maxCosine(queryVec, vecs);
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((x) => x.path);
  }

  private selectJaccardScored(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    limit: number = this.config.topK,
    applyDemotion: boolean = true,
  ): { path: string; score: number }[] {
    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return applyDemotion
      ? demoteScoredPaths(scored, this.config.boilerplateDemotion, limit)
      : scored.slice(0, limit);
  }

  /** Embedding-scored selection that also reports dense-cosine confidence and failure. */
  private async selectEmbeddingScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
    applyDemotion: boolean = false,
  ): Promise<SeedDiag> {
    const { baseUrl, apiKey, model } = this.config;
    if (!baseUrl || !model) {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit, applyDemotion), denseMax: 0, embedFailed: false, denseByPid: {} };
    }

    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated], this.config.dimensions);
    } catch {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit, applyDemotion), denseMax: 0, embedFailed: true, denseByPid: {} };
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array[]>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const vecs = summaryVectors(this.cache.entries[pids[i]]);
        if (vecs !== undefined) pageVecs.set(pids[i], vecs);
      }
    }

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i] || pageVecs.has(pids[i])) continue;
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) { batches.push(cur); cur = { pids: [], texts: [] }; }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey!, model, batch.texts, this.config.dimensions);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], [vecs[i]]);
      } catch {
        for (const pid of batch.pids) pageVecs.set(pid, []);
      }
    }

    let denseMax = 0;
    const denseByPid: Record<string, number> = {};
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vecs = pageVecs.get(pid);
      if (!vecs) continue;
      if (vecs.length === 0) {
        const s = scoreSeed(queryTokens, pid, "", annotations[i]);
        if (s > 0) scored.push({ path: allPaths[i], score: s });
      } else {
        const c = maxCosine(queryVec, vecs);
        if (c > denseMax) denseMax = c;
        denseByPid[pid] = c;                       // raw cosine for the floor
        if (c > 0) scored.push({ path: allPaths[i], score: c });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      results: applyDemotion
        ? demoteScoredPaths(scored, this.config.boilerplateDemotion, limit)
        : scored.slice(0, limit),
      denseMax,
      embedFailed: false,
      denseByPid,
    };
  }

  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<{ path: string; score: number }[]> {
    return (await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, limit, false)).results;
  }

  /** Hybrid (dense ⊕ sparse) selection that also reports dense-cosine confidence. */
  private async selectHybridScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<SeedDiag> {
    const pool = Math.max(this.config.topK, RRF_CANDIDATE_POOL);
    const dense = await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, pool, false);
    const sparse = this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, pool, false);
    const fused = rrf([dense.results.map((x) => x.path), sparse.map((x) => x.path)], this.config.rrfK ?? 60);
    const results = demoteScoredPaths(
      fused.map((f) => ({ path: f.id, score: f.score })),
      this.config.boilerplateDemotion,
      this.config.topK,
    );
    return { results, denseMax: dense.denseMax, embedFailed: dense.embedFailed, denseByPid: dense.denseByPid };
  }

  private async selectHybridScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<{ path: string; score: number }[]> {
    return (await this.selectHybridScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens)).results;
  }

  /** Diagnostics-bearing seed selection used by the query gate. */
  async selectRelevantScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<SeedDiag> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return { results: [], denseMax: 0, embedFailed: false, denseByPid: {} };
    if (this.config.mode === "jaccard") {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths), denseMax: 0, embedFailed: false, denseByPid: {} };
    }
    if (this.config.mode === "hybrid") {
      return this.selectHybridScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens);
    }
    return this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens);
  }

  async loadCache(domainRoot: string, vaultTools: VaultTools): Promise<void> {
    if (this.config.mode === "jaccard") return;
    if (this.cache) return;
    const { model, dimensions } = this.config;
    if (!model || !dimensions) return;
    this.cache = cacheFromIndexRecords(
      await readWikiIndexRecords(vaultTools, domainRoot),
      model,
      dimensions,
    );
  }

  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
    pageBodies: Map<string, string>,
    opts: { fullCorpus?: boolean } = {},
  ): Promise<{ updated: number }> {
    // Persist the embeddings cache for both embedding and hybrid modes — hybrid's dense
    // side reuses it on every query. Only pure jaccard has no vectors to write.
    if (this.config.mode === "jaccard") return { updated: 0 };
    const { baseUrl, apiKey, model, dimensions } = this.config;
    if (!baseUrl || !model || !dimensions) return { updated: 0 };
    const chunking = this.config.chunking ?? DEFAULT_CHUNKING;

    const cachePath = domainIndexPath(domainRoot);
    let cacheFile: EmbeddingCacheFile;
    const hasStructuredIndex = await vaultTools.exists(cachePath);
    const indexRecords = await readWikiIndexRecords(vaultTools, domainRoot);
    if (hasStructuredIndex) {
      cacheFile = cacheFromIndexRecords(indexRecords, model, dimensions);
    } else {
      const legacyPath = legacyDomainEmbeddingsPath(domainRoot);
      if (await vaultTools.exists(legacyPath)) {
        const parsed = JSON.parse(await vaultTools.read(legacyPath)) as EmbeddingCacheFile;
        cacheFile =
          parsed.version === 3 && parsed.model === model && parsed.dimensions === dimensions
            ? parsed
            : { version: 3, model, dimensions, entries: {} };
      } else {
        cacheFile = { version: 3, model, dimensions, entries: {} };
      }
    }

    // Build the desired chunk set per pid, reusing cached vectors whose hash matches.
    const desired = new Map<string, EmbeddingChunk[]>();
    const pending: Pending[] = [];
    // Tracks chunk-count change so a write is triggered even when nothing is pending
    // (e.g. a section deleted: surviving hashes all hit oldByHash, but count shrinks).
    const changedArticleIds = new Set<string>();
    let changed = false;
    if (opts.fullCorpus === true) {
      for (const pid of Object.keys(cacheFile.entries)) {
        if (!indexAnnotations.has(pid)) {
          changedArticleIds.add(pid);
          changed = true;
        }
      }
    }

    for (const [pid, annotation] of indexAnnotations) {
      // A caller may refresh only a subset (incremental ingest supplies bodies only for the
      // pages it rewrote). For a pid with no supplied body, keep its cached chunks untouched
      // rather than rebuilding from an empty body — otherwise unchanged pages lose their
      // section vectors. A pid genuinely present with an empty-string body still rebuilds.
      if (!pageBodies.has(pid) && cacheFile.entries[pid]) {
        desired.set(pid, cacheFile.entries[pid].chunks);
        continue;
      }
      changedArticleIds.add(pid);
      const body = pageBodies.get(pid) ?? "";
      const inputs = buildChunkInputs(annotation, body, chunking);
      const oldByHash = new Map(
        (cacheFile.entries[pid]?.chunks ?? []).map((chunk) => [chunk.hash, chunk]),
      );
      const chunks: EmbeddingChunk[] = [];
      for (const { kind, embedText, hash, heading, ordinal } of inputs) {
        const reuse = oldByHash.get(hash);
        chunks.push({
          vector: reuse?.vector ?? "",
          hash,
          kind,
          heading,
          ordinal,
        });
        if (reuse === undefined) pending.push({ pid, idx: chunks.length - 1, embedText });
      }
      if (!sameChunkSet(cacheFile.entries[pid]?.chunks ?? [], chunks)) changed = true;
      desired.set(pid, chunks);
    }

    // Embed the new chunks in batches.
    for (let i = 0; i < pending.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(i, i + EMBEDDING_BATCH_SIZE);
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, batch.map((p) => p.embedText), dimensions);
      } catch (error) {
        throw new Error(`Embedding refresh failed: ${(error as Error).message}`);
      }
      if (vecs.length !== batch.length || vecs.some((vec) => !isUsableVector(vec, dimensions))) {
        throw new Error("Embedding refresh failed: response did not contain one valid vector per pending chunk");
      }
      for (let j = 0; j < batch.length; j++) {
        desired.get(batch[j].pid)![batch[j].idx].vector = encodeVector(vecs[j]);
      }
    }

    if (pending.length === 0 && !changed) return { updated: 0 };

    for (const pid of changedArticleIds) {
      const chunks = desired.get(pid) ?? [];
      const filled = chunks.filter((c) => c.vector !== "");
      if (filled.length > 0) cacheFile.entries[pid] = { chunks: filled };
      else delete cacheFile.entries[pid];
    }

    let committedRecords: WikiIndexRecord[] | undefined;
    await transformWikiIndexRecords(
      vaultTools,
      domainRoot,
      (latestRecords) => {
        committedRecords = replaceChunkRecordsFromCache(
          cacheFile,
          domainRoot,
          latestRecords,
          changedArticleIds,
        );
        return committedRecords;
      },
    );
    this.cache = cacheFromIndexRecords(committedRecords ?? [], model, dimensions);
    return { updated: pending.length };
  }
}

export function renderContextChunks(chunks: SelectedChunk[]): string {
  return chunks
    .map((chunk) => [
      `--- article: ${chunk.articleId}, heading: ${chunk.heading} ---`,
      chunk.body,
    ].join("\n"))
    .join("\n\n");
}
