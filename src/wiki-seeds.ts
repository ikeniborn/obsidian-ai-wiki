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

const BODY_CAP = 500;

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

function bodyContent(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
  return (m ? m[1] : content).slice(0, BODY_CAP);
}

function parseFmKeywords(content: string): Set<string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return new Set();
  const kw = m[1].match(/wiki_keywords:\s*\[(.*?)\]/);
  if (!kw) return new Set();
  return new Set(kw[1].split(",").map((s) => s.trim().replace(/['"]/g, "").toLowerCase()));
}

export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,
): number {
  if (questionTokens.size === 0) return 0;
  const p = tokenize(pageIdValue);
  for (const t of parseFmKeywords(content)) p.add(t);
  for (const t of tokenize(bodyContent(content))) p.add(t);
  if (annotation) for (const t of tokenize(annotation)) p.add(t);
  if (p.size === 0) return 0;
  let inter = 0;
  for (const t of questionTokens) if (p.has(t)) inter++;
  return inter / questionTokens.size;
}

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>,
): { id: string; score: number }[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const annotation = indexAnnotations?.get(id);
    const score = scoreSeed(q, id, content, annotation);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
