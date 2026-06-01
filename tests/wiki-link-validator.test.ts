import { describe, it, expect } from "vitest";
import { validateWikiLinks, fixWikiLinks, checkWikiLinks } from "../src/wiki-link-validator";

const page = (content: string) => new Map([["Wiki/domain/entity/Page.md", content]]);

describe("validateWikiLinks", () => {
  it("detects alias violation", () => {
    const v = validateWikiLinks(page("See [[Page|alias text]] here."));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("alias");
    expect(v[0].detail).toBe("[[Page|alias text]]");
  });

  it("detects path violation", () => {
    const v = validateWikiLinks(page("See [[folder/page]] here."));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("path");
    expect(v[0].detail).toBe("[[folder/page]]");
  });

  it("detects inline-json frontmatter", () => {
    const content = `---\nwiki_outgoing_links: ["[[A]]"]\n---\n\nBody with [[A]].`;
    const v = validateWikiLinks(page(content));
    expect(v.some((x) => x.kind === "inline-json")).toBe(true);
  });

  it("detects outgoing-desync", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[B]]"\n---\n\nBody with [[A]].`;
    const v = validateWikiLinks(page(content));
    expect(v.some((x) => x.kind === "outgoing-desync")).toBe(true);
  });

  it("dead link is NOT a violation", () => {
    const v = validateWikiLinks(page("See [[NonExistent]]."));
    expect(v).toHaveLength(0);
  });

  it("clean page has no violations", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody with [[A]].`;
    expect(validateWikiLinks(page(content))).toHaveLength(0);
  });
});

describe("fixWikiLinks", () => {
  it("strips alias", () => {
    const result = fixWikiLinks(page("See [[Page|alias]] here."), 3);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[Page]] here.");
    expect(result.warnings).toHaveLength(0);
  });

  it("strips path", () => {
    const result = fixWikiLinks(page("See [[folder/page]] here."), 3);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[page]] here.");
  });

  it("normalizes inline-json frontmatter to block list", () => {
    const content = `---\nwiki_outgoing_links: ["[[A]]", "[[B]]"]\n---\n\nBody [[A]] [[B]].`;
    const result = fixWikiLinks(page(content), 3);
    const fixed = result.fixed.get("Wiki/domain/entity/Page.md")!;
    expect(fixed).toContain("wiki_outgoing_links:");
    expect(fixed).toContain('  - "[[A]]"');
    expect(fixed).toContain('  - "[[B]]"');
    expect(fixed).not.toContain('["[[A]]"');
  });

  it("syncs wiki_outgoing_links from body", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[Old]]"\n---\n\nBody [[New]].`;
    const result = fixWikiLinks(page(content), 3);
    const fixed = result.fixed.get("Wiki/domain/entity/Page.md")!;
    expect(fixed).toContain('  - "[[New]]"');
    expect(fixed).not.toContain("[[Old]]");
  });

  it("is idempotent", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody [[A]].`;
    const r1 = fixWikiLinks(page(content), 3);
    const fixed1 = r1.fixed.get("Wiki/domain/entity/Page.md")!;
    const r2 = fixWikiLinks(new Map([["Wiki/domain/entity/Page.md", fixed1]]), 3);
    expect(r2.fixed.get("Wiki/domain/entity/Page.md")).toBe(fixed1);
  });

  it("preserves dead links (warns, does not remove)", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[Dead]]"\n---\n\nBody [[Dead]].`;
    const stems = new Set(["RealPage"]);
    const result = fixWikiLinks(page(content), 3, stems);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toContain("[[Dead]]");
    expect(result.warnings.some((w) => w.includes("Dead"))).toBe(true);
  });

  it("does not corrupt empty wiki_outgoing_links on repeated passes", () => {
    // page body has no links → FM should stabilize at wiki_outgoing_links: []
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody with no links.`;
    const r1 = fixWikiLinks(page(content), 3);
    const fixed1 = r1.fixed.get("Wiki/domain/entity/Page.md")!;
    const r2 = fixWikiLinks(new Map([["Wiki/domain/entity/Page.md", fixed1]]), 3);
    const fixed2 = r2.fixed.get("Wiki/domain/entity/Page.md")!;
    expect(fixed2).toBe(fixed1); // idempotent
    expect(fixed1).not.toContain("[] []"); // not corrupted
    expect(fixed1).toContain("wiki_outgoing_links: []");
  });

  it("maxPasses=0 returns unchanged pages + violations as warnings", () => {
    const result = fixWikiLinks(page("See [[Page|alias]]."), 0);
    expect(result.fixed.get("Wiki/domain/entity/Page.md")).toBe("See [[Page|alias]].");
    expect(result.warnings.some((w) => w.includes("alias"))).toBe(true);
  });
});

describe("Bug A: extractFmLinks must not read wiki_sources list items", () => {
  it("wiki_sources entries do not trigger outgoing-desync", () => {
    // wiki_sources: [[Фибоначчи]] should NOT be counted as an outgoing link
    const content = [
      "---",
      'wiki_sources:',
      '  - "[[Фибоначчи]]"',
      "wiki_outgoing_links:",
      '  - "[[wiki_fin_page]]"',
      "---",
      "",
      "Body [[wiki_fin_page]].",
    ].join("\n");
    const v = validateWikiLinks(page(content));
    expect(v.filter((x) => x.kind === "outgoing-desync")).toHaveLength(0);
  });

  it("fixWikiLinks produces no warnings when wiki_sources has links but outgoing is synced", () => {
    const content = [
      "---",
      'wiki_sources:',
      '  - "[[Фибоначчи]]"',
      "wiki_outgoing_links:",
      '  - "[[wiki_fin_page]]"',
      "---",
      "",
      "Body [[wiki_fin_page]].",
    ].join("\n");
    const result = fixWikiLinks(page(content), 3);
    expect(result.warnings.filter((w) => w.includes("outgoing-desync"))).toHaveLength(0);
  });
});

describe("Bug B: wiki_outgoing_links: [] must not trigger inline-json violation", () => {
  it("empty inline form [] is not flagged as inline-json", () => {
    const content = "---\nwiki_outgoing_links: []\n---\n\nBody with no links.";
    const v = validateWikiLinks(page(content));
    expect(v.filter((x) => x.kind === "inline-json")).toHaveLength(0);
  });

  it("fixWikiLinks produces no warnings for page with no body links and [] in fm", () => {
    const content = "---\nwiki_outgoing_links: []\n---\n\nBody with no links.";
    const result = fixWikiLinks(page(content), 3);
    expect(result.warnings.filter((w) => w.includes("inline-json"))).toHaveLength(0);
  });
});

describe("Bug C: fixWikiLinks must not produce duplicate wiki_outgoing_links entries", () => {
  it("body with repeated link produces single fm entry", () => {
    const content = [
      "---",
      "wiki_outgoing_links:",
      '  - "[[Old]]"',
      "---",
      "",
      "First mention [[Target]]. Second mention [[Target]].",
    ].join("\n");
    const result = fixWikiLinks(page(content), 3);
    const fixed = result.fixed.get("Wiki/domain/entity/Page.md")!;
    const matches = [...fixed.matchAll(/- "\[\[Target\]\]"/g)];
    expect(matches).toHaveLength(1);
  });
});

describe("checkWikiLinks", () => {
  it("returns empty string for clean pages", () => {
    const content = `---\nwiki_outgoing_links:\n  - "[[A]]"\n---\n\nBody [[A]].`;
    expect(checkWikiLinks(page(content))).toBe("");
  });

  it("returns formatted violation lines", () => {
    const result = checkWikiLinks(page("See [[Page|alias]]."));
    expect(result).toMatch(/Wiki\/domain\/entity\/Page\.md.*alias/);
  });
});
