import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { GENERIC_WIKI_STEM_REGEX } from "../wiki-stem";

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /^\[\[.+\]\]$/;
const URL_RE = /^https?:\/\//;
export const TAG_RE = /^[a-z][a-z0-9-]*(?:[/_][a-z0-9-]+)*$/;

const FM_KEY_LINE = /^(wiki_[\w]+|tags|aliases|created|updated|external_links|related):/;

export const WIKI_FIELD_ALIASES: Record<string, string> = {
  wiki_sources: "resource",
  wiki_updated: "timestamp",
  wiki_status:  "status",
};

/** Strip [[ ]] from a wikilink string → bare stem; pass through plain strings. */
function toPlainStem(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const m = /^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/.exec(v.trim());
  return m ? m[1].split("/").pop()!.replace(/\.md$/, "") : v;
}

/**
 * Rename legacy wiki_* keys to OKF-native names (last-wins), drop wiki_type, and
 * normalize `resource` values from `[[stem]]` wikilinks to plain stems. Idempotent.
 * Leaves `wiki_outgoing_links`/`wiki_external_links` untouched — a later migration
 * relocates them to the body.
 */
export function renameWikiPageFields(content: string): string {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }

  let modified = false;
  for (const [legacy, okf] of Object.entries(WIKI_FIELD_ALIASES)) {
    if (legacy in parsed) {
      if (!(okf in parsed)) parsed[okf] = parsed[legacy]; // legacy fills only if OKF absent (last-wins on new)
      delete parsed[legacy];
      modified = true;
    }
  }
  if ("wiki_type" in parsed) { delete parsed["wiki_type"]; modified = true; }
  // resource → plain stems
  if (Array.isArray(parsed.resource)) {
    const plain = (parsed.resource as unknown[]).map(toPlainStem);
    if (JSON.stringify(plain) !== JSON.stringify(parsed.resource)) { parsed.resource = plain; modified = true; }
  }

  if (!modified) return content;
  const body = content.slice(fmMatch[0].length);
  return `---\n${yamlStringify(parsed)}---\n${body}`;
}

/** Entity-type subdirectory segment of a wiki page path; generic/flat → "concept". */
export function entityTypeFromPath(wikiFolder: string, fullPath: string): string {
  const prefix = wikiFolder.endsWith("/") ? wikiFolder : wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  const seg = parts.length >= 2 ? parts[0].trim().toLowerCase() : "";
  return !seg || seg === "entities" ? "concept" : seg;
}

/**
 * Salvage a near-valid tag before TAG_RE validation instead of dropping it:
 * `#Category/Sub Topic` → `category/sub-topic`. Output is NOT guaranteed to
 * pass TAG_RE — callers must still validate.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Raw string entries of the frontmatter `tags:` list — no normalization or validation. */
export function parseTagsFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return [];
  }
  const tags = parsed["tags"];
  if (!Array.isArray(tags)) return [];
  return (tags as unknown[]).filter((t): t is string => typeof t === "string");
}

/**
 * Recovers a source page's frontmatter into a single valid fenced block, tolerant of
 * the broken shapes seen in the wild:
 *  - fully unfenced frontmatter (keys at the top with no `---` delimiters);
 *  - duplicate keys (e.g. two `wiki_updated:` lines) — last occurrence wins;
 *  - block-list values (`wiki_articles:` followed by indented `- "[[…]]"` items);
 *  - `wiki_*` keys stranded in the body directly after an otherwise-valid leading fence.
 *
 * It collects the leading fenced YAML (if any) plus the leading run of frontmatter-key
 * lines from the body (including their indented list items), merges them with last-wins
 * dedup, strips them from the body, and re-serialises a single `---` block. A page that
 * already has a valid leading fence and no stray frontmatter in the body, or one with no
 * frontmatter at all, is returned unchanged (so the function is idempotent). If the
 * collected frontmatter cannot be parsed, the content is returned unchanged for the
 * downstream validator to handle.
 */
export function recoverSourceFrontmatter(content: string): string {
  const fenceMatch = FM_RE.exec(content);
  const lead = fenceMatch ? fenceMatch[1] : "";
  const rest = fenceMatch ? content.slice(fenceMatch[0].length) : content;

  // Peel the leading run of frontmatter lines from the body (skipping leading blanks).
  const lines = rest.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const runStart = i;
  let sawKey = false;
  while (i < lines.length) {
    if (FM_KEY_LINE.test(lines[i])) { sawKey = true; i++; continue; }
    if (sawKey && /^\s+\S/.test(lines[i])) { i++; continue; } // indented list item or YAML continuation
    break;
  }
  const strayFm = sawKey ? lines.slice(runStart, i).join("\n") : "";
  const body = sawKey ? lines.slice(i).join("\n") : rest;

  // Nothing to recover: valid fence with no stray frontmatter, or a frontmatter-less page.
  if (!strayFm && (fenceMatch || !lead)) return content;
  // Only recover when the stray run carries a wiki_* field (the backlink data ingest needs).
  // This avoids fabricating a fence around body prose that merely starts with a
  // frontmatter-like key (e.g. "updated: see the appendix below").
  if (strayFm && !/^wiki_[\w]+:/m.test(strayFm)) return content;

  const fmText = [lead, strayFm].filter((s) => s.trim().length > 0).join("\n");
  let parsed: unknown;
  try {
    parsed = yamlParse(fmText, { uniqueKeys: false });
  } catch {
    return content; // unrecoverable — leave it for validateAndRepairSourceFrontmatter
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return content;

  const fm = yamlStringify(parsed).replace(/\n+$/, "");
  const cleanBody = body.replace(/^\n+/, "");
  return `---\n${fm}\n---\n${cleanBody}`;
}

export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-wikilinks-stem-only" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "list-strings" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] }
  | { field: string; kind: "remove" };

export function validateAndRepairFrontmatter(
  content: string,
  rules: FieldRule[],
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, warnings };

  let rawYaml = fmMatch[1];
  const body = content.slice(fmMatch[0].length);

  // Detect duplicate keys via regex line scan
  const counts = new Map<string, number>();
  for (const m of rawYaml.matchAll(/^([\w][\w_]*):/gm)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }

  let modified = false;

  // Pre-merge duplicate list fields in raw YAML before parsing
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const allItems: string[] = [];
    const blockRe = new RegExp(`^${key}:[^\\n]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "gm");
    for (const m of rawYaml.matchAll(blockRe)) {
      for (const item of m[1].matchAll(/[ \t]+-[ \t]+"?([^"\n]+?)"?[ \t]*$/gm)) {
        allItems.push(item[1].trim());
      }
    }
    let prev: string;
    do {
      prev = rawYaml;
      rawYaml = rawYaml.replace(
        new RegExp(`^${key}:[^\\n]*\\n(?:[ \\t]+-[^\\n]*\\n?)*`, "m"),
        "",
      );
    } while (rawYaml !== prev);
    modified = true;
    if (allItems.length > 0) {
      const merged = [...new Set(allItems)];
      rawYaml =
        rawYaml.trimEnd() + "\n" + key + ":\n" + merged.map((v) => `  - "${v}"`).join("\n") + "\n";
      warnings.push(`Duplicate key "${key}" — merged ${merged.length} items`);
    } else {
      warnings.push(`Duplicate scalar key "${key}" — last value kept`);
    }
  }

  // Parse via yaml.parse — catch syntax errors → warn, return original
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(rawYaml) as Record<string, unknown>) ?? {};
  } catch (e) {
    warnings.push(`Unparseable YAML: ${(e as Error).message} — left unchanged`);
    return { content, warnings };
  }

  // Apply per-field rules on parsed object
  for (const rule of rules) {
    const val = parsed[rule.field];
    if (val === undefined || val === null) continue;

    switch (rule.kind) {
      case "list-wikilinks":
      case "list-urls": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const predicate =
          rule.kind === "list-wikilinks"
            ? (v: string) => WIKILINK_RE.test(v)
            : (v: string) => URL_RE.test(v);
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !predicate(v)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        if (filtered.length < (val as unknown[]).length) {
          modified = true;
          if (filtered.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = filtered;
          }
        }
        break;
      }
      case "list-tags": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const kept: string[] = [];
        let changed = false;
        for (const v of val as unknown[]) {
          if (typeof v !== "string") {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            changed = true;
            continue;
          }
          const norm = normalizeTag(v);
          if (!TAG_RE.test(norm)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            changed = true;
            continue;
          }
          if (norm !== v) {
            warnings.push(`${rule.field}: normalized "${v}" → "${norm}"`);
            changed = true;
          }
          if (kept.includes(norm)) {
            changed = true;
          } else {
            kept.push(norm);
          }
        }
        if (changed) {
          modified = true;
          if (kept.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = kept;
          }
        }
        break;
      }
      case "list-strings": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string") {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        if (filtered.length < (val as unknown[]).length) {
          modified = true;
          if (filtered.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = filtered;
          }
        }
        break;
      }
      case "list-wikilinks-stem-only": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !WIKILINK_RE.test(v) || v.includes("/") || v.endsWith(".md]]")) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        if (filtered.length < (val as unknown[]).length) {
          modified = true;
          if (filtered.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = filtered;
          }
        }
        break;
      }
      case "date-scalar": {
        if (typeof val !== "string" || !DATE_RE.test(val)) {
          warnings.push(`${rule.field}: invalid date "${val}" — removed`);
          delete parsed[rule.field];
          modified = true;
        }
        break;
      }
      case "aliases": {
        if (typeof val === "string") {
          warnings.push(`${rule.field}: scalar "${val}" wrapped in list`);
          parsed[rule.field] = [val];
          modified = true;
        }
        break;
      }
      case "warn-enum": {
        if (typeof val !== "string" || !(rule.values as string[]).includes(val)) {
          warnings.push(
            `${rule.field}: unexpected value "${val}" (expected: ${rule.values.join("|")})`,
          );
        }
        break;
      }
      case "remove": {
        if (rule.field in parsed) {
          warnings.push(`${rule.field}: field not allowed here — removed`);
          delete parsed[rule.field];
          modified = true;
        }
        break;
      }
    }
  }

  // Re-serialize via yaml.stringify and reconstruct full file
  if (!modified) return { content, warnings };
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}

export function filterStaleWikiLinks(
  content: string,
  existingStems: Set<string>,
  fields: string[],
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, warnings };

  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, warnings };
  }

  let modified = false;
  for (const field of fields) {
    const val = parsed[field];
    if (!Array.isArray(val)) continue;
    const filtered = (val as string[]).filter((entry) => {
      if (!WIKILINK_RE.test(entry)) return true;
      const stem = entry.slice(2, -2);
      if (existingStems.has(stem)) return true;
      warnings.push(`${field}: stale link ${entry} — removed`);
      return false;
    });
    if (filtered.length !== val.length) {
      parsed[field] = filtered;
      modified = true;
    }
  }

  if (!modified) return { content, warnings };
  const body = content.slice(fmMatch[0].length);
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}

export function stripInvalidWikiArticles(
  content: string,
  existingWikiStems: Set<string>,
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, warnings };

  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, warnings };
  }

  const val = parsed["wiki_articles"];
  if (!Array.isArray(val) || (val as unknown[]).length === 0) return { content, warnings };

  const filtered = (val as string[]).filter((entry) => {
    if (!WIKILINK_RE.test(entry)) {
      warnings.push(`wiki_articles: plain text "${entry}" — removed`);
      return false;
    }
    const stem = entry.slice(2, -2);
    if (!GENERIC_WIKI_STEM_REGEX.test(stem)) {
      warnings.push(`wiki_articles: non-wiki stem ${entry} — removed`);
      return false;
    }
    if (!existingWikiStems.has(stem)) {
      warnings.push(`wiki_articles: stale link ${entry} — removed`);
      return false;
    }
    return true;
  });

  if (filtered.length === (val as string[]).length) return { content, warnings };
  parsed["wiki_articles"] = filtered;
  const body = content.slice(fmMatch[0].length);
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}

const SOURCE_RULES: FieldRule[] = [
  { field: "wiki_articles",       kind: "list-wikilinks-stem-only" },
  { field: "wiki_added",          kind: "remove" },
  { field: "wiki_updated",        kind: "remove" },
  { field: "tags",                kind: "list-tags" },
  { field: "aliases",             kind: "aliases" },
  { field: "created",             kind: "date-scalar" },
  { field: "updated",             kind: "date-scalar" },
  { field: "external_links",      kind: "list-urls" },
  { field: "related",             kind: "list-wikilinks" },
  { field: "wiki_outgoing_links", kind: "remove" },
  { field: "wiki_sources",        kind: "remove" },
  { field: "wiki_status",         kind: "remove" },
  { field: "wiki_type",           kind: "remove" },
  { field: "wiki_external_links", kind: "remove" },
  { field: "annotation",          kind: "remove" },
];

export function validateAndRepairSourceFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  return validateAndRepairFrontmatter(content, SOURCE_RULES);
}

/**
 * Restores a source page's frontmatter onto formatted output.
 * - Re-attaches `wiki_articles` from `original` (the only wiki-tracking field
 *   source notes still carry — `wiki_added`/`wiki_updated` are dropped).
 * - ALWAYS normalizes the result (dedupe keys, drop invalid values, re-serialize YAML).
 * Idempotent: re-running on already-restored content yields the same content.
 */
export function restoreSourceFrontmatter(original: string, formatted: string): string {
  const wiki_articles = parseWikiArticlesFromFm(original);
  const restored = upsertRawFrontmatter(formatted, { wiki_articles });
  const { content } = validateAndRepairSourceFrontmatter(restored);
  return content;
}

const WIKI_PAGE_RULES: FieldRule[] = [
  { field: "resource",             kind: "list-strings" },   // plain source stems
  { field: "timestamp",            kind: "date-scalar" },
  { field: "status",               kind: "warn-enum", values: ["stub", "developing", "mature"] },
  { field: "tags",                 kind: "list-tags" },
  { field: "aliases",              kind: "aliases" },
  { field: "wiki_type",            kind: "remove" },
  { field: "wiki_outgoing_links",  kind: "remove" },
  { field: "wiki_external_links",  kind: "remove" },
  { field: "annotation",           kind: "remove" },
];

export function validateAndRepairWikiPageFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  const renamed = renameWikiPageFields(content);
  return validateAndRepairFrontmatter(renamed, WIKI_PAGE_RULES);
}

/**
 * Upserts a source page's frontmatter with `wiki_articles` only. Strips any
 * `wiki_added`/`wiki_updated` dates carried over from `content` — source notes
 * no longer track wiki sync dates.
 */
export function upsertRawFrontmatter(
  content: string,
  fields: { wiki_articles: string[] },
): string {
  const match = FM_RE.exec(content);
  const body = match ? content.slice(match[0].length) : content;

  let existing: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = yamlParse(match[1]);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch { /* malformed YAML — start fresh */ }
  }

  const { wiki_added: _a, wiki_updated: _u, wiki_articles: _ar, ...rest } = existing;
  void _a; void _u; void _ar;

  const result: Record<string, unknown> = { ...rest };
  if (fields.wiki_articles.length > 0) result.wiki_articles = fields.wiki_articles;

  return `---\n${yamlStringify(result)}---\n${body}`;
}

export function parseWikiArticlesFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  const match = /wiki_articles:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}

export function parseResourceFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; } catch { return []; }
  const r = parsed.resource;
  return Array.isArray(r) ? (r as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

const SOURCES_HEADING = "## Sources";

/**
 * Ensure the page body carries a `## Sources` section listing each source note
 * as a navigable wikilink. OKF keeps links in body sections, not frontmatter:
 * the plain `resource` frontmatter records provenance, while this section makes
 * the wiki→source link clickable. Source resources are vault-relative paths;
 * wikilinks omit the `.md` suffix. Idempotent — existing links are kept and new
 * ones unioned; an empty source list is a no-op.
 * Heading is a fixed English literal, mirroring `## Related` / `## External links`.
 */
export function ensureSourcesSection(content: string, sourceStems: string[]): string {
  const stems = [...new Set(sourceStems
    .map((s) => s.trim().replace(/\.md$/i, ""))
    .filter((s) => s.length > 0))];
  if (stems.length === 0) return content;

  const lines = content.split("\n");
  const headIdx = lines.findIndex((l) => l.trim().toLowerCase() === SOURCES_HEADING.toLowerCase());

  if (headIdx === -1) {
    const block = [SOURCES_HEADING, ...stems.map((s) => `- [[${s}]]`)].join("\n");
    return `${content.replace(/\s*$/, "")}\n\n${block}\n`;
  }

  const nextIdx = lines.findIndex((l, i) => i > headIdx && /^##\s/.test(l));
  const end = nextIdx === -1 ? lines.length : nextIdx;
  const existing = new Set(
    lines.slice(headIdx + 1, end)
      .map((l) => l.match(/\[\[([^\]]+)\]\]/)?.[1]?.trim())
      .filter((x): x is string => !!x),
  );
  const toAdd = stems.filter((s) => !existing.has(s)).map((s) => `- [[${s}]]`);
  if (toAdd.length === 0) return content;

  let insertAt = headIdx + 1;
  for (let i = headIdx + 1; i < end; i++) {
    if (lines[i].trim().startsWith("- ")) insertAt = i + 1;
  }
  return [...lines.slice(0, insertAt), ...toAdd, ...lines.slice(insertAt)].join("\n");
}

export function ensureResource(
  content: string,
  sourceStem: string,
): { content: string; injected: boolean } {
  if (parseResourceFromFm(content).length > 0) return { content, injected: false };
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, injected: false };
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return { content, injected: false }; }
  const body = content.slice(fmMatch[0].length);
  parsed.resource = [sourceStem];
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, injected: true };
}

export function ensureType(content: string, type: string): string {
  if (hasFrontmatterField(content, "type")) return content;
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }
  const body = content.slice(fmMatch[0].length);
  const ordered = { type, ...parsed };
  return `---\n${yamlStringify(ordered)}---\n${body}`;
}

export function ensureDescription(content: string, annotation: string): string {
  // description IS the overview — the full annotation kept verbatim (one line), NOT truncated.
  const desc = annotation.replace(/\s+/g, " ").trim();
  if (!desc || hasFrontmatterField(content, "description")) return content;
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }
  const body = content.slice(fmMatch[0].length);
  parsed.description = desc;
  // lineWidth: 0 — disable yaml's default 80-col folding; description must stay one line (verbatim).
  return `---\n${yamlStringify(parsed, { lineWidth: 0 })}---\n${body}`;
}

export function hasFrontmatterField(content: string, field: string): boolean {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return false;
  return new RegExp(`^${field}:`, "m").test(fmMatch[1]);
}
