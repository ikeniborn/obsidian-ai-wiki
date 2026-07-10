import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  buildPidToRelpath,
  rewriteWikilinks,
  normalizeExportTags,
  deriveTitle,
} from "./okf-export-utils";

/** A source wiki page: bundle-relative path + raw markdown content. */
export interface OkfPage {
  relpath: string;
  content: string;
}

/** The fully-serialized OKF bundle: files to write + non-fatal warnings. */
export interface OkfBundle {
  files: Array<{ relpath: string; content: string }>;
  warnings: string[];
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
const RESERVED = new Set(["index.md", "log.md"]);

/**
 * Serializes wiki pages into an OKF-conformant bundle in memory (no IO):
 *  - guarantees `type` (default `concept`), derives `title` (H1/slug), keeps the
 *    stored `description` or backfills it from `indexDescriptions`;
 *  - normalizes `tags` to kebab-case; `resource` stays a plain stem list (untouched);
 *  - rewrites body Obsidian wikilinks (incl. the `## Related` section) to markdown
 *    links, recording dead links in `warnings`;
 *  - generates the reserved `index.md` (progressive-disclosure nav) and `log.md`,
 *    warning on any real page colliding with those reserved slugs.
 */
export function buildOkfBundle(
  pages: OkfPage[],
  indexDescriptions: Map<string, string>,
  log: string,
): OkfBundle {
  const warnings: string[] = [];
  const pidToRel = buildPidToRelpath(pages.map((p) => p.relpath));
  const files: Array<{ relpath: string; content: string }> = [];

  for (const page of pages) {
    if (RESERVED.has(page.relpath)) {
      warnings.push(
        `source page '${page.relpath}' collides with the reserved OKF '${page.relpath}' — overwritten`,
      );
    }
    const slug = page.relpath.split("/").pop()!.replace(/\.md$/, "");
    const fmMatch = FM_RE.exec(page.content);
    const body = fmMatch ? page.content.slice(fmMatch[0].length) : page.content;

    let fm: Record<string, unknown> = {};
    if (fmMatch) {
      try {
        fm = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
      } catch {
        fm = {};
      }
    }

    if (!("type" in fm)) fm.type = "concept";
    if (!("title" in fm)) fm.title = deriveTitle(page.content, slug);
    if (!("description" in fm)) {
      const desc = indexDescriptions.get(slug);
      if (desc) fm.description = desc;
    }
    if (Array.isArray(fm.tags)) {
      fm.tags = normalizeExportTags(fm.tags.filter((t): t is string => typeof t === "string"));
    }

    const { body: rewritten, dead } = rewriteWikilinks(body, pidToRel);
    for (const stem of dead) warnings.push(`${page.relpath}: dead link [[${stem}]] → plain text`);

    files.push({ relpath: page.relpath, content: `---\n${yamlStringify(fm)}---\n${rewritten}` });
  }

  files.push({ relpath: "index.md", content: buildIndex(pages, indexDescriptions) });
  files.push({ relpath: "log.md", content: `# Log\n\n${log}` });
  return { files, warnings };
}

/** Progressive-disclosure nav: one bullet per page with its description. */
function buildIndex(pages: OkfPage[], descriptions: Map<string, string>): string {
  const lines = ["# Index", ""];
  for (const page of pages) {
    const slug = page.relpath.split("/").pop()!.replace(/\.md$/, "");
    const desc = descriptions.get(slug) ?? "";
    lines.push(`- [${slug}](${page.relpath})${desc ? " — " + desc : ""}`);
  }
  return lines.join("\n") + "\n";
}
