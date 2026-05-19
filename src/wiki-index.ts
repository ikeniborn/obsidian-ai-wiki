import type { VaultTools } from "./vault-tools";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key || !raw) continue;
    // new format: [[pid]] path/to/page.md | annotation
    const pipeIdx = raw.indexOf(" | ");
    const value = pipeIdx >= 0 ? raw.slice(pipeIdx + 3).trim() : raw;
    map.set(key, value);
  }
  return map;
}

export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
  annotation: string,
  fullPath?: string,
): Promise<void> {
  const indexPath = `${wikiFolder}/_index.md`;
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { /* first write */ }
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  let newLine: string;
  if (fullPath) {
    const prefix = wikiFolder + "/";
    const relativePath = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
    newLine = `${pid}: [[${pid}]] ${relativePath} | ${annotation}`;
  } else {
    newLine = `${pid}: ${annotation}`;
  }
  if (pattern.test(content)) {
    content = content.replace(pattern, newLine);
  } else {
    content = content ? `${content}\n${newLine}` : newLine;
  }
  await vaultTools.write(indexPath, content);
}
