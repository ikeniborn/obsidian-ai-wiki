import { describe, it, expect } from "vitest";
import { splitSections, DEFAULT_CHUNKING } from "../src/page-similarity";
import { buildChunkInputs } from "../src/page-similarity";

const body = (s: string) => s.replace(/^\n/, "");

describe("splitSections", () => {
  it("splits H2 sections and strips frontmatter + H1", () => {
    const md = body(`
---
wiki_status: stub
---
# Title

Lead paragraph.

## Alpha

Alpha body text here.

## Beta

Beta body text here.
`);
    const out = splitSections(md, DEFAULT_CHUNKING);
    const headings = out.map((c) => c.heading);
    expect(headings.some((h) => h.includes("Alpha"))).toBe(true);
    expect(headings.some((h) => h.includes("Beta"))).toBe(true);
    // frontmatter + H1 never appear in any window
    expect(out.every((c) => !c.window.includes("wiki_status"))).toBe(true);
    expect(out.every((c) => !c.window.includes("# Title"))).toBe(true);
  });

  it("folds H3 under its parent H2 (no split on H3)", () => {
    const md = body(`
# T

## Parent

Parent intro.

### Child

Child detail.
`);
    const out = splitSections(md, DEFAULT_CHUNKING);
    expect(out).toHaveLength(1);
    expect(out[0].heading).toContain("Parent");
    expect(out[0].window).toContain("Child detail");
  });

  it("merges a section shorter than minChars into a neighbour", () => {
    const md = body(`
# T

## Big

${"x ".repeat(300)}

## Tiny

short
`);
    const out = splitSections(md, { ...DEFAULT_CHUNKING, minChars: 50, maxChars: 5000 });
    // "Tiny" is < 50 chars and folds into "Big"
    expect(out).toHaveLength(1);
    expect(out[0].window).toContain("short");
  });

  it("windows a long section with overlap", () => {
    const long = "abcdefghij ".repeat(200); // ~2200 chars
    const md = body(`# T\n\n## Long\n\n${long}`);
    const out = splitSections(md, { maxChars: 600, overlapChars: 100, minChars: 50, maxCount: 50 });
    expect(out.length).toBeGreaterThan(1);
    // every window carries the same heading
    expect(out.every((c) => c.heading.includes("Long"))).toBe(true);
    // consecutive windows overlap: end of window i shares a tail with start of window i+1
    const tail = out[0].window.slice(-50);
    expect(out[1].window.includes(tail.trim().slice(0, 20))).toBe(true);
  });

  it("caps at maxCount and makes the fold visible (no silent cap)", () => {
    const sections = Array.from({ length: 8 }, (_, i) => `## S${i}\n\nbody ${i} ${"y ".repeat(150)}`).join("\n\n");
    const md = body(`# T\n\n${sections}`);
    const out = splitSections(md, { maxChars: 5000, overlapChars: 0, minChars: 10, maxCount: 4 });
    expect(out).toHaveLength(4);
    // last window's heading announces how many sections were folded in
    expect(out[3].heading.toLowerCase()).toContain("folded");
  });

  it("returns no sections for an empty body", () => {
    expect(splitSections("", DEFAULT_CHUNKING)).toEqual([]);
    expect(splitSections("---\nx: 1\n---\n# OnlyTitle\n", DEFAULT_CHUNKING)).toEqual([]);
  });

  it("strips the H1 even with a blank line between frontmatter and title", () => {
    const md = "---\nwiki_status: stub\n---\n\n# Title\n\n## Alpha\n\nAlpha body text here.\n";
    const out = splitSections(md, DEFAULT_CHUNKING);
    expect(out.every((c) => !c.window.includes("# Title"))).toBe(true);
    expect(out.some((c) => c.heading.includes("Alpha"))).toBe(true);
  });
});

describe("buildChunkInputs", () => {
  it("summary chunk embed text is the annotation alone", () => {
    const inputs = buildChunkInputs("ANNOT", "", DEFAULT_CHUNKING);
    expect(inputs[0].kind).toBe("summary");
    expect(inputs[0].embedText).toBe("ANNOT");
  });

  it("section chunk prepends annotation + heading + window", () => {
    const md = "# T\n\n## Alpha\n\nAlpha detail body.";
    const inputs = buildChunkInputs("ANNOT", md, DEFAULT_CHUNKING);
    const section = inputs.find((c) => c.kind === "section")!;
    expect(section.embedText.startsWith("ANNOT\n\n")).toBe(true);
    expect(section.embedText).toContain("Alpha");
    expect(section.embedText).toContain("Alpha detail body.");
  });

  it("changing the annotation changes every chunk hash", () => {
    const md = "# T\n\n## Alpha\n\nbody";
    const a = buildChunkInputs("ANNOT-A", md, DEFAULT_CHUNKING).map((c) => c.hash);
    const b = buildChunkInputs("ANNOT-B", md, DEFAULT_CHUNKING).map((c) => c.hash);
    expect(a.every((h, i) => h !== b[i])).toBe(true);
  });
});
