export const WIKI_ROOT = "!Wiki";

export const LEGACY_GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
export const LEGACY_GLOBAL_DOMAIN_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_domain.json`;
export const GLOBAL_CONFIG_DIR = LEGACY_GLOBAL_CONFIG_DIR;
export const GLOBAL_DOMAIN_PATH = LEGACY_GLOBAL_DOMAIN_PATH;
export const GLOBAL_AGENT_LOG_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_agent.jsonl`;
export const GLOBAL_DEV_LOG_PATH = `${LEGACY_GLOBAL_CONFIG_DIR}/_dev.jsonl`;

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}

/** True if `path` is inside the wiki tree (every domain's wiki lives under WIKI_ROOT). */
export function isWikiArticlePath(path: string): boolean {
  return path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`);
}

/** Basenames of per-domain service files that are NOT wiki content pages. */
const DOMAIN_META_BASENAMES = new Set([
  "metadata.jsonl", "index.jsonl", "log.jsonl", // current JSONL layout
  "_index.md", "_log.md",                       // legacy markdown layout
]);

/** True if `path` is a domain service/meta file rather than a wiki content page. */
export function isDomainMetaPath(path: string): boolean {
  if (path.includes("/_config/")) return true;
  const base = path.split("/").pop() ?? path;
  return DOMAIN_META_BASENAMES.has(base);
}

/** True if `path` is a wiki content page (a `.md` file that is not a meta file). */
export function isWikiPagePath(path: string): boolean {
  return path.endsWith(".md") && !isDomainMetaPath(path);
}

export function sanitizeWikiFolder(raw: string): string {
  let s = raw;
  const vaultMatch = s.match(/^vaults\/[^/]+\//);
  if (vaultMatch) s = s.slice(vaultMatch[0].length);
  if (s.startsWith("!Wiki/")) s = s.slice("!Wiki/".length);
  if (s.includes("/")) return s.split("/").pop()!;
  return s;
}

export function sanitizeWikiSubfolder(raw: string): string {
  if (!raw.includes("/")) return raw;
  return raw.split("/").pop()!;
}

export function validateArticlePath(path: string, wikiVaultPath: string): boolean {
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  if (isDomainMetaPath(path)) return false;
  const remainder = path.slice(prefix.length);
  const segments = remainder.split("/");
  // Accept a flat page (<file>.md) or one entity-type subfolder deep (<subfolder>/<file>.md).
  return segments.length <= 2 && segments[segments.length - 1].endsWith(".md");
}

export function domainMetadataPath(domainFolder: string): string {
  return `${domainFolder}/metadata.jsonl`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainFolder}/index.jsonl`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainFolder}/log.jsonl`;
}

export function legacyDomainConfigDir(domainFolder: string): string {
  return `${domainFolder}/_config`;
}

export function legacyDomainIndexPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_index.md`;
}

export function legacyDomainLogPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_log.md`;
}

export function legacyDomainEmbeddingsPath(domainFolder: string): string {
  return `${legacyDomainConfigDir(domainFolder)}/_embeddings.json`;
}

export const domainConfigDir = legacyDomainConfigDir;
export const domainEmbeddingsPath = legacyDomainEmbeddingsPath;
