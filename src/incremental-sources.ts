/**
 * Pure changed-source detection for incremental domain re-init.
 *
 * No Obsidian / IO imports — testable out-of-vault (eval/incremental-sources/).
 * Keys ONLY on mtime: a source is "changed" when it has no associated wiki page,
 * when any relevant mtime is unavailable (trust bias: include on ambiguity), or
 * when it is strictly newer than the oldest of its associated pages. It never
 * reads wiki_added / wiki_updated or any timestamp frontmatter field.
 */

export interface SourceFileInfo {
  /** Source filename stem (basename without ".md"). */
  stem: string;
  /** Vault-relative source path; returned verbatim in `changed`. */
  path: string;
  /** Modification time in epoch ms, or null when unavailable. */
  mtime: number | null;
}

export interface WikiPageInfo {
  path: string;
  mtime: number | null;
  /** Bare source stems from the page's wiki_sources frontmatter. */
  sources: string[];
}

export function computeChangedSources(input: {
  sourceFiles: SourceFileInfo[];
  wikiPages: WikiPageInfo[];
}): { changed: string[] } {
  const { sourceFiles, wikiPages } = input;
  const changed: string[] = [];
  for (const src of sourceFiles) {
    const associated = wikiPages.filter((p) => p.sources.includes(src.stem));
    if (associated.length === 0) { changed.push(src.path); continue; }            // new / unreflected
    if (src.mtime === null || associated.some((p) => p.mtime === null)) {
      changed.push(src.path); continue;                                           // ambiguous → trust bias
    }
    const oldestPage = Math.min(...associated.map((p) => p.mtime as number));
    if (src.mtime > oldestPage) changed.push(src.path);                           // strict >, min aggregation
  }
  return { changed };
}

/**
 * Parse a wiki page's `wiki_sources` frontmatter list into BARE source stems.
 * Production stores entries as double-quoted wikilinks (`- "[[stem]]"`), so this
 * strips the surrounding quotes, the `[[ ]]`, any folder prefix, and a trailing
 * `.md`, yielding a basename that matches a source file's stem for association.
 * Matches the block-list shape every other parser in the codebase assumes
 * (`wiki_sources:` followed by `- ` items). Pure — no Obsidian, no IO.
 */
export function parsePageSources(content: string): string[] {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return [];
  const listMatch = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!listMatch) return [];
  return listMatch[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim())                       // drop "- " bullet
    .filter(Boolean)
    .map((t) => t.replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim())  // strip quotes + [[ ]]
    .map((t) => t.split("/").pop()!.replace(/\.md$/, ""))                     // folder prefix + .md → bare stem
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
