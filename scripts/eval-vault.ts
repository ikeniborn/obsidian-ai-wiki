// node-fs vault access for the harness (Component 2). All vault paths are
// vault-relative and resolved against `vaultRoot`. The fs shim exposes only the
// `{ read, write }` surface that PageSimilarityService.loadCache consumes.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { WIKI_ROOT, domainWikiFolder, domainIndexPath, domainEmbeddingsPath } from "../src/wiki-path";
import { parseIndexAnnotations } from "../src/wiki-index";

// Meta files excluded from the page set, matching src/phases/query.ts.
const META_FILES = ["_index.md", "_log.md"];

export interface FsShim {
  read(vaultPath: string): Promise<string>;
  write(vaultPath: string, data: string): Promise<void>;
}

/** Minimal vault-relative fs adapter rooted at `vaultRoot`. */
export function makeFsShim(vaultRoot: string): FsShim {
  const abs = (p: string) => join(vaultRoot, p);
  return {
    async read(p) {
      return readFile(abs(p), "utf8");
    },
    async write(p, data) {
      const full = abs(p);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, "utf8");
    },
  };
}

/**
 * Resolve the wiki folder (e.g. "!Wiki/os"). With `wikiArg`, use it directly.
 * Otherwise auto-detect the single subfolder under !Wiki/ that has
 * _config/_index.md. Errors if zero or more than one candidate exists.
 */
export async function locateWikiFolder(vaultRoot: string, wikiArg?: string): Promise<string> {
  if (wikiArg) {
    const folder = domainWikiFolder(wikiArg);
    if (!existsSync(join(vaultRoot, domainIndexPath(folder)))) {
      throw new Error(`wiki "${wikiArg}" has no ${domainIndexPath(folder)} under ${vaultRoot}`);
    }
    return folder;
  }
  const wikiRootAbs = join(vaultRoot, WIKI_ROOT);
  if (!existsSync(wikiRootAbs)) {
    throw new Error(`no ${WIKI_ROOT}/ folder under ${vaultRoot}`);
  }
  const entries = await readdir(wikiRootAbs, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name !== "_config")
    .map((e) => domainWikiFolder(e.name))
    .filter((folder) => existsSync(join(vaultRoot, domainIndexPath(folder))));
  if (candidates.length === 0) {
    throw new Error(`no wiki subfolder with _config/_index.md found under ${WIKI_ROOT}/ — pass --wiki <subfolder>`);
  }
  if (candidates.length > 1) {
    throw new Error(`multiple wiki subfolders found (${candidates.join(", ")}) — pass --wiki <subfolder>`);
  }
  return candidates[0];
}

/** Read + parse the wiki index annotations (pageId → annotation). */
export async function loadIndexAnnotations(fs: FsShim, wikiVaultPath: string): Promise<Map<string, string>> {
  const content = await fs.read(domainIndexPath(wikiVaultPath));
  return parseIndexAnnotations(content);
}

/**
 * Read every wiki .md page into a Map<vaultRelativePath, content>, recursing into
 * subfolders. Mirrors src/phases/query.ts: it collects the recursive `**\/*.md`
 * set (production uses VaultTools.listFiles, which is recursive), then excludes
 * meta files (_index.md, _log.md) and anything under _config/. Wiki pages live in
 * nested subfolders (e.g. systems/, applications/), so a non-recursive read would
 * miss them and pageId() would diverge from the ids the retrieval layer returns.
 */
export async function loadWikiPages(vaultRoot: string, wikiVaultPath: string): Promise<Map<string, string>> {
  const mdFiles: string[] = [];
  const walk = async (relDir: string): Promise<void> => {
    const entries = await readdir(join(vaultRoot, relDir), { withFileTypes: true });
    for (const e of entries) {
      const vaultRel = `${relDir}/${e.name}`;
      if (e.isDirectory()) {
        await walk(vaultRel);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        mdFiles.push(vaultRel);
      }
    }
  };
  await walk(wikiVaultPath);
  const files = mdFiles.filter(
    (f) => !META_FILES.some((m) => f.endsWith(m)) && !f.includes("/_config/"),
  );
  const pages = new Map<string, string>();
  for (const f of files) {
    pages.set(f, await readFile(join(vaultRoot, f), "utf8"));
  }
  return pages;
}

/** Read model + dimensions from the embedding cache header (if present). */
export async function readEmbeddingHeader(
  fs: FsShim,
  wikiVaultPath: string,
): Promise<{ model?: string; dimensions?: number }> {
  try {
    const raw = await fs.read(domainEmbeddingsPath(wikiVaultPath));
    const parsed = JSON.parse(raw) as { model?: string; dimensions?: number };
    return { model: parsed.model, dimensions: parsed.dimensions };
  } catch {
    return {};
  }
}
