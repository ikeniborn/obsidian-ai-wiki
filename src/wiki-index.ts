import type { VaultTools } from "./vault-tools";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.match(/^- \[\[([^\]]+)\]\] [^ ]+ — (.+)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function deriveSection(wikiFolder: string, fullPath?: string): string {
  if (!fullPath) return "general";
  const prefix = wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  return parts.length >= 2 ? parts[0] : "general";
}

function upsertInSection(content: string, section: string, pid: string, entryLine: string): string {
  if (!content.trim()) {
    return `# Wiki Index\n\n## ${section}\n${entryLine}\n`;
  }

  const sectionHeader = `## ${section}`;
  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pidRe = new RegExp(`^- \\[\\[${escaped}\\]\\]`);

  const lines = content.split("\n");
  const sectionIdx = lines.findIndex((l) => l === sectionHeader);

  if (sectionIdx === -1) {
    return content.trimEnd() + `\n\n${sectionHeader}\n${entryLine}\n`;
  }

  const nextSection = lines.findIndex((l, i) => i > sectionIdx && l.startsWith("## "));
  const sectionLines = nextSection === -1
    ? lines.slice(sectionIdx + 1)
    : lines.slice(sectionIdx + 1, nextSection);

  const pidIdx = sectionLines.findIndex((l) => pidRe.test(l));
  if (pidIdx !== -1) {
    const absIdx = sectionIdx + 1 + pidIdx;
    return [...lines.slice(0, absIdx), entryLine, ...lines.slice(absIdx + 1)].join("\n");
  }

  const lastEntry = [...sectionLines].reduce((acc, l, i) => l.startsWith("- ") ? i : acc, -1);
  const insertAfter = lastEntry === -1 ? sectionIdx : sectionIdx + 1 + lastEntry;
  return [
    ...lines.slice(0, insertAfter + 1),
    entryLine,
    ...lines.slice(insertAfter + 1),
  ].join("\n");
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

  const section = deriveSection(wikiFolder, fullPath);
  const prefix = wikiFolder + "/";
  const relPath = fullPath
    ? (fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath)
    : pid;
  const entryLine = `- [[${pid}]] ${relPath} — ${annotation}`;

  await vaultTools.write(indexPath, upsertInSection(content, section, pid, entryLine));
}
