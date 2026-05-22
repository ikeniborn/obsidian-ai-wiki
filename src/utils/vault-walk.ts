import type { TFile, TFolder, Vault } from "obsidian";

export function walkFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if ("children" in child) walkFolder(child as TFolder, out);
    else if ("extension" in child && (child as TFile).extension === "md") out.push(child as TFile);
  }
}

export function collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[] {
  const result: TFile[] = [];
  for (const p of sourcePaths) {
    const folder = vault.getFolderByPath(p);
    if (folder) walkFolder(folder, result);
  }
  return result;
}

export function parseWikiSources(content: string): string[] {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return [];
  const sourcesMatch = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!sourcesMatch) return [];
  return sourcesMatch[1]
    .split("\n")
    .map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim())
    .filter(Boolean);
}
