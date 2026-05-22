export const WIKI_ROOT = "!Wiki";

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
    path === `${wikiVaultPath}/.config/_index.md` ||
    path === `${wikiVaultPath}/.config/_log.md` ||
    path === `${wikiVaultPath}/.config/_wiki_schema.md` ||
    path === `${wikiVaultPath}/.config/_format_schema.md`
  ) return true;
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  const segments = remainder.split("/");
  return segments.length === 2 && segments[1].endsWith(".md");
}

export function domainConfigDir(domainFolder: string): string {
  return `${domainFolder}/.config`;
}

export function domainIndexPath(domainFolder: string): string {
  return `${domainFolder}/.config/_index.md`;
}

export function domainLogPath(domainFolder: string): string {
  return `${domainFolder}/.config/_log.md`;
}
