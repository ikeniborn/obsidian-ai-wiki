import { normalizeTag } from "./utils/raw-frontmatter";

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
const FM_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Maps a page's stem (last path segment, minus `.md`) to its bundle-relative path
 * (folders preserved), e.g. "person/wiki_d_alice.md" → key "wiki_d_alice".
 */
export function buildPidToRelpath(pageRelpaths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const relpath of pageRelpaths) {
    const stem = relpath.split("/").pop()!.replace(/\.md$/, "");
    map.set(stem, relpath);
  }
  return map;
}

/**
 * Rewrites Obsidian body wikilinks to OKF markdown links:
 *   [[stem]]        → [stem](rel.md)
 *   [[stem|alias]]  → [alias](rel.md)
 * A stem not present in `pidToRel` degrades to plain text (the alias or stem, no
 * link) and is recorded in the returned `dead` array.
 */
export function rewriteWikilinks(
  body: string,
  pidToRel: Map<string, string>,
): { body: string; dead: string[] } {
  const dead: string[] = [];
  const rewritten = body.replace(WIKILINK_RE, (_match, stemRaw: string, aliasRaw?: string) => {
    const stem = stemRaw.trim();
    const text = (aliasRaw ?? stem).trim();
    const rel = pidToRel.get(stem);
    if (!rel) {
      dead.push(stem);
      return text;
    }
    return `[${text}](${rel})`;
  });
  return { body: rewritten, dead };
}

/** Kebab-cases and dedupes export tags: `a/b` → `a-b` (reuse normalizeTag, then `/`→`-`). */
export function normalizeExportTags(tags: string[]): string[] {
  const kept: string[] = [];
  for (const tag of tags) {
    const norm = normalizeTag(tag).replace(/\//g, "-");
    if (!norm || kept.includes(norm)) continue;
    kept.push(norm);
  }
  return kept;
}

/** Derives the export title from the body's first H1, else falls back to the slug. */
export function deriveTitle(content: string, slug: string): string {
  const body = content.replace(FM_RE, "");
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug;
}
