// node-fs vault access for the harness (Component 2). All vault paths are
// vault-relative and resolved against `vaultRoot`. The fs shim exposes only the
// `{ read, write }` surface that PageSimilarityService.loadCache consumes.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { WIKI_ROOT, domainWikiFolder, domainIndexPath, domainEmbeddingsPath } from "../src/wiki-path";
import { parseIndexAnnotations } from "../src/wiki-index";

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
 * Read every wiki .md page into a Map<vaultRelativePath, content>, excluding
 * meta files (_index.md, _log.md) and anything under _config/. Mirrors the file
 * filter in query.ts so pageId() yields the same ids the retrieval layer returns.
 */
export async function loadWikiPages(vaultRoot: string, wikiVaultPath: string): Promise<Map<string, string>> {
  const dirAbs = join(vaultRoot, wikiVaultPath);
  const names = await readdir(dirAbs, { withFileTypes: true });
  const pages = new Map<string, string>();
  for (const e of names) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    if (e.name === "_index.md" || e.name === "_log.md") continue;
    const vaultRel = `${wikiVaultPath}/${e.name}`;
    pages.set(vaultRel, await readFile(join(dirAbs, e.name), "utf8"));
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
