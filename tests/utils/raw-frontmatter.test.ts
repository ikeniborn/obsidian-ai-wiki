import { describe, it, expect } from "vitest";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, hasFrontmatterField } from "../../src/utils/raw-frontmatter";

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

describe("parseWikiSourcesFromFm", () => {
  it("returns empty array when no wiki_sources field", () => {
    expect(parseWikiSourcesFromFm("---\ntitle: X\n---\n")).toEqual([]);
  });

  it("extracts wikilinks from wiki_sources block", () => {
    const content =
      '---\nwiki_sources:\n  - "[[Sources/raw.md]]"\n  - "[[Sources/other.md]]"\n---\n';
    expect(parseWikiSourcesFromFm(content)).toEqual([
      "[[Sources/raw.md]]",
      "[[Sources/other.md]]",
    ]);
  });
});

describe("hasFrontmatterField", () => {
  it("returns false when file has no frontmatter", () => {
    expect(hasFrontmatterField("# Content\n\nBody.", "wiki_added")).toBe(false);
  });

  it("returns false when field absent from frontmatter", () => {
    expect(hasFrontmatterField("---\ntitle: X\n---\n# Content", "wiki_added")).toBe(false);
  });

  it("returns true when field present in frontmatter", () => {
    expect(hasFrontmatterField("---\nwiki_added: 2026-01-01\n---\n# Content", "wiki_added")).toBe(true);
  });

  it("returns false when field name appears only in body, not frontmatter", () => {
    const content = "---\ntitle: X\n---\n# Content\n\nSome text with wiki_added: mention in body.";
    expect(hasFrontmatterField(content, "wiki_added")).toBe(false);
  });

  it("returns true for wiki_updated when present", () => {
    expect(hasFrontmatterField("---\nwiki_updated: 2026-05-12\n---\n", "wiki_updated")).toBe(true);
  });
});

describe("upsertRawFrontmatter — duplicate wiki_articles bug", () => {
  it("produces exactly one wiki_articles when source already had two occurrences", () => {
    const input = `---
tags:
  - crypto
wiki_articles:
wiki_added: 2026-05-21
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_fin]]"
---
body`;
    const result = upsertRawFrontmatter(input, {
      wiki_updated: "2026-06-01",
      wiki_articles: ["[[wiki_fin]]"],
    });
    expect(result.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
  });
});
