/**
 * Pure changed-source detection by FNV-1a content hash.
 *
 * No Obsidian / IO imports — testable out-of-vault (eval/incremental-sources/).
 * Replaces mtime-based detection with body-content hash: a source is "changed" when
 * it has no stored hash (new), when its body differs from the stored hash, or when
 * the stored hash is "" (silent baseline on migration). Frontmatter-only changes
 * (wiki_updated, wiki_articles, etc.) do NOT affect the hash — only real edits do.
 */

export interface SourceFileInfo {
  /** Vault-relative source path; returned verbatim in `changed`. */
  path: string;
  /** Current body-content hash (see hashSource). */
  hash: string;
}

/**
 * Source content with the leading YAML frontmatter block removed and trailing
 * whitespace trimmed. Whole content (trimmed) when there is no frontmatter.
 * The plugin-managed wiki_* frontmatter and Obsidian touch/sync never reach the
 * hash, so only real body edits change it.
 */
export function sourceBodyForHash(content: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(content);
  const body = m ? content.slice(m[0].length) : content;
  return body.replace(/\s+$/, "");
}

/** FNV-1a 32-bit over a string → 8-char lowercase hex. Pure, no deps. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Content hash of a source's body → "fnv1a:<hex>". Prefix gates future algos. */
export function hashSource(content: string): string {
  return "fnv1a:" + fnv1a(sourceBodyForHash(content));
}

/**
 * Pure changed-source detection by content hash.
 * - source path absent from `analyzed`            → changed (new / never ingested)
 * - stored hash is ""                             → silent baseline (return in `baselined`, not changed)
 * - stored hash differs from current              → changed (body edited)
 * - stored hash equals current                    → skip
 * `baselined` is the set the caller must persist into the domain entry (migration
 * fill — no ingest).
 */
export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];
  analyzed: Record<string, string>;
}): { changed: string[]; baselined: Record<string, string> } {
  const { sourceFiles, analyzed } = input;
  const changed: string[] = [];
  const baselined: Record<string, string> = {};
  for (const src of sourceFiles) {
    const stored = analyzed[src.path];
    if (stored === undefined) { changed.push(src.path); continue; }
    if (stored === "") { baselined[src.path] = src.hash; continue; }
    if (stored !== src.hash) changed.push(src.path);
  }
  return { changed, baselined };
}

/**
 * Parse a wiki page's `resource` frontmatter list into BARE source stems.
 * Entries are already plain, unbracketed stems (`- "stem"` or `- stem`), so this
 * only strips the surrounding quotes. Matches the block-list shape every other
 * parser in the codebase assumes (`resource:` followed by `- ` items).
 * Pure — no Obsidian, no IO.
 */
export function parsePageSources(content: string): string[] {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return [];
  const listMatch = /resource:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!listMatch) return [];
  return listMatch[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim())         // drop "- " bullet
    .filter(Boolean)
    .map((t) => t.replace(/^["']|["']$/g, "").trim())           // strip quotes
    .filter(Boolean);
}

/**
 * Cap a name list for display: at most `cap` names, plus the overflow count.
 * The caller renders the "+K more" line with its own i18n.
 */
export function capList(names: string[], cap = 20): { shown: string[]; overflow: number } {
  if (names.length <= cap) return { shown: names, overflow: 0 };
  return { shown: names.slice(0, cap), overflow: names.length - cap };
}
