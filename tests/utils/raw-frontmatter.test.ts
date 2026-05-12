import { describe, it, expect } from "vitest";
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "../../src/utils/raw-frontmatter";

const TODAY = "2026-05-12";
const ARTICLES = ['[[!Wiki/work/Entity.md]]'];

describe("upsertRawFrontmatter", () => {
  it("prepends frontmatter when file has none", () => {
    const result = upsertRawFrontmatter("# Hello\n\nContent.", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("wiki_added: 2026-05-12");
    expect(result).toContain("wiki_updated: 2026-05-12");
    expect(result).toContain('wiki_articles:\n  - "[[!Wiki/work/Entity.md]]"');
    expect(result).toContain("# Hello\n\nContent.");
  });

  it("appends wiki fields to existing frontmatter without wiki fields", () => {
    const input = "---\ntitle: My Doc\n---\n# Content";
    const result = upsertRawFrontmatter(input, {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toContain("title: My Doc");
    expect(result).toContain("wiki_added: 2026-05-12");
    expect(result).toContain("# Content");
  });

  it("replaces existing wiki_articles with new list", () => {
    const input =
      '---\nwiki_articles:\n  - "[[!Wiki/work/Old.md]]"\n---\n# Content';
    const result = upsertRawFrontmatter(input, {
      wiki_updated: TODAY,
      wiki_articles: ["[[!Wiki/work/Old.md]]", "[[!Wiki/work/New.md]]"],
    });
    expect(result).toContain('- "[[!Wiki/work/Old.md]]"');
    expect(result).toContain('- "[[!Wiki/work/New.md]]"');
    // Exactly one occurrence of Old.md
    expect(result.split("Old.md").length - 1).toBe(1);
  });

  it("preserves existing wiki_added when fields.wiki_added is undefined", () => {
    const input =
      '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[!Wiki/work/A.md]]"\n---\n# Content';
    const result = upsertRawFrontmatter(input, {
      wiki_added: undefined,
      wiki_updated: TODAY,
      wiki_articles: ["[[!Wiki/work/A.md]]"],
    });
    expect(result).toContain("wiki_added: 2026-01-01");
    expect(result).not.toContain("wiki_added: 2026-05-12");
  });

  it("writes wiki_added when provided and absent from existing FM", () => {
    const input = "---\ntitle: X\n---\n";
    const result = upsertRawFrontmatter(input, {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toContain("wiki_added: 2026-05-12");
  });

  it("handles empty file", () => {
    const result = upsertRawFrontmatter("", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: ARTICLES,
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("wiki_added: 2026-05-12");
  });

  it("omits wiki_articles key when list is empty", () => {
    const result = upsertRawFrontmatter("# Content", {
      wiki_added: TODAY,
      wiki_updated: TODAY,
      wiki_articles: [],
    });
    expect(result).not.toContain("wiki_articles:");
  });
});

describe("parseWikiArticlesFromFm", () => {
  it("returns empty array when no wiki_articles field", () => {
    expect(parseWikiArticlesFromFm("---\ntitle: X\n---\n")).toEqual([]);
  });

  it("extracts wikilinks from wiki_articles block", () => {
    const content =
      '---\nwiki_articles:\n  - "[[!Wiki/work/A.md]]"\n  - "[[!Wiki/work/B.md]]"\n---\n';
    expect(parseWikiArticlesFromFm(content)).toEqual([
      "[[!Wiki/work/A.md]]",
      "[[!Wiki/work/B.md]]",
    ]);
  });
});
