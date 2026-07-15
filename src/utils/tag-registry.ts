import path from "path-browserify";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { DomainEntry } from "../domain";
import { normalizeTag, parseTagsFromFm, TAG_RE } from "./raw-frontmatter";
import { isWikiPagePath } from "../wiki-path";

/** Default cap on distinct thematic (non-entity) top-level tag categories per domain. */
export const DEFAULT_MAX_TAG_CATEGORIES = 12;

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Minimal structural slice of VaultTools needed for tag collection (keeps tests headless). */
export interface TagVault {
  listFiles(dir: string): Promise<string[]>;
  readAll(paths: string[]): Promise<Map<string, string>>;
  toVaultPath(absolutePath: string): string | null;
}

export interface TagRegistry {
  /** top-level category → full tag → occurrence count */
  categories: Map<string, Map<string, number>>;
  /** distinct valid tags across the domain */
  total: number;
}

/**
 * Scan frontmatter `tags:` of every .md file in the domain wiki folder and the
 * domain's source paths. Tags are normalized and TAG_RE-validated; invalid
 * entries are excluded. `_config/` files are skipped.
 */
export async function collectDomainTags(
  vault: TagVault,
  wikiFolder: string,
  sourcePaths: string[],
): Promise<TagRegistry> {
  const dirs = [wikiFolder];
  for (const sp of sourcePaths) {
    const vaultPath = path.isAbsolute(sp)
      ? vault.toVaultPath(sp) ?? ""
      : (sp.endsWith("/") ? sp.slice(0, -1) : sp);
    if (vaultPath) dirs.push(vaultPath);
  }
  const files = new Set<string>();
  for (const dir of dirs) {
    const listed = await vault.listFiles(dir).catch(() => [] as string[]);
    for (const f of listed) {
      if (isWikiPagePath(f)) files.add(f);
    }
  }
  const contents = await vault.readAll([...files]);
  const categories = new Map<string, Map<string, number>>();
  let total = 0;
  for (const content of contents.values()) {
    for (const raw of parseTagsFromFm(content)) {
      const tag = normalizeTag(raw);
      if (!TAG_RE.test(tag)) continue;
      const cat = tag.split("/")[0];
      let m = categories.get(cat);
      if (!m) {
        m = new Map();
        categories.set(cat, m);
      }
      if (!m.has(tag)) total++;
      m.set(tag, (m.get(tag) ?? 0) + 1);
    }
  }
  return { categories, total };
}

/** Top-level categories in the registry that are not entity-type categories. */
export function thematicCategories(registry: TagRegistry, entityTypeNames: string[]): string[] {
  const entitySet = new Set(entityTypeNames.map((t) => normalizeTag(t)));
  return [...registry.categories.keys()].filter((c) => !entitySet.has(c));
}

/**
 * Render the EXISTING DOMAIN TAGS prompt block. The FULL registry is rendered —
 * no truncation (the vocabulary itself is bounded, not the prompt). Returns ""
 * when there are no entity types and no collected tags.
 */
export function renderTagRegistryBlock(
  registry: TagRegistry,
  entityTypeNames: string[],
  maxCategories: number = DEFAULT_MAX_TAG_CATEGORIES,
): string {
  const entityCats = [
    ...new Set(entityTypeNames.map((t) => normalizeTag(t)).filter((t) => TAG_RE.test(t))),
  ];
  const entitySet = new Set(entityCats);
  const thematic = [...registry.categories.keys()].filter((c) => !entitySet.has(c)).sort();
  if (entityCats.length === 0 && thematic.length === 0) return "";

  const tagLine = (cat: string): string => {
    const tags = [...registry.categories.get(cat)!.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} (${n})`);
    return `- ${cat}: ${tags.join(", ")}`;
  };

  const lines: string[] = ["EXISTING DOMAIN TAGS (reuse these; do not invent near-duplicates):"];
  if (entityCats.length > 0) {
    lines.push(`Entity categories: ${entityCats.join(", ")}`);
    for (const cat of entityCats) {
      if (registry.categories.has(cat)) lines.push(tagLine(cat));
    }
  }
  const full = thematic.length >= maxCategories;
  lines.push(
    `Thematic categories (${thematic.length}/${maxCategories} used${full ? " — no new thematic categories allowed, reuse only" : ""}):`,
  );
  if (thematic.length === 0) {
    lines.push("- (none yet)");
  } else {
    for (const cat of thematic) lines.push(tagLine(cat));
  }
  return lines.join("\n");
}

/**
 * Deterministic entity-tag sync: derive the page's entity type from its wiki
 * subfolder (second-to-last path segment) and prepend the normalized type as a
 * tag when neither the tag itself nor any `tag/...` descendant is present.
 */
export function ensureEntityTypeTag(
  content: string,
  pagePath: string,
  domain: DomainEntry,
): { content: string; added: boolean; tag: string | null } {
  const segments = pagePath.split("/");
  if (segments.length < 2) return { content, added: false, tag: null };
  const subfolder = segments[segments.length - 2];
  const et = domain.entity_types?.find((e) => e.wiki_subfolder === subfolder);
  if (!et) return { content, added: false, tag: null };
  const tag = normalizeTag(et.type);
  if (!TAG_RE.test(tag)) return { content, added: false, tag: null };

  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, added: false, tag };
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, added: false, tag };
  }
  const existing = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (existing.some((t) => t === tag || t.startsWith(`${tag}/`))) {
    return { content, added: false, tag };
  }
  parsed.tags = [tag, ...existing];
  const body = content.slice(fmMatch[0].length);
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, added: true, tag };
}
