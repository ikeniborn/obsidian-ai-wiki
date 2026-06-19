import { parse as yamlParse, stringify as yamlStringify } from "yaml";

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

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

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

/**
 * Safety-net: union `links` into the page's `wiki_outgoing_links` frontmatter. The wiki
 * graph reads `[[links]]` from the whole page body, so links living only inside the
 * related section must be lifted into frontmatter before that section is stripped, or the
 * graph edge is lost. Returns the content unchanged when every link is already present
 * (the common case — lint enforces this invariant) or when there is no parseable
 * frontmatter to union into.
 */
export function addOutgoingLinks(content: string, links: string[]): string {
  if (links.length === 0) return content;
  const m = FM_RE.exec(content);
  if (!m) return content;
  let fm: Record<string, unknown>;
  try {
    const parsed: unknown = yamlParse(m[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return content;
    fm = parsed as Record<string, unknown>;
  } catch { return content; }
  const existing = Array.isArray(fm.wiki_outgoing_links)
    ? (fm.wiki_outgoing_links as unknown[]).map((x) => String(x))
    : [];
  const existingSet = new Set(existing);
  const missing = links.filter((l) => !existingSet.has(l));
  if (missing.length === 0) return content;
  fm.wiki_outgoing_links = [...existing, ...missing];
  return `---\n${yamlStringify(fm)}---\n${content.slice(m[0].length)}`;
}
