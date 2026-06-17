import type { VaultTools } from "./vault-tools";
import { domainIndexPath } from "./wiki-path";

export function parseIndexAnnotations(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const m = line.match(/^- (.+?) — (.+)$/);
    if (!m) continue;
    let pid = m[1].trim();
    const old = pid.match(/^\[\[([^\]]+)\]\]/); // old format: "[[pid]] relpath"
    if (old) pid = old[1];
    map.set(pid, m[2].trim());
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

// Matches a pid's index line in BOTH the old `- [[pid]] relpath — …` and the new
// `- pid — …` format. The trailing space anchors the pid as a full token, so `pid`
// does not collide with `pid_2`.
function pidLineRegex(pid: string): RegExp {
  const esc = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- (?:\\[\\[${esc}\\]\\]|${esc}) `);
}

function upsertInSection(content: string, section: string, pid: string, entryLine: string): string {
  if (!content.trim()) {
    return `# Wiki Index\n\n## ${section}\n${entryLine}\n`;
  }

  const sectionHeader = `## ${section}`;
  const pidRe = pidLineRegex(pid);

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
  const indexPath = domainIndexPath(wikiFolder);
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { /* first write */ }

  const section = deriveSection(wikiFolder, fullPath);
  const prefix = wikiFolder + "/";
  const relPath = fullPath
    ? (fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath)
    : pid;
  // collapse newlines / whitespace runs → single space; enforce single-line invariant
  // (not truncation — all content is preserved, only whitespace is normalized)
  const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
  const entryLine = `- [[${pid}]] ${relPath} — ${oneLineAnnotation}`;

  await vaultTools.write(indexPath, upsertInSection(content, section, pid, entryLine));
}

export async function removeIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
): Promise<void> {
  const indexPath = domainIndexPath(wikiFolder);
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { return; }

  const pidRe = pidLineRegex(pid);

  const lines = content.split("\n");
  const targetIdx = lines.findIndex((l) => pidRe.test(l));
  if (targetIdx === -1) return;

  // Drop the entry line.
  const without = [...lines.slice(0, targetIdx), ...lines.slice(targetIdx + 1)];

  // Find the section header above the removed line; remove it if no entries remain.
  let secIdx = -1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (without[i]?.startsWith("## ")) { secIdx = i; break; }
  }
  if (secIdx !== -1) {
    const nextSec = without.findIndex((l, i) => i > secIdx && l.startsWith("## "));
    const end = nextSec === -1 ? without.length : nextSec;
    const hasEntries = without.slice(secIdx + 1, end).some((l) => l.startsWith("- "));
    if (!hasEntries) without.splice(secIdx, 1);
  }

  await vaultTools.write(indexPath, without.join("\n"));
}
