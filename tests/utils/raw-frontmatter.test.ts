import { describe, it, expect } from "vitest";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, hasFrontmatterField } from "../../src/utils/raw-frontmatter";
import { validateAndRepairSourceFrontmatter } from "../../src/utils/raw-frontmatter";

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

describe("validateAndRepairFrontmatter — core behaviors", () => {
  // @lat: [[tests#Frontmatter Validation#No-frontmatter passthrough]]
  it("returns content unchanged when no frontmatter present", () => {
    const content = "# Just body\n\nNo frontmatter.";
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings).toEqual([]);
  });

  // @lat: [[tests#Frontmatter Validation#Valid frontmatter passthrough]]
  it("returns content unchanged when frontmatter is valid", () => {
    const content = `---
tags:
  - crypto/defi
wiki_added: 2026-05-01
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_defi_overview]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings).toEqual([]);
  });

  // @lat: [[tests#Frontmatter Validation#Duplicate key merge]]
  it("merges duplicate list key and emits warning", () => {
    const content = `---
tags:
  - crypto
wiki_articles:
wiki_added: 2026-05-21
wiki_updated: 2026-06-01
wiki_articles:
  - "[[wiki_fin]]"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
    expect(warnings.some((w) => w.includes('Duplicate key "wiki_articles"'))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Unparseable YAML guard]]
  it("returns original content and warns on unparseable YAML", () => {
    const content = `---
key: [unclosed bracket
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toBe(content);
    expect(warnings.some((w) => w.includes("Unparseable YAML"))).toBe(true);
  });
});

describe("validateAndRepairSourceFrontmatter", () => {
  // @lat: [[tests#Frontmatter Validation#Source invalid date removal]]
  it("removes wiki_added with invalid date", () => {
    const content = `---
wiki_added: not-a-date
wiki_updated: 2026-06-01
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).not.toContain("wiki_added:");
    expect(warnings.some((w) => w.includes("wiki_added") && w.includes("invalid date"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source invalid wikilink removal]]
  it("removes wiki_articles entry that is not a wikilink", () => {
    const content = `---
wiki_articles:
  - "[[wiki_valid]]"
  - "not-a-wikilink"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("not-a-wikilink");
    expect(warnings.some((w) => w.includes("wiki_articles") && w.includes("not-a-wikilink"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source invalid tag removal]]
  it("removes tag with uppercase letters", () => {
    const content = `---
tags:
  - crypto/defi
  - BadTag
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("crypto/defi");
    expect(out).not.toContain("BadTag");
    expect(warnings.some((w) => w.includes("tags") && w.includes("BadTag"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source scalar aliases wrap]]
  it("wraps scalar aliases in a list", () => {
    const content = `---
aliases: BTC
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("aliases:\n  - BTC");
    expect(warnings.some((w) => w.includes("aliases"))).toBe(true);
  });

  // @lat: [[tests#Frontmatter Validation#Source invalid URL removal]]
  it("removes external_links entry without http(s):// prefix", () => {
    const content = `---
external_links:
  - "https://example.com"
  - "ftp://bad.com"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("https://example.com");
    expect(out).not.toContain("ftp://bad.com");
  });

  // @lat: [[tests#Frontmatter Validation#Source related invalid entry removal]]
  it("removes related entry that is not a wikilink", () => {
    const content = `---
related:
  - "[[wiki_valid]]"
  - "plain-text"
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("[[wiki_valid]]");
    expect(out).not.toContain("plain-text");
  });

  // @lat: [[tests#Frontmatter Validation#Source body preservation]]
  it("does not modify body content", () => {
    const content = `---
wiki_added: bad
---
# Body with wiki_added: mention`;
    const { content: out } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("# Body with wiki_added: mention");
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
