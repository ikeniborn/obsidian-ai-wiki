/** The two legacy H2 sections, in all three supported output languages. */
const LEGACY_HEADINGS = new Set([
  "## Связанные концепции",
  "## Related concepts",
  "## Conceptos relacionados",
  "## История изменений",
  "## Change history",
  "## Historial de cambios",
]);

/** Just the related-concepts heading variants (links here feed the migration safety-net). */
const RELATED_HEADINGS = new Set([
  "## Связанные концепции",
  "## Related concepts",
  "## Conceptos relacionados",
]);

function isH2(line: string): boolean {
  return /^##\s+/.test(line);
}

/**
 * Remove the two legacy H2 sections (related concepts + change history) from a wiki page,
 * in all three supported languages. Each section is removed from its heading line up to
 * (but not including) the next H2 heading or EOF. Frontmatter (its lines never start with
 * "## "), H1, intro, and every other section are preserved. Pure and idempotent.
 */
export function stripLegacySections(content: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of content.split("\n")) {
    if (isH2(line)) {
      skipping = LEGACY_HEADINGS.has(line.trim());
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  // Collapse blank-line runs left by a removed section; end with a single trailing newline.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

/** All distinct `[[link]]` targets found inside the related-concepts section(s). */
export function extractRelatedLinks(content: string): string[] {
  const links: string[] = [];
  let inRelated = false;
  for (const line of content.split("\n")) {
    if (isH2(line)) { inRelated = RELATED_HEADINGS.has(line.trim()); continue; }
    if (inRelated) {
      for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) {
        const t = m[1].trim();
        if (t) links.push(`[[${t}]]`);
      }
    }
  }
  return [...new Set(links)];
}

const RELATED_SECTION_HEADING = "## Related";

/** Start/end line indices of the first H2 section matching `heading` (end = next H2 or EOF). */
function sectionBounds(lines: string[], heading: string): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (isH2(lines[i]) && lines[i].trim() === heading) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (isH2(lines[j])) { end = j; break; }
      }
      return { start: i, end };
    }
  }
  return null;
}

/**
 * Safety-net: union `links` into the page's canonical `## Related` body section (creating
 * it at the end of the page if absent). The wiki graph reads `[[links]]` from the whole
 * page body, so links living only inside the legacy related-concepts section must be
 * lifted into `## Related` before that section is stripped, or the graph edge is lost.
 * Returns the content unchanged when every link is already present in `## Related`.
 */
export function addOutgoingLinks(content: string, links: string[]): string {
  if (links.length === 0) return content;
  const lines = content.split("\n");
  const bounds = sectionBounds(lines, RELATED_SECTION_HEADING);

  const existing = new Set<string>();
  if (bounds) {
    for (const line of lines.slice(bounds.start + 1, bounds.end)) {
      for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) existing.add(`[[${m[1].trim()}]]`);
    }
  }
  const missing = links.filter((l) => !existing.has(l));
  if (missing.length === 0) return content;

  const bullets = missing.map((l) => `- ${l}`);
  if (!bounds) {
    const trimmed = content.replace(/\s*$/, "\n");
    return `${trimmed}\n${RELATED_SECTION_HEADING}\n\n${bullets.join("\n")}\n`;
  }
  const before = lines.slice(0, bounds.end);
  const after = lines.slice(bounds.end);
  return [...before, ...bullets, ...after].join("\n");
}
