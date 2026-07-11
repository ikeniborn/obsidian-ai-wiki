const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще", "какие",
  "какой", "какая", "какое", "где", "через",
]);

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Ranked {
  id: string;
  score: number;
}

interface IndexedDocument {
  id: string;
  length: number;
  termFreq: Map<string, number>;
}

export interface Bm25Index {
  documents: IndexedDocument[];
  documentFrequency: Map<string, number>;
  averageLength: number;
  size: number;
}

export function tokenizeBm25(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2 && !/[a-zа-я]\d|\d[a-zа-я]/iu.test(raw)) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

export function buildBm25Index(
  documents: Bm25Document[],
  tokenize: (text: string) => string[] = tokenizeBm25,
): Bm25Index {
  const indexed: IndexedDocument[] = [];
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    const tokens = tokenize(document.text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    for (const token of termFreq.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    indexed.push({ id: document.id, length: tokens.length, termFreq });
  }
  const averageLength = indexed.length === 0
    ? 0
    : indexed.reduce((sum, document) => sum + document.length, 0) / indexed.length;
  return { documents: indexed, documentFrequency, averageLength, size: indexed.length };
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function rankBm25(
  queryTokens: string[],
  index: Bm25Index,
  limit: number,
  options: { k1?: number; b?: number } = {},
): Bm25Ranked[] {
  if (queryTokens.length === 0 || index.size === 0 || limit <= 0) return [];
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const avg = index.averageLength || 1;
  const ranked: Bm25Ranked[] = [];
  for (const document of index.documents) {
    let score = 0;
    for (const token of queryTokens) {
      const tf = document.termFreq.get(token) ?? 0;
      if (tf === 0) continue;
      const df = index.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * document.length / avg)));
    }
    if (score > 0) ranked.push({ id: document.id, score });
  }
  return ranked
    .sort((a, b) => (b.score - a.score) || compareStable(a.id, b.id))
    .slice(0, limit);
}
