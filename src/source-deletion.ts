import type { DomainEntry } from "./domain";
import { isWikiArticlePath } from "./wiki-path";
import { parseResourceFromFm } from "./utils/raw-frontmatter";

export interface DeletionPlan {
  /** sole-source wiki page vault-paths (the deleted source is their only resource entry) */
  toDelete: string[];
  /** multi-source wiki page vault-paths (deleted source present, but other sources remain) */
  toRebuild: string[];
  /** dedup union of remaining source references, resolved to source vault-paths (unresolved dropped) */
  remainingSources: string[];
}

/** Basename without the .md extension. */
export function sourceStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** Strip surrounding whitespace and quotes from a resource list entry. */
export function stripSourceToken(token: string): string {
  return token.trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * Parse the resource list from a wiki page body into source references. Delegates to a
 * real YAML parse (parseResourceFromFm) so both legacy stem entries and vault-relative
 * path entries are read alike.
 */
function wikiSourceTokens(content: string): string[] {
  return parseResourceFromFm(content);
}

/**
 * Compute what deleting `sourcePath` entails for a domain's wiki pages.
 * Pure: `pages` is wikiPagePath→content; `sourceStemToPath` maps remaining source
 * stems to their vault paths (must NOT include the deleted source).
 */
export function computeDeletionPlan(
  sourcePath: string,
  pages: Map<string, string>,
  sourceStemToPath: Map<string, string>,
): DeletionPlan {
  const targetStem = sourceStem(sourcePath);
  const targetTokens = new Set([sourcePath, targetStem]);
  const toDelete: string[] = [];
  const toRebuild: string[] = [];
  const remainingTokens = new Set<string>();

  for (const [pagePath, content] of pages) {
    const tokens = wikiSourceTokens(content);
    if (!tokens.some((token) => targetTokens.has(token))) continue;
    if (tokens.length === 1) {
      toDelete.push(pagePath);
    } else {
      toRebuild.push(pagePath);
      for (const token of tokens) if (!targetTokens.has(token)) remainingTokens.add(token);
    }
  }

  const remainingSources: string[] = [];
  for (const token of remainingTokens) {
    if (token.endsWith(".md") || token.includes("/")) {
      remainingSources.push(token);
      continue;
    }
    const path = sourceStemToPath.get(token);
    if (path) remainingSources.push(path);
  }

  return { toDelete, toRebuild, remainingSources };
}

/** True if `path` is a non-wiki source file of `domain` (member of source_paths). */
export function isSourceFile(path: string, domain: DomainEntry): boolean {
  if (isWikiArticlePath(path)) return false;
  if (!path.endsWith(".md")) return false;
  for (const sp of domain.source_paths ?? []) {
    const norm = sp.replace(/\/+$/, "");
    if (path === norm || path.startsWith(`${norm}/`)) return true;
  }
  return false;
}
