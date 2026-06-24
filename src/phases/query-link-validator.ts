export interface QueryLinkValidationResult {
  text: string;
  brokenInitial: string[];
  brokenFinal: string[];
  retried: boolean;
}

export function extractAnswerLinks(text: string): string[] {
  const re = /\[\[([^\]|#/]+?)\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

export function findBrokenLinks(links: string[], knownStems: Set<string>): string[] {
  return [...new Set(links.filter((s) => !knownStems.has(s)))];
}

export function annotateBroken(text: string, broken: Set<string>): string {
  return text.replace(/\[\[([^\]|#/]+?)\]\]/g, (full: string, stem: string) => {
    return broken.has(stem.trim()) ? `${full} *(not in wiki)*` : full;
  });
}

