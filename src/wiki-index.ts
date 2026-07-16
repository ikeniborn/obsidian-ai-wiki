import { parse as yamlParse } from "yaml";
import { contentHash } from "./content-hash";
import type { PageIndexRecord } from "./wiki-index-jsonl";
import { pageId } from "./wiki-graph";
import { GENERIC_WIKI_STEM_REGEX } from "./wiki-stem";
import { entityTypeFromPath, parseResourceFromFm, parseTagsFromFm } from "./utils/raw-frontmatter";

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

export function pageIndexRecordFromMarkdown(
  domainRoot: string,
  path: string,
  content: string,
): PageIndexRecord {
  const normalized = content.replace(/\r\n/g, "\n");
  const type = entityTypeFromPath(domainRoot, path);
  const description = parseDescriptionFromFm(normalized) || deriveFallbackDescription(normalized, type);
  const fmMatch = FM_RE.exec(normalized);
  let timestamp: string | undefined;
  if (fmMatch) {
    try {
      const parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
      if (typeof parsed.timestamp === "string") timestamp = parsed.timestamp.trim() || undefined;
    } catch { /* governed validation handles malformed frontmatter */ }
  }
  const tags = parseTagsFromFm(normalized);

  return {
    kind: "page",
    schemaVersion: 1,
    articleId: pageId(path),
    path,
    type,
    description,
    resource: parseResourceFromFm(normalized),
    ...(timestamp ? { timestamp } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    bodyHash: contentHash(content),
    descriptionHash: contentHash(description),
  };
}
