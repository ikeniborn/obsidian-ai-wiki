import { pageId } from "./wiki-graph";

const STOP_WORDS = new Set([
  // EN
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how", "here",
  // RU
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще",
]);

const CONTENT_CAP = 200;

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const raw of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length <= 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
): number {
  if (questionTokens.size === 0) return 0;
  const head = content.slice(0, CONTENT_CAP);
  const p = tokenize(pageIdValue);
  for (const t of tokenize(head)) p.add(t);
  if (p.size === 0) return 0;
  let inter = 0;
  for (const t of questionTokens) if (p.has(t)) inter++;
  const union = questionTokens.size + p.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
): string[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const score = scoreSeed(q, id, content);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.id);
}
