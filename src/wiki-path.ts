export const WIKI_ROOT = "!Wiki";

export function domainWikiFolder(subfolder: string): string {
  return `${WIKI_ROOT}/${subfolder}`;
}
