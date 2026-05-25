import { tokenize, scoreSeed } from "./wiki-seeds";
import { pageId } from "./wiki-graph";
import type { VaultTools } from "./vault-tools";
import { domainEmbeddingsPath } from "./wiki-path";

export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;
  dimensions?: number;
  topK: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface EmbeddingCacheEntry {
  vector: string;  // base64 Float32Array
  hash: string;
}

export interface EmbeddingCacheFile {
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}

export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer).toString("base64");
}

export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function annotationHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
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
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
  const json = await resp.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => new Float32Array(d.embedding));
}

export class PageSimilarityService {
  private cache: EmbeddingCacheFile | null = null;
  private cacheLoaded = false;

  constructor(private config: SimilarityConfig) {}

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
    if (!baseUrl || !apiKey || !model) {
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

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i]) continue;
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

  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
  ): Promise<void> {
    if (this.config.mode !== "embedding") return;
    const { baseUrl, apiKey, model, dimensions } = this.config;
    if (!baseUrl || !apiKey || !model || !dimensions) return;

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

    if (toEmbed.length === 0) return;

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
  }
}
