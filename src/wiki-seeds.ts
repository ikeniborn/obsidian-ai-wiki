import { pageId } from "./wiki-graph";
import { scoreLexicalPage, tokenizeLexical } from "./lexical-retrieval";

const BODY_CAP = 500;

export function tokenize(s: string): Set<string> {
  return tokenizeLexical(s);
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
  const keywords = [...parseFmKeywords(content)].join(" ");
  return scoreLexicalPage(questionTokens, {
    id: pageIdValue,
    path: pageIdValue,
    title: pageIdValue,
    description: [annotation, keywords].filter(Boolean).join("\n"),
    content: bodyContent(content),
  }).score;
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
  scored.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
  return scored.slice(0, topK);
}
