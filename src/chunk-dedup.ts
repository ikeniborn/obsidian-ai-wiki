import type { SelectedChunk } from "./page-similarity";

/**
 * Identity key for exact-duplicate chunk detection: lowercase the heading+body,
 * collapse whitespace runs to a single space, trim. No fuzzy matching.
 */
export function normalizeChunkKey(heading: string, body: string): string {
  return `${heading}\n${body}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Remove exact-duplicate chunks (same normalizeChunkKey). Keeps the
 * highest-`score` copy per key and preserves first-seen order among the kept
 * chunks. Returns the deduped list plus how many chunks were dropped.
 */
export function dedupeChunks(chunks: SelectedChunk[]): { chunks: SelectedChunk[]; dropped: number } {
  const bestByKey = new Map<string, SelectedChunk>();
  const order: string[] = [];
  for (const chunk of chunks) {
    const key = normalizeChunkKey(chunk.heading, chunk.body);
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, chunk);
      order.push(key);
    } else if (chunk.score > prev.score) {
      bestByKey.set(key, chunk);
    }
  }
  const deduped = order.map((key) => bestByKey.get(key)!);
  return { chunks: deduped, dropped: chunks.length - deduped.length };
}
