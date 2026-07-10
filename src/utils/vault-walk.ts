import { TFile, TFolder, type Vault } from "obsidian";
import { parseResourceFromFm } from "./raw-frontmatter";

export function walkFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFolder) walkFolder(child, out);
    else if (child instanceof TFile && child.extension === "md") out.push(child);
  }
}

export function collectMdInPaths(vault: Vault, sourcePaths: string[]): TFile[] {
  const result: TFile[] = [];
  for (const p of sourcePaths) {
    const folder = vault.getFolderByPath(p.replace(/\/+$/, ""));
    if (folder) walkFolder(folder, result);
  }
  return result;
}

/**
 * Parse a wiki page's `resource` frontmatter list into bare source stems. Delegates
 * to a real YAML parse (parseResourceFromFm) so both the block form
 * (`resource:\n  - stem`) and the flow form (`resource: ["stem"]`, as emitted by the
 * ingest prompt) are read alike.
 */
export function parseWikiSources(content: string): string[] {
  return parseResourceFromFm(content);
}
