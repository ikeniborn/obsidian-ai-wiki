import { requestUrl } from "obsidian";
import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";
import { domainEmbeddingsPath } from "./wiki-path";

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
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
  chunking?: ChunkingConfig;
}

export interface EmbeddingChunk {
  vector: string;  // base64 Float32Array
  hash: string;
  kind: "summary" | "section";
}

export interface EmbeddingCacheEntry {
  chunks: EmbeddingChunk[];
}

export interface EmbeddingCacheFile {
  version: 2;
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

export function splitSections(body: string, chunking: ChunkingConfig): SectionWindow[] {
  const stripped = stripFrontmatterAndTitle(body).trim();
  if (!stripped) return [];
  const merged = mergeShort(toUnits(stripped), chunking.minChars);
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

export interface ChunkInput { kind: "summary" | "section"; embedText: string; hash: string; }

export function buildChunkInputs(
  annotation: string,
  body: string,
  chunking: ChunkingConfig,
): ChunkInput[] {
  const inputs: ChunkInput[] = [
    { kind: "summary", embedText: annotation, hash: annotationHash(annotation) },
  ];
  for (const { heading, window } of splitSections(body, chunking)) {
    const embedText = `${annotation}\n\n${heading}\n${window}`;
    inputs.push({ kind: "section", embedText, hash: annotationHash(embedText) });
  }
  return inputs;
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

const EMBEDDING_BATCH_SIZE = 100;

async function fetchEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<Float32Array[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  const resp = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: inputs }),
    throw: false,
  });
  if (resp.status >= 400) throw new Error(`Embedding API error: ${resp.status}`);
  const json = JSON.parse(resp.text) as { data: { embedding: number[] }[] };
  return json.data.map((d) => new Float32Array(d.embedding));
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

export class PageSimilarityService {
  private cache: EmbeddingCacheFile | null = null;

  constructor(readonly config: SimilarityConfig) {}

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
      entityVecs = await fetchEmbeddings(baseUrl, apiKey, model, entities.map(entityQuery));
    } catch {
      return this.jaccardFallbackAll(entities, indexAnnotations, allPaths);
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], decodeVector(entry.vector));
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
        const vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], vecs[i]);
      } catch {
        for (let i = 0; i < batch.pids.length; i++) {
          pageVecs.set(batch.pids[i], new Float32Array(0));
        }
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
        const vec = pageVecs.get(pid);
        if (!vec) continue;
        const score = vec.length === 0
          ? scoreSeed(queryTokens, pid, "", annotations[pi])
          : cosine(queryVec, vec);
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
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey, model, [truncated]);
    } catch {
      return this.selectJaccard(queryTokens, indexAnnotations, allPaths);
    }

    // Page vectors — process in batches
    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array>();

    // Load vectors from in-memory cache (populated by refreshCache)
    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) {
          pageVecs.set(pids[i], decodeVector(entry.vector));
        }
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
        vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts);
      } catch {
        // Fallback: use Jaccard for this batch's pages
        for (const pid of batch.pids) {
          const annotation = indexAnnotations.get(pid) ?? "";
          const score = scoreSeed(queryTokens, pid, "", annotation);
          // Store a sentinel Float32Array of length 0 to indicate Jaccard fallback
          if (score > 0) pageVecs.set(pid, new Float32Array(0));
        }
        continue;
      }
      for (let i = 0; i < batch.pids.length; i++) {
        pageVecs.set(batch.pids[i], vecs[i]);
      }
    }

    // Score and rank
    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vec = pageVecs.get(pid);
      if (!vec) continue;
      let score: number;
      if (vec.length === 0) {
        // Jaccard fallback sentinel
        score = scoreSeed(queryTokens, pid, "", annotations[i]);
      } else {
        score = cosine(queryVec, vec);
      }
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((x) => x.path);
  }

  private selectJaccardScored(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
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
    return scored.slice(0, this.config.topK);
  }

  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<{ path: string; score: number }[]> {
    const { baseUrl, apiKey, model, topK } = this.config;
    if (!baseUrl || !model) {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }

    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated]);
    } catch {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], decodeVector(entry.vector));
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
        const vecs = await fetchEmbeddings(baseUrl, apiKey!, model, batch.texts);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], vecs[i]);
      } catch {
        for (const pid of batch.pids) pageVecs.set(pid, new Float32Array(0));
      }
    }

    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vec = pageVecs.get(pid);
      if (!vec) continue;
      const score = vec.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[i])
        : cosine(queryVec, vec);
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async loadCache(domainRoot: string, vaultTools: VaultTools): Promise<void> {
    if (this.config.mode !== "embedding") return;
    if (this.cache) return;
    const { model, dimensions } = this.config;
    if (!model || !dimensions) return;
    try {
      const raw = await vaultTools.read(domainEmbeddingsPath(domainRoot));
      const parsed = JSON.parse(raw) as EmbeddingCacheFile;
      if (parsed.version === 2 && parsed.model === model && parsed.dimensions === dimensions) {
        this.cache = parsed;
      }
    } catch { /* cache missing or unreadable — stay null */ }
  }

  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
  ): Promise<{ updated: number }> {
    if (this.config.mode !== "embedding") return { updated: 0 };
    const { baseUrl, apiKey, model, dimensions } = this.config;
    if (!baseUrl || !model || !dimensions) return { updated: 0 };

    const cachePath = domainEmbeddingsPath(domainRoot);
    let cacheFile: EmbeddingCacheFile;

    try {
      const raw = await vaultTools.read(cachePath);
      const parsed = JSON.parse(raw) as EmbeddingCacheFile;
      // Invalidate if model or dimensions changed
      if (parsed.model !== model || parsed.dimensions !== dimensions) {
        cacheFile = { model, dimensions, entries: {} };
      } else {
        cacheFile = parsed;
      }
    } catch {
      cacheFile = { model, dimensions, entries: {} };
    }

    // Find stale entries
    const toEmbed: { pid: string; annotation: string }[] = [];
    for (const [pid, annotation] of indexAnnotations) {
      const hash = annotationHash(annotation);
      const existing = cacheFile.entries[pid];
      if (!existing || existing.hash !== hash) {
        toEmbed.push({ pid, annotation });
      }
    }

    if (toEmbed.length === 0) return { updated: 0 };

    // Embed in batches
    for (let i = 0; i < toEmbed.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
      let vecs: Float32Array[];
      try {
        vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.map((x) => x.annotation));
      } catch {
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        cacheFile.entries[batch[j].pid] = {
          vector: encodeVector(vecs[j]),
          hash: annotationHash(batch[j].annotation),
        };
      }
    }

    await vaultTools.write(cachePath, JSON.stringify(cacheFile, null, 2));
    this.cache = cacheFile;
    return { updated: toEmbed.length };
  }
}
