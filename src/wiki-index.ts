import { parse as yamlParse } from "yaml";
import type { VaultTools } from "./vault-tools";
import { domainIndexPath } from "./wiki-path";
import { GENERIC_WIKI_STEM_REGEX } from "./wiki-stem";

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

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

/** Frontmatter `description` scalar, or "" when absent/unparseable. */
export function parseDescriptionFromFm(content: string): string {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return "";
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; } catch { return ""; }
  const d = parsed.description;
  return typeof d === "string" ? d.trim() : "";
}

/**
 * pid → retrieval overview text, sourced from each page's frontmatter `description`
 * (the OKF-native single source of truth), falling back to a body-derived summary
 * when the field is absent. Skips `_`-prefixed / non-wiki stems.
 */
export function collectDescriptions(
  pages: Array<{ path: string; content: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { path, content } of pages) {
    const stem = path.split("/").pop()!.replace(/\.md$/, "");
    if (stem.startsWith("_") || !GENERIC_WIKI_STEM_REGEX.test(stem)) continue;
    const desc = parseDescriptionFromFm(content);
    map.set(stem, desc || deriveFallbackDescription(content));
  }
  return map;
}

// Deterministic one-line description for pages the LLM left un-annotated, so they
// still get an index entry (and therefore an embedding) and become retrievable.
// LLM lint later upgrades it to a full Covers:/Type:/Terms: description.
export function deriveFallbackDescription(content: string, entityType?: string): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const h1 = (body.match(/^#\s+(.+)$/m)?.[1] ?? "").trim() || "(untitled)";

  let firstLine = "";
  let inFence = false;
  for (const l of body.split("\n")) {
    const t = l.trim();
    if (t.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (t && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith("---") && !t.startsWith(">")) {
      firstLine = l;
      break;
    }
  }
  const trimmed = firstLine.trim();
  const sentence = trimmed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? trimmed;

  const type = (entityType ?? "").trim() || "general";
  const unwrap = (s: string) => s.replace(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g, "$1");

  let out = `${unwrap(h1)} — ${unwrap(sentence)} Type: ${type}`
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > 800) out = out.slice(0, 797).trimEnd() + "...";
  return out;
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
  // collapse newlines / whitespace runs → single space; enforce single-line invariant
  // (not truncation — all content is preserved, only whitespace is normalized)
  const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
  const entryLine = `- ${pid} — ${oneLineAnnotation}`;

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

export interface IndexReconcile {
  adds: Array<{ pid: string; annotation: string; fullPath: string }>;
  removes: string[];
}

// Bidirectional diff between _index.md and the on-disk page set.
// `pages` MUST be the complete domain page set, or live pages would be
// mis-flagged as orphans. Meta files (_*) and stems failing the wiki mask
// are ignored. Caller applies adds via upsertIndexAnnotation and removes via
// removeIndexAnnotation.
export function reconcileIndex(
  indexContent: string,
  wikiFolder: string,
  pages: Array<{ path: string; content: string; annotation?: string }>,
): IndexReconcile {
  const indexed = new Set(parseIndexAnnotations(indexContent).keys());
  const onDisk = new Set<string>();
  const adds: IndexReconcile["adds"] = [];

  for (const p of pages) {
    const stem = p.path.split("/").pop()!.replace(/\.md$/, "");
    if (stem.startsWith("_") || !GENERIC_WIKI_STEM_REGEX.test(stem)) continue;
    onDisk.add(stem);
    if (indexed.has(stem)) continue;
    const entityType = deriveSection(wikiFolder, p.path);
    const annotation = (p.annotation && p.annotation.trim())
      ? p.annotation
      : deriveFallbackDescription(p.content, entityType);
    adds.push({ pid: stem, annotation, fullPath: p.path });
  }

  const removes = [...indexed].filter((pid) => !onDisk.has(pid));
  return { adds, removes };
}
