export type ViolationKind = "alias" | "path";

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

function fixOnePass(content: string): string {
  const parts = splitFrontmatter(content);
  if (!parts) {
    return stripPath(stripAlias(content));
  }
  const [fm, body] = parts;
  return fm + stripPath(stripAlias(body));
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

function tidyAfterRemoval(text: string): string {
  return text
    .replace(/(\S) {2,}/g, "$1 ")    // collapse mid-line space runs (protects leading indentation)
    .replace(/ +([,.;:)\]])/g, "$1") // drop space before punctuation
    .replace(/[ \t]+$/gm, "");        // trim trailing spaces per line
}

function stripEmptyReferenceBullets(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!/^##\s+(?:Sources|Related|External links)\s*$/iu.test(line.trim())) {
      out.push(line);
      continue;
    }

    const section: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !/^##\s/.test(lines[cursor])) {
      if (!/^\s*-\s*$/.test(lines[cursor])) section.push(lines[cursor]);
      cursor++;
    }
    while (section.length > 0 && section[0].trim().length === 0) section.shift();
    while (section.length > 0 && section[section.length - 1].trim().length === 0) section.pop();
    const hasContent = section.some((item) => item.trim().length > 0);
    if (hasContent || !/^##\s+Related\s*$/iu.test(line.trim())) {
      out.push(line, ...section);
    }
    index = cursor - 1;
  }
  return out.join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// Remove [[links]] whose trailing stem is not in knownStems (dead links) from the
// body. Frontmatter is left untouched — the `## Related` body section is the
// canonical outgoing-link list, not a frontmatter field.
// Deterministic — safe to run unconditionally (no LLM, no retries).
export function stripDeadLinks(content: string, knownStems: Set<string>): string {
  const parts = splitFrontmatter(content);
  const fm = parts ? parts[0] : null;
  let body = parts ? parts[1] : content;

  body = body.replace(
    /[ \t]*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\][ \t]*/g,
    (full: string, link: string) => {
      const stem = link.trim().split("/").pop()!;
      return knownStems.has(stem) ? full : " ";
    },
  );
  body = tidyAfterRemoval(body);
  body = stripEmptyReferenceBullets(body);

  if (fm === null) return body.trim();
  return fm + body;
}
