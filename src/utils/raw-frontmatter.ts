const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function removeWikiFields(yaml: string): string {
  yaml = yaml.replace(/^wiki_added:[^\n]*\n?/gm, "");
  yaml = yaml.replace(/^wiki_updated:[^\n]*\n?/gm, "");
  let prev: string;
  do {
    prev = yaml;
    yaml = yaml.replace(/^wiki_articles:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*/m, "");
  } while (yaml !== prev);
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
