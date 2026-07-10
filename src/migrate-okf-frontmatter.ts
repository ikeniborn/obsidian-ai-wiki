import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import type { LocalConfigStore } from "./local-config";
import { collectMdInPaths } from "./utils/vault-walk";
import { domainWikiFolder, domainIndexPath } from "./wiki-path";
import { parseIndexAnnotations, deriveFallbackAnnotation } from "./wiki-index";
import {
  renameWikiPageFields,
  ensureType,
  ensureDescription,
  entityTypeFromPath,
} from "./utils/raw-frontmatter";

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function isH2(line: string): boolean {
  return /^##\s+/.test(line);
}

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
 * Merge already-formatted `- ...` bullet lines into the `heading` H2 section (creating it
 * at the end of the page if absent), deduping by `keyOf`. Returns `content` unchanged if
 * every bullet's key is already present in the section.
 */
function mergeBulletSection(
  content: string,
  heading: string,
  bullets: string[],
  keyOf: (line: string) => string,
): string {
  if (bullets.length === 0) return content;
  const lines = content.split("\n");
  const bounds = sectionBounds(lines, heading);

  const existing = new Set<string>();
  if (bounds) {
    for (const line of lines.slice(bounds.start + 1, bounds.end)) {
      const k = keyOf(line);
      if (k) existing.add(k);
    }
  }
  const missing = bullets.filter((b) => !existing.has(keyOf(b)));
  if (missing.length === 0) return content;

  if (!bounds) {
    const trimmed = content.replace(/\s*$/, "\n");
    return `${trimmed}\n${heading}\n\n${missing.join("\n")}\n`;
  }
  const before = lines.slice(0, bounds.end);
  const after = lines.slice(bounds.end);
  return [...before, ...missing, ...after].join("\n");
}

function wikilinkKey(line: string): string {
  const m = /\[\[([^\]|#]+)/.exec(line);
  return m ? `[[${m[1].trim()}]]` : "";
}

function urlKey(line: string): string {
  const m = /\]\((https?:\/\/[^)]+)\)/.exec(line) ?? /(https?:\/\/\S+)/.exec(line);
  return m ? m[1] : "";
}

/**
 * Pulls the relocatable string entries out of frontmatter key `key` on `parsed`.
 * `shouldDelete` is true whenever the value is an array (even empty) — a valid array's
 * usable string links are relocated to the body and the key can be removed with nothing
 * left to lose. Only a NON-array shape (scalar, null, object) is preserved: `shouldDelete`
 * stays false and a warning is logged so the unexpected shape isn't silently discarded.
 * Individual non-string elements inside an array are skipped (and logged) without blocking
 * relocation of the rest.
 */
function extractRelocatableLinks(
  parsed: Record<string, unknown>,
  key: "wiki_outgoing_links" | "wiki_external_links",
): { links: string[]; shouldDelete: boolean } {
  if (!(key in parsed)) return { links: [], shouldDelete: false };

  const value = parsed[key];
  if (!Array.isArray(value)) {
    console.error(`[AI Wiki] OKF migrate: unexpected ${key} shape — left in place`);
    return { links: [], shouldDelete: false };
  }

  const links: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") links.push(entry);
    else console.error(`[AI Wiki] OKF migrate: skipping non-string ${key} entry — left out of relocation`);
  }

  // A valid array — even an empty one — is safe to remove: every usable string link was
  // relocated to the body, and an empty/all-non-string array carries no recoverable link
  // to lose. Only a NON-array shape (handled above) is preserved untouched.
  return { links, shouldDelete: true };
}

/**
 * Relocates the legacy `wiki_outgoing_links` / `wiki_external_links` frontmatter arrays
 * to body sections: outgoing links become `[[stem]]` bullets under `## Related`, external
 * links become `[url](url)` bullets under `## External links`. A frontmatter key is removed
 * only once its (array) value has been handled — a key whose value isn't an array (scalar,
 * null, object) is left untouched and logged instead of being silently discarded. Merges/dedupes into an
 * existing section rather than adding a second one. Pure and idempotent — a page with
 * neither key is returned unchanged.
 */
export function relocateFrontmatterLinks(content: string): string {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }

  const hadOutgoing = "wiki_outgoing_links" in parsed;
  const hadExternal = "wiki_external_links" in parsed;
  if (!hadOutgoing && !hadExternal) return content;

  const outgoing = extractRelocatableLinks(parsed, "wiki_outgoing_links");
  const external = extractRelocatableLinks(parsed, "wiki_external_links");

  if (outgoing.shouldDelete) delete parsed.wiki_outgoing_links;
  if (external.shouldDelete) delete parsed.wiki_external_links;

  const body = content.slice(fmMatch[0].length);
  let out = `---\n${yamlStringify(parsed)}---\n${body}`;

  out = mergeBulletSection(out, "## Related", outgoing.links.map((l) => `- ${l}`), wikilinkKey);
  out = mergeBulletSection(out, "## External links", external.links.map((u) => `- [${u}](${u})`), urlKey);

  return out;
}

/**
 * Full OKF-page migration for one page's content: relocate frontmatter link arrays to body
 * sections, rename legacy `wiki_*` fields (plain `resource`, drop `wiki_type`), then backfill
 * `type` (from the page's entity-type subdirectory) and `description` (the annotation, or a
 * derived fallback when none is available). Pure and idempotent.
 */
export function migrateWikiPageOkf(
  content: string,
  wikiFolder: string,
  fullPath: string,
  annotation: string,
): string {
  let out = relocateFrontmatterLinks(content);
  out = renameWikiPageFields(out);
  out = ensureType(out, entityTypeFromPath(wikiFolder, fullPath));
  out = ensureDescription(out, annotation || deriveFallbackAnnotation(content));
  return out;
}

/**
 * One-shot, idempotent on-load migration: brings every existing domain wiki page to the
 * final OKF frontmatter model (see `migrateWikiPageOkf`). Guarded by the
 * `migrated_okf_frontmatter` local-config flag; a second run is a no-op. Service files
 * (`_`-prefixed) are skipped. Descriptions are backfilled from each domain's `_index.md`
 * annotation map, falling back to a body-derived overview when a page has no entry there.
 */
export async function migrateOkfFrontmatter(
  vault: Vault,
  domains: DomainEntry[],
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_okf_frontmatter) return;

  const adapter = vault.adapter;
  let filesChanged = 0;

  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    const indexPath = domainIndexPath(wikiFolder);

    let annotations = new Map<string, string>();
    if (await adapter.exists(indexPath)) {
      try {
        annotations = parseIndexAnnotations(await adapter.read(indexPath));
      } catch (e) {
        console.error(`[AI Wiki] OKF migration: error reading ${indexPath}`, e);
      }
    }

    for (const file of collectMdInPaths(vault, [wikiFolder])) {
      if (file.basename.startsWith("_")) continue; // skip service files
      try {
        const content = await adapter.read(file.path);
        const migrated = migrateWikiPageOkf(
          content,
          wikiFolder,
          file.path,
          annotations.get(file.basename) ?? "",
        );
        if (migrated !== content) {
          await adapter.write(file.path, migrated);
          filesChanged++;
        }
      } catch (e) {
        console.error(`[AI Wiki] OKF migration: error processing ${file.path}`, e);
      }
    }
  }

  await localConfigStore.save({ migrated_okf_frontmatter: true });
  if (filesChanged > 0) {
    new Notice(`AI Wiki: OKF frontmatter migrated — ${filesChanged} pages`);
  }
}
