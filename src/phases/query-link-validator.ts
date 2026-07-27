export interface QueryLinkValidationResult {
  text: string;
  brokenInitial: string[];
  brokenFinal: string[];
  retried: boolean;
}

type TextTransform = (text: string) => string;

function transformInlineCodeAware(text: string, transform: TextTransform): string {
  let cursor = 0;
  let output = "";

  while (cursor < text.length) {
    const opener = text.indexOf("`", cursor);
    if (opener < 0) return output + transform(text.slice(cursor));

    let openerEnd = opener + 1;
    while (text[openerEnd] === "`") openerEnd++;
    const delimiterLength = openerEnd - opener;

    let search = openerEnd;
    let closer = -1;
    let closerEnd = -1;
    while (search < text.length) {
      const candidate = text.indexOf("`", search);
      if (candidate < 0) break;
      let candidateEnd = candidate + 1;
      while (text[candidateEnd] === "`") candidateEnd++;
      if (candidateEnd - candidate === delimiterLength) {
        closer = candidate;
        closerEnd = candidateEnd;
        break;
      }
      search = candidateEnd;
    }

    if (closer < 0) {
      output += transform(text.slice(cursor, openerEnd));
      cursor = openerEnd;
      continue;
    }

    output += transform(text.slice(cursor, opener));
    output += text.slice(opener, closerEnd);
    cursor = closerEnd;
  }

  return output;
}

function transformOutsideMarkdownCode(text: string, transform: TextTransform): string {
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let output = "";
  let prose = "";
  const flushProse = (): void => {
    output += transformInlineCodeAware(prose, transform);
    prose = "";
  };

  for (const line of lines) {
    if (line.length === 0) continue;
    if (fence) {
      output += line;
      const marker = fence.marker === "`" ? "`" : "~";
      const closing = line.match(new RegExp(`^ {0,3}(${marker}{${fence.length},})[ \\t]*(?:\\r?\\n)?$`));
      if (closing) fence = null;
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      flushProse();
      const marker = opening[1][0] as "`" | "~";
      fence = { marker, length: opening[1].length };
      output += line;
      continue;
    }

    prose += line;
  }

  flushProse();
  return output;
}

function transformWikiLinks(
  text: string,
  transform: (full: string, stem: string) => string,
): string {
  return transformOutsideMarkdownCode(text, (prose) => prose.replace(
    /\[\[([^\]|#/]+?)\]\]/g,
    (full: string, stem: string) => transform(full, stem.trim()),
  ));
}

export function extractAnswerLinks(text: string): string[] {
  const out: string[] = [];
  transformWikiLinks(text, (full, stem) => {
    out.push(stem);
    return full;
  });
  return out;
}

export function findBrokenLinks(links: string[], knownStems: Set<string>): string[] {
  return [...new Set(links.filter((s) => !knownStems.has(s)))];
}

export function annotateBroken(text: string, broken: Set<string>): string {
  return transformWikiLinks(text, (full, stem) => {
    return broken.has(stem) ? `${full} *(not in wiki)*` : full;
  });
}

export function replaceAnswerLink(text: string, fromStem: string, toStem: string): string {
  return transformWikiLinks(text, (full, stem) => {
    return stem === fromStem ? `[[${toStem}]]` : full;
  });
}
