import { describe, it, expect } from "vitest";
import { parseWikiSources } from "../../src/utils/vault-walk";

describe("parseWikiSources", () => {
  it("extracts raw paths from wiki_sources list", () => {
    const content = `---
wiki_sources:
  - Notes/AI/doc1.md
  - Notes/Research/paper.md
---
body`;
    expect(parseWikiSources(content)).toEqual([
      "Notes/AI/doc1.md",
      "Notes/Research/paper.md",
    ]);
  });

  it("returns empty array when wiki_sources absent", () => {
    const content = `---
title: test
---
body`;
    expect(parseWikiSources(content)).toEqual([]);
  });

  it("returns empty array when no frontmatter", () => {
    expect(parseWikiSources("just body text")).toEqual([]);
  });

  it("trims whitespace from each path", () => {
    const content = `---
wiki_sources:
  -  Notes/AI/doc1.md
---
`;
    expect(parseWikiSources(content)).toEqual(["Notes/AI/doc1.md"]);
  });
});
