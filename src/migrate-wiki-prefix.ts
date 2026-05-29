import type { VaultAdapter } from "./vault-tools";
import type { DomainEntry } from "./domain";
import { GENERIC_WIKI_STEM_REGEX, buildWikiStem } from "./wiki-stem";
import {
  domainConfigDir,
  domainIndexPath,
  domainLogPath,
  domainEmbeddingsPath,
  domainWikiFolder,
} from "./wiki-path";

export interface MigrateOptions {
  dryRun?: boolean;
}

export interface MigrationReport {
  domainId: string;
  filesRenamed: number;
  renames: Record<string, string>;
  indexUpdated: boolean;
  embeddingsKeysRenamed: number;
  logUpdated: boolean;
  sourcesUpdated: number;
  skipped: boolean;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function stemOf(path: string): string {
  return basename(path).replace(/\.md$/, "");
}

async function listMdRecursive(adapter: VaultAdapter, dir: string): Promise<string[]> {
  if (!(await adapter.exists(dir))) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const { files, folders } = await adapter.list(cur);
    for (const f of files) if (f.endsWith(".md")) out.push(f);
    for (const sub of folders) stack.push(sub);
  }
  return out;
}

function rewriteWikiLinks(content: string, renames: Map<string, string>): string {
  return content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (match, target: string, alias?: string) => {
    const newTarget = renames.get(target);
    if (!newTarget) return match;
    return `[[${newTarget}${alias ?? ""}]]`;
  });
}

function rewritePathMentions(
  content: string,
  renames: Map<string, string>,
): string {
  let out = content;
  for (const [oldStem, newStem] of renames) {
    const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Replace "<anything>/<oldStem>.md" — preserving the folder portion.
    const pathRe = new RegExp(`(^|[\\s/(])([^\\s()\\[\\]]*\\/)${escaped}\\.md\\b`, "g");
    out = out.replace(pathRe, (_m, lead, folder) => `${lead}${folder}${newStem}.md`);
  }
  return out;
}

export async function migrateDomain(
  domain: DomainEntry,
  adapter: VaultAdapter,
  opts: MigrateOptions = {},
): Promise<MigrationReport> {
  const report: MigrationReport = {
    domainId: domain.id,
    filesRenamed: 0,
    renames: {},
    indexUpdated: false,
    embeddingsKeysRenamed: 0,
    logUpdated: false,
    sourcesUpdated: 0,
    skipped: false,
  };

  if ((domain.pageNameVersion ?? 0) >= 1) {
    report.skipped = true;
    return report;
  }

  const wikiFolder = domainWikiFolder(domain.wiki_folder);
  const configDir = domainConfigDir(wikiFolder);
  const allWikiFiles = await listMdRecursive(adapter, wikiFolder);
  const pageFiles = allWikiFiles.filter((p) => !p.startsWith(configDir + "/"));

  const renames = new Map<string, string>();
  const domainPrefix = `wiki_${domain.id}_`;
  for (const p of pageFiles) {
    const stem = stemOf(p);
    if (GENERIC_WIKI_STEM_REGEX.test(stem)) continue;
    try {
      // If the stem is already prefixed but the entity portion contains uppercase or
      // non-slug chars, re-slug just the entity portion to preserve the prefix.
      const entityRaw = stem.startsWith(domainPrefix)
        ? stem.slice(domainPrefix.length)
        : stem;
      const newStem = buildWikiStem(domain.id, entityRaw);
      if (newStem !== stem) renames.set(stem, newStem);
    } catch {
      // can't derive slug — skip this page
    }
  }

  report.renames = Object.fromEntries(renames);
  report.filesRenamed = renames.size;

  // Rewrite + rename wiki pages.
  for (const p of pageFiles) {
    const stem = stemOf(p);
    const newStem = renames.get(stem);
    const content = await adapter.read(p);
    const rewritten = rewriteWikiLinks(content, renames);
    if (newStem !== undefined) {
      const newPath = p.slice(0, -(stem.length + 3)) + newStem + ".md";
      if (!opts.dryRun) {
        await adapter.write(newPath, rewritten);
        if (newPath !== p) await adapter.remove?.(p);
      }
    } else if (rewritten !== content && !opts.dryRun) {
      await adapter.write(p, rewritten);
    }
  }

  // _index.md.
  const indexPath = domainIndexPath(wikiFolder);
  if (await adapter.exists(indexPath)) {
    const raw = await adapter.read(indexPath);
    let updated = rewriteWikiLinks(raw, renames);
    updated = rewritePathMentions(updated, renames);
    if (updated !== raw) {
      report.indexUpdated = true;
      if (!opts.dryRun) await adapter.write(indexPath, updated);
    }
  }

  // _log.md.
  const logPath = domainLogPath(wikiFolder);
  if (await adapter.exists(logPath)) {
    const raw = await adapter.read(logPath);
    const updated = rewritePathMentions(raw, renames);
    if (updated !== raw) {
      report.logUpdated = true;
      if (!opts.dryRun) await adapter.write(logPath, updated);
    }
  }

  // _embeddings.json.
  const embPath = domainEmbeddingsPath(wikiFolder);
  if (await adapter.exists(embPath)) {
    try {
      const raw = await adapter.read(embPath);
      const parsed = JSON.parse(raw) as { entries?: Record<string, unknown> };
      if (parsed.entries) {
        const newEntries: Record<string, unknown> = {};
        let renamed = 0;
        for (const [k, v] of Object.entries(parsed.entries)) {
          const nk = renames.get(k) ?? k;
          if (nk !== k) renamed++;
          newEntries[nk] = v;
        }
        parsed.entries = newEntries;
        report.embeddingsKeysRenamed = renamed;
        if (renamed > 0 && !opts.dryRun) {
          await adapter.write(embPath, JSON.stringify(parsed, null, 2));
        }
      }
    } catch {
      // malformed — skip
    }
  }

  // Source frontmatter wiki_articles.
  for (const sp of domain.source_paths ?? []) {
    const dir = sp.endsWith("/") ? sp.slice(0, -1) : sp;
    const files = await listMdRecursive(adapter, dir);
    for (const f of files) {
      const raw = await adapter.read(f);
      const updated = rewriteWikiLinks(raw, renames);
      if (updated !== raw) {
        report.sourcesUpdated++;
        if (!opts.dryRun) await adapter.write(f, updated);
      }
    }
  }

  if (!opts.dryRun) {
    domain.pageNameVersion = 1;
  }

  return report;
}
