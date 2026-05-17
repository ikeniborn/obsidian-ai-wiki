import type { VaultTools } from "./vault-tools";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

export async function upsertIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
  annotation: string,
): Promise<void> {
  const indexPath = `${wikiFolder}/_index.md`;
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { /* first write */ }
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  const newLine = `${pid}: ${annotation}`;
  if (pattern.test(content)) {
    content = content.replace(pattern, newLine);
  } else {
    content = content ? `${content}\n${newLine}` : newLine;
  }
  await vaultTools.write(indexPath, content);
}
