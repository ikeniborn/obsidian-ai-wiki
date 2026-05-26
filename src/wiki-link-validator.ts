export type ViolationKind = "alias" | "path" | "inline-json" | "outgoing-desync";

export interface WikiLinkViolation {
  page: string;
  kind: ViolationKind;
  detail: string;
}

export interface FixResult {
  fixed: Map<string, string>;
  warnings: string[];
}

function splitFrontmatter(content: string): [fm: string, body: string] | null {
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx === -1) return null;
  const fmEnd = closeIdx + 4;
  const after = content[fmEnd];
  if (after !== undefined && after !== "\n" && after !== "\r") return null;
  return [content.slice(0, fmEnd), content.slice(fmEnd)];
}

function extractLinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) links.push(m[1].trim());
  return links;
}

function extractFmLinks(fm: string): Set<string> {
  const set = new Set<string>();
  const re = /^\s+- "(\[\[[^\]]+\]\])"/mg;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fm)) !== null) set.add(m[1]);
  return set;
}

function setFmLinks(fm: string, links: string[]): string {
  const block = links.length > 0
    ? "wiki_outgoing_links:\n" + links.map((l) => `  - "${l}"`).join("\n")
    : "wiki_outgoing_links: []";
  const re = /^wiki_outgoing_links:(?:[ \t]*\[\]|(?:\n  - "[^"]*")*)/m;
  if (re.test(fm)) return fm.replace(re, block);
  return fm.replace(/\n---$/, `\n${block}\n---`);
}

function fixOnePass(content: string): string {
  const parts = splitFrontmatter(content);
  if (!parts) {
    return stripPath(stripAlias(content));
  }
  let [fm, body] = parts;

  body = stripAlias(body);
  body = stripPath(body);

  const inlineMatch = fm.match(/^wiki_outgoing_links:[ \t]*(\[.*?\])[ \t]*$/m);
  if (inlineMatch) {
    try {
      const arr: string[] = JSON.parse(inlineMatch[1]);
      fm = fm.replace(/^wiki_outgoing_links:[ \t]*\[.*?\][ \t]*$/m,
        arr.length > 0
          ? "wiki_outgoing_links:\n" + arr.map((l) => `  - "${l}"`).join("\n")
          : "wiki_outgoing_links: []",
      );
    } catch { /* leave as-is */ }
  }

  const bodyLinks = extractLinks(body).map((l) => `[[${l}]]`);
  fm = setFmLinks(fm, bodyLinks);

  return fm + body;
}

function stripAlias(text: string): string {
  return text.replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, "[[$1]]");
}

function stripPath(text: string): string {
  return text.replace(/\[\[([^\]|]+)\]\]/g, (_, link: string) => {
    if (!link.includes("/")) return `[[${link}]]`;
    return `[[${link.split("/").pop()!}]]`;
  });
}

export function validateWikiLinks(
  pages: Map<string, string>,
): WikiLinkViolation[] {
  const violations: WikiLinkViolation[] = [];

  for (const [pagePath, content] of pages) {
    const aliasRe = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = aliasRe.exec(content)) !== null) {
      violations.push({ page: pagePath, kind: "alias", detail: m[0] });
    }

    const linkRe = /\[\[([^\]|]+)\]\]/g;
    while ((m = linkRe.exec(content)) !== null) {
      if (m[1].includes("/")) {
        violations.push({ page: pagePath, kind: "path", detail: m[0] });
      }
    }

    const fmParts = splitFrontmatter(content);
    const fmContent = fmParts ? fmParts[0] : "";
    if (fmContent && /^wiki_outgoing_links:[ \t]*\[/m.test(fmContent)) {
      violations.push({ page: pagePath, kind: "inline-json", detail: "wiki_outgoing_links: [...]" });
    }

    const parts = splitFrontmatter(content);
    if (parts && /^wiki_outgoing_links:/m.test(parts[0])) {
      const [fm, body] = parts;
      const bodyLinksFmt = new Set(extractLinks(body).map((l) => `[[${l}]]`));
      const fmLinks = extractFmLinks(fm);
      const synced = bodyLinksFmt.size === fmLinks.size &&
        [...bodyLinksFmt].every((l) => fmLinks.has(l));
      if (!synced) {
        violations.push({
          page: pagePath, kind: "outgoing-desync",
          detail: `body: [${[...bodyLinksFmt].join(", ")}], fm: [${[...fmLinks].join(", ")}]`,
        });
      }
    }
  }

  return violations;
}

export function fixWikiLinks(
  pages: Map<string, string>,
  maxPasses: number,
  knownPageStems?: Set<string>,
): FixResult {
  const warnings: string[] = [];

  if (maxPasses === 0) {
    const violations = validateWikiLinks(pages);
    for (const v of violations) {
      warnings.push(`${v.page}: ${v.kind} — ${v.detail}`);
    }
    if (knownPageStems) {
      for (const [path, content] of pages) {
        const parts = splitFrontmatter(content);
        const body = parts ? parts[1] : content;
        for (const link of extractLinks(body)) {
          const stem = link.split("/").pop()!;
          if (!knownPageStems.has(stem)) {
            warnings.push(`${path}: dead link [[${stem}]]`);
          }
        }
      }
    }
    return { fixed: new Map(pages), warnings };
  }

  let current = new Map(pages);

  for (let pass = 0; pass < maxPasses; pass++) {
    const violations = validateWikiLinks(current);
    if (violations.length === 0) break;
    const next = new Map<string, string>();
    for (const [path, content] of current) {
      try {
        next.set(path, fixOnePass(content));
      } catch (e) {
        next.set(path, content);
        warnings.push(`${path}: fix error — ${(e as Error).message}`);
      }
    }
    current = next;
  }

  const remaining = validateWikiLinks(current);
  for (const v of remaining) {
    warnings.push(`${v.page}: ${v.kind} — ${v.detail}`);
  }

  if (knownPageStems) {
    for (const [path, content] of current) {
      const parts = splitFrontmatter(content);
      const body = parts ? parts[1] : content;
      for (const link of extractLinks(body)) {
        const stem = link.split("/").pop()!;
        if (!knownPageStems.has(stem)) {
          warnings.push(`${path}: dead link [[${stem}]]`);
        }
      }
    }
  }

  return { fixed: current, warnings };
}

export function checkWikiLinks(pages: Map<string, string>): string {
  const violations = validateWikiLinks(pages);
  if (violations.length === 0) return "";
  return violations.map((v) => `- ${v.page}: ${v.kind} link ${v.detail}`).join("\n");
}
