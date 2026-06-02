import { describe, it, expect } from "vitest";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm, hasFrontmatterField, filterStaleWikiLinks } from "../../src/utils/raw-frontmatter";
import { validateAndRepairSourceFrontmatter, validateAndRepairWikiPageFrontmatter } from "../../src/utils/raw-frontmatter";

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

  it("preserves tags with hyphens in segments", () => {
    const content = `---
tags:
  - finance/technical-analysis
  - trading/imbalance-zones
---
body`;
    const { content: out, warnings } = validateAndRepairSourceFrontmatter(content);
    expect(out).toContain("finance/technical-analysis");
    expect(out).toContain("trading/imbalance-zones");
    expect(warnings).toEqual([]);
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
    expect(warnings.some((w) => w.includes("external_links") && w.includes("ftp://bad.com"))).toBe(true);
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
    expect(warnings.some((w) => w.includes("related") && w.includes("plain-text"))).toBe(true);
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

describe("validateAndRepairWikiPageFrontmatter", () => {
  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki sources invalid entry removal]]
  it("removes wiki_sources entry that is not a wikilink", () => {
    const content = `---
wiki_sources:
  - "[[valid_source]]"
  - "plain/path.md"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[valid_source]]");
    expect(out).not.toContain("plain/path.md");
    expect(warnings.some((w) => w.includes("wiki_sources"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki updated invalid date removal]]
  it("removes wiki_updated with invalid date", () => {
    const content = `---
wiki_updated: 01-06-2026
wiki_status: stub
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).not.toContain("wiki_updated:");
    expect(warnings.some((w) => w.includes("wiki_updated") && w.includes("invalid date"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki status invalid value warning]]
  it("emits warning for invalid wiki_status but does not remove field", () => {
    const content = `---
wiki_status: draft
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("wiki_status: draft");
    expect(warnings.some((w) => w.includes("wiki_status") && w.includes("draft"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki tags invalid entry removal]]
  it("removes tag with spaces", () => {
    const content = `---
tags:
  - valid/tag
  - "invalid tag"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("valid/tag");
    expect(out).not.toContain("invalid tag");
    expect(warnings.some((w) => w.includes("tags") && w.includes("invalid tag"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links invalid entry removal]]
  it("removes wiki_outgoing_links entry that is not a wikilink", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_valid]]"
  - "bare-string"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_valid]]");
    expect(out).not.toContain("bare-string");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links") && w.includes("bare-string"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki external links invalid entry removal]]
  it("removes wiki_external_links entry without https:// prefix", () => {
    const content = `---
wiki_external_links:
  - "https://good.com"
  - "not-a-url"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("https://good.com");
    expect(out).not.toContain("not-a-url");
    expect(warnings.some((w) => w.includes("wiki_external_links") && w.includes("not-a-url"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki scalar aliases wrap]]
  it("wraps scalar aliases in a list", () => {
    const content = `---
aliases: Ethereum
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("aliases:\n  - Ethereum");
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links non-wiki stem removed]]
  it("removes non-wiki stem from wiki_outgoing_links", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_entity]]"
  - "[[my_note]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_entity]]");
    expect(out).not.toContain("[[my_note]]");
    expect(warnings.some((w) => w.includes("wiki_outgoing_links") && w.includes("non-wiki stem"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki sources wiki stem removed]]
  it("removes wiki stem from wiki_sources", () => {
    const content = `---
wiki_sources:
  - "[[my_source]]"
  - "[[wiki_work_foo]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[my_source]]");
    expect(out).not.toContain("[[wiki_work_foo]]");
    expect(warnings.some((w) => w.includes("wiki_sources") && w.includes("wiki stem"))).toBe(true);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links valid wiki stem kept]]
  it("keeps valid wiki stem in wiki_outgoing_links", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_bar]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_bar]]");
    expect(warnings.filter((w) => w.includes("wiki_outgoing_links"))).toHaveLength(0);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki sources valid source stem kept]]
  it("keeps valid source stem in wiki_sources", () => {
    const content = `---
wiki_sources:
  - "[[my_document]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[my_document]]");
    expect(warnings.filter((w) => w.includes("wiki_sources"))).toHaveLength(0);
  });

  // @lat: [[tests#Wiki Page Frontmatter Validation#Wiki outgoing links mixed list partial removal]]
  it("removes only invalid entries from mixed wiki_outgoing_links list", () => {
    const content = `---
wiki_outgoing_links:
  - "[[wiki_work_good]]"
  - "[[not_a_wiki]]"
---
body`;
    const { content: out, warnings } = validateAndRepairWikiPageFrontmatter(content);
    expect(out).toContain("[[wiki_work_good]]");
    expect(out).not.toContain("[[not_a_wiki]]");
    expect(warnings).toHaveLength(1);
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

  // @lat: [[tests#Frontmatter Validation#upsertRawFrontmatter — no duplicate on yaml.stringify indent]]
  it("no duplicate wiki_articles when list items have no leading indent (yaml.stringify style)", () => {
    // yaml.stringify can produce items without leading spaces: "wiki_articles:\n- item"
    // The old regex [ \t]+- fails to match and leaves the original key intact → duplicate
    const input = `---\ntags:\n  - crypto\nwiki_articles:\n- "[[wiki_fin]]"\nwiki_updated: 2026-06-01\n---\nbody`;
    const result = upsertRawFrontmatter(input, {
      wiki_updated: "2026-06-02",
      wiki_articles: ["[[wiki_new]]"],
    });
    expect(result.match(/^wiki_articles:/gm)?.length ?? 0).toBe(1);
    expect(result).toContain("[[wiki_new]]");
    expect(result).not.toContain("[[wiki_fin]]");
  });
});

describe("filterStaleWikiLinks", () => {
  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — no frontmatter passthrough]]
  it("returns content unchanged with empty warnings when no frontmatter", () => {
    const content = "# Just a body\n\nNo frontmatter here.";
    const result = filterStaleWikiLinks(content, new Set(["Foo"]), ["wiki_articles"]);
    expect(result.content).toBe(content);
    expect(result.warnings).toEqual([]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — live wiki_articles kept]]
  it("keeps live wikilinks present in existingStems", () => {
    const content = '---\nwiki_articles:\n  - "[[Bar]]"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(["Bar"]), ["wiki_articles"]);
    expect(result.content).toBe(content);
    expect(result.warnings).toEqual([]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — stale wiki_articles removed]]
  it("removes stale wikilinks absent from existingStems and emits warnings", () => {
    const content = '---\nwiki_articles:\n  - "[[Foo]]"\n  - "[[Bar]]"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(["Bar"]), ["wiki_articles"]);
    expect(result.content).not.toContain("[[Foo]]");
    expect(result.content).toContain("[[Bar]]");
    expect(result.warnings).toEqual(["wiki_articles: stale link [[Foo]] — removed"]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — related stale removed]]
  it("removes stale links from the related field", () => {
    const content = '---\nrelated:\n  - "[[Gone]]"\n  - "[[Alive]]"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(["Alive"]), ["related"]);
    expect(result.content).not.toContain("[[Gone]]");
    expect(result.content).toContain("[[Alive]]");
    expect(result.warnings).toEqual(["related: stale link [[Gone]] — removed"]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — wiki_outgoing_links stale removed]]
  it("removes stale links from wiki_outgoing_links", () => {
    const content = '---\nwiki_outgoing_links:\n  - "[[Dead]]"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(), ["wiki_outgoing_links"]);
    expect(result.content).not.toContain("[[Dead]]");
    expect(result.warnings).toEqual(["wiki_outgoing_links: stale link [[Dead]] — removed"]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — non-wikilink entries untouched]]
  it("does not remove entries that are not valid wikilinks", () => {
    const content = '---\nwiki_articles:\n  - "plain-text"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(), ["wiki_articles"]);
    expect(result.content).toContain("plain-text");
    expect(result.warnings).toEqual([]);
  });

  // @lat: [[lat.md/tests#Tests#Frontmatter Validation#filterStaleWikiLinks — empty existingStems removes all]]
  it("removes all valid wikilink entries when existingStems is empty", () => {
    const content = '---\nwiki_articles:\n  - "[[A]]"\n  - "[[B]]"\n---\n# Body';
    const result = filterStaleWikiLinks(content, new Set(), ["wiki_articles"]);
    expect(result.content).not.toContain("[[A]]");
    expect(result.content).not.toContain("[[B]]");
    expect(result.warnings).toHaveLength(2);
  });
});
