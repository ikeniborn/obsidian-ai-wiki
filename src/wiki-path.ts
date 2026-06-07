export const WIKI_ROOT = "!Wiki";

export const GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
export const GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
export const GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
export const GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
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
  if (
    path === `${wikiVaultPath}/_config/_index.md` ||
    path === `${wikiVaultPath}/_config/_log.md`
  ) return true;
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  // Reject old .config paths and any paths with .config
  if (remainder.includes(".config")) return false;
  const segments = remainder.split("/");
  return segments.length === 2 && segments[1].endsWith(".md");
}

export function domainConfigDir(domainFolder: string): string {
  return `${domainFolder}/_config`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_index.md`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_log.md`;
}

export function domainEmbeddingsPath(domainFolder: string): string {
  return `${domainConfigDir(domainFolder)}/_embeddings.json`;
}
