import { requestUrl } from "obsidian";
import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";
import { domainEmbeddingsPath } from "./wiki-path";
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

export function buildChunkInputs(
  annotation: string,
  body: string,
  chunking: ChunkingConfig,
): ChunkInput[] {
  const inputs: ChunkInput[] = [
    { kind: "summary", embedText: annotation, hash: annotationHash(`summary\n${annotation}`) },
  ];
  splitSections(body, chunking).forEach(({ heading, window }, ordinal) => {
    const embedText = `${heading}\n${window}`.trim();
    inputs.push({
      kind: "section",
      embedText,
      hash: annotationHash(`section\n${ordinal}\n${embedText}`),
      heading,
      window,
      ordinal,
    });
  });
  return inputs;
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

async function fetchEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
  dimensions?: number,
): Promise<Float32Array[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  // Send `dimensions` (OpenAI-standard MRL truncation) when configured, so the whole
  // pipeline and the probe agree on the requested size. Models that don't support it
  // either ignore the field (return native size) or error — the probe surfaces which.
  const body: Record<string, unknown> = { model, input: inputs };
  if (dimensions && dimensions > 0) body.dimensions = dimensions;
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
  if (resp.status >= 400) throw new Error(`Embedding API error: ${resp.status}`);
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
 * value is valid. Returns null on any HTTP/parse failure (the "или ошибка" case).
 */
export async function probeEmbeddingDimensions(
  baseUrl: string,
  apiKey: string,
  model: string,
  requested?: number,
): Promise<DimensionProbe | null> {
  try {
    const [vec] = await fetchEmbeddings(baseUrl, apiKey, model, ["ping"], requested);
    if (!vec || vec.length === 0) return null;
    return {
      actual: vec.length,
      requested: requested && requested > 0 ? requested : undefined,
      honored: !requested || requested <= 0 || vec.length === requested,
    };
  } catch {
    return null;
  }
}

export interface ExtractedEntity {
  name: string;
  type?: string;
  context_snippet?: string;
}

export interface EntityRetrievalResult {
  results: Map<string, string[]>;
  allFailed: boolean;
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
    return scored.slice(0, this.config.topK).map((x) => x.path);
  }

  private jaccardFallbackAll(
    entities: ExtractedEntity[],
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): EntityRetrievalResult {
    const results = new Map<string, string[]>();
    let anySuccess = false;
    for (const e of entities) {
      const top = this.scoreJaccardOnce(tokenize(entityQuery(e)), indexAnnotations, allPaths);
      results.set(entityKey(e), top);
      if (indexAnnotations.size > 0) anySuccess = true;
    }
    return { results, allFailed: allPaths.length > 0 && !anySuccess };
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
    } catch {
      return this.jaccardFallbackAll(entities, indexAnnotations, allPaths);
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

    let anySuccess = false;
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
      if (indexAnnotations.size > 0) anySuccess = true;
    }

    return { results, allFailed: allPaths.length > 0 && !anySuccess };
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
    return scored.slice(0, this.config.topK).map((x) => x.path);
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

    // Score and rank
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
    return scored.slice(0, limit);
  }

  /** Embedding-scored selection that also reports dense-cosine confidence and failure. */
  private async selectEmbeddingScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<SeedDiag> {
    const { baseUrl, apiKey, model } = this.config;
    if (!baseUrl || !model) {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: false, denseByPid: {} };
    }

    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated], this.config.dimensions);
    } catch {
      return { results: this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, limit), denseMax: 0, embedFailed: true, denseByPid: {} };
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
    return { results: scored.slice(0, limit), denseMax, embedFailed: false, denseByPid };
  }

  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
    limit: number = this.config.topK,
  ): Promise<{ path: string; score: number }[]> {
    return (await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, limit)).results;
  }

  /** Hybrid (dense ⊕ sparse) selection that also reports dense-cosine confidence. */
  private async selectHybridScoredDiag(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<SeedDiag> {
    const pool = Math.max(this.config.topK, RRF_CANDIDATE_POOL);
    const dense = await this.selectEmbeddingScoredDiag(sourceContent, indexAnnotations, allPaths, queryTokens, pool);
    const sparse = this.selectJaccardScored(queryTokens, indexAnnotations, allPaths, pool);
    const fused = rrf([dense.results.map((x) => x.path), sparse.map((x) => x.path)], this.config.rrfK ?? 60);
    const results = fused.slice(0, this.config.topK).map((f) => ({ path: f.id, score: f.score }));
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
    try {
      const raw = await vaultTools.read(domainEmbeddingsPath(domainRoot));
      const parsed = JSON.parse(raw) as EmbeddingCacheFile;
      if (parsed.version === 3 && parsed.model === model && parsed.dimensions === dimensions) {
        this.cache = parsed;
      }
    } catch { /* cache missing or unreadable — stay null */ }
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

    const cachePath = domainEmbeddingsPath(domainRoot);
    let cacheFile: EmbeddingCacheFile;
    try {
      const parsed = JSON.parse(await vaultTools.read(cachePath)) as EmbeddingCacheFile;
      if (parsed.version !== 3 && opts.fullCorpus !== true) {
        return { updated: 0 };
      }
      cacheFile =
        parsed.version === 3 && parsed.model === model && parsed.dimensions === dimensions
          ? parsed
          : { version: 3, model, dimensions, entries: {} };
    } catch {
      cacheFile = { version: 3, model, dimensions, entries: {} };
    }

    // Build the desired chunk set per pid, reusing cached vectors whose hash matches.
    const desired = new Map<string, EmbeddingChunk[]>();
    const pending: Pending[] = [];
    // Tracks chunk-count change so a write is triggered even when nothing is pending
    // (e.g. a section deleted: surviving hashes all hit oldByHash, but count shrinks).
    let changed = opts.fullCorpus === true &&
      Object.keys(cacheFile.entries).some((pid) => !indexAnnotations.has(pid));

    for (const [pid, annotation] of indexAnnotations) {
      // A caller may refresh only a subset (incremental ingest supplies bodies only for the
      // pages it rewrote). For a pid with no supplied body, keep its cached chunks untouched
      // rather than rebuilding from an empty body — otherwise unchanged pages lose their
      // section vectors. A pid genuinely present with an empty-string body still rebuilds.
      if (!pageBodies.has(pid) && cacheFile.entries[pid]) {
        desired.set(pid, cacheFile.entries[pid].chunks);
        continue;
      }
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
      if ((cacheFile.entries[pid]?.chunks.length ?? 0) !== chunks.length) changed = true;
      desired.set(pid, chunks);
    }

    // Embed the new chunks in batches.
    for (let i = 0; i < pending.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(i, i + EMBEDDING_BATCH_SIZE);
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey ?? "", model, batch.map((p) => p.embedText), dimensions);
      } catch {
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) desired.get(batch[j].pid)![batch[j].idx].vector = encodeVector(vecs[j]);
      }
    }

    if (pending.length === 0 && !changed) return { updated: 0 };

    if (opts.fullCorpus === true) cacheFile.entries = {};
    for (const [pid, chunks] of desired) {
      const filled = chunks.filter((c) => c.vector !== "");
      if (filled.length > 0) cacheFile.entries[pid] = { chunks: filled };
    }

    await vaultTools.write(cachePath, JSON.stringify(cacheFile, null, 2));
    this.cache = cacheFile;
    return { updated: pending.length };
  }
}
