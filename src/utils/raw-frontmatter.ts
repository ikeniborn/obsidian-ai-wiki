import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIKILINK_RE = /^\[\[.+\]\]$/;
const URL_RE = /^https?:\/\//;
const TAG_RE = /^[a-z][a-z0-9]*(?:[/_][a-z0-9]+)*$/;

export type FieldRule =
  | { field: string; kind: "list-wikilinks" }
  | { field: string; kind: "list-urls" }
  | { field: string; kind: "list-tags" }
  | { field: string; kind: "date-scalar" }
  | { field: string; kind: "aliases" }
  | { field: string; kind: "warn-enum"; values: readonly string[] };

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
      case "list-urls":
      case "list-tags": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          break;
        }
        const predicate =
          rule.kind === "list-wikilinks"
            ? (v: string) => WIKILINK_RE.test(v)
            : rule.kind === "list-urls"
              ? (v: string) => URL_RE.test(v)
              : (v: string) => TAG_RE.test(v);
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !predicate(v)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        parsed[rule.field] = filtered;
        break;
      }
      case "date-scalar": {
        if (typeof val !== "string" || !DATE_RE.test(val)) {
          warnings.push(`${rule.field}: invalid date "${val}" — removed`);
          delete parsed[rule.field];
        }
        break;
      }
      case "aliases": {
        if (typeof val === "string") {
          warnings.push(`aliases: scalar "${val}" wrapped in list`);
          parsed[rule.field] = [val];
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
    }
  }

  // Re-serialize via yaml.stringify and reconstruct full file
  if (warnings.length === 0) return { content, warnings };
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, warnings };
}

const SOURCE_RULES: FieldRule[] = [
  { field: "wiki_articles", kind: "list-wikilinks" },
  { field: "wiki_added", kind: "date-scalar" },
  { field: "wiki_updated", kind: "date-scalar" },
  { field: "tags", kind: "list-tags" },
  { field: "aliases", kind: "aliases" },
  { field: "created", kind: "date-scalar" },
  { field: "updated", kind: "date-scalar" },
  { field: "external_links", kind: "list-urls" },
  { field: "related", kind: "list-wikilinks" },
];

export function validateAndRepairSourceFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  return validateAndRepairFrontmatter(content, SOURCE_RULES);
}

function removeWikiFields(yaml: string): string {
  yaml = yaml.replace(/^wiki_added:[^\n]*\n?/gm, "");
  yaml = yaml.replace(/^wiki_updated:[^\n]*\n?/gm, "");
  yaml = yaml.replace(/^wiki_articles:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*/gm, "");
  return yaml;
}

function buildWikiFields(fields: {
  wiki_added?: string;
  wiki_updated: string;
  wiki_articles: string[];
}): string {
  const lines: string[] = [];
  if (fields.wiki_added !== undefined) {
    lines.push(`wiki_added: ${fields.wiki_added}`);
  }
  lines.push(`wiki_updated: ${fields.wiki_updated}`);
  if (fields.wiki_articles.length > 0) {
    lines.push("wiki_articles:");
    for (const a of fields.wiki_articles) {
      lines.push(`  - "${a}"`);
    }
  }
  return lines.join("\n");
}

export function upsertRawFrontmatter(
  content: string,
  fields: {
    wiki_added?: string;
    wiki_updated: string;
    wiki_articles: string[];
  },
): string {
  const newFields = buildWikiFields(fields);
  const match = FM_RE.exec(content);

  if (match) {
    let yaml = match[1];
    let preservedWikiAdded: string | undefined;
    if (fields.wiki_added === undefined) {
      const addedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(yaml);
      if (addedMatch) preservedWikiAdded = addedMatch[1].trim();
    }
    const cleaned = removeWikiFields(yaml).trimEnd();
    let finalFields = newFields;
    if (preservedWikiAdded !== undefined) {
      finalFields = `wiki_added: ${preservedWikiAdded}\n${newFields}`;
    }
    const newYaml = cleaned ? `${cleaned}\n${finalFields}` : finalFields;
    const rest = content.slice(match[0].length);
    return `---\n${newYaml}\n---\n${rest}`;
  }

  return `---\n${newFields}\n---\n${content}`;
}

export function parseWikiArticlesFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  const match = /wiki_articles:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}

export function parseWikiSourcesFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  const match = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}

export function hasFrontmatterField(content: string, field: string): boolean {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return false;
  return new RegExp(`^${field}:`, "m").test(fmMatch[1]);
}
