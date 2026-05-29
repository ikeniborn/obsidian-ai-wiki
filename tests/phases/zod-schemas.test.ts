import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DomainEntrySchema, EntityTypesDeltaSchema, SeedsSchema,
  WikiPageSchema, WikiPagesOutputSchema, LintOutputSchema, FormatOutputSchema,
  EntitiesOutputSchema,
} from "../../src/phases/zod-schemas";

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../fixtures/structured", name), "utf8"));

describe("DomainEntrySchema", () => {
  it("parses valid", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-valid.json"));
    expect(r.success).toBe(true);
  });
  it("fails when id missing", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-missing-id.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path.join(".") === "id")).toBe(true);
  });
  it("fails when entity_types not array", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-wrong-type.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path.join(".") === "entity_types")).toBe(true);
  });
  it("fails when wiki_folder is empty string", () => {
    const r = DomainEntrySchema.safeParse({ ...fx("domain-entry-valid.json"), wiki_folder: "" });
    expect(r.success).toBe(false);
  });
});

describe("EntityTypesDeltaSchema", () => {
  it("parses valid", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-valid.json"));
    expect(r.success).toBe(true);
  });
  it("parses empty arrays", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-empty-arrays.json"));
    expect(r.success).toBe(true);
  });
  it("ignores extra fields (forward-compat)", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-extra-fields.json"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).future_field).toBeUndefined();
    }
  });
  it("fails when reasoning missing", () => {
    const r = EntityTypesDeltaSchema.safeParse({ entity_types: [] });
    expect(r.success).toBe(false);
  });
});

describe("SeedsSchema", () => {
  it("parses valid", () => {
    const r = SeedsSchema.safeParse(fx("seeds-valid.json"));
    expect(r.success).toBe(true);
  });
  it("fails when array contains non-string", () => {
    const r = SeedsSchema.safeParse(fx("seeds-non-string-elem.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "seeds")).toBe(true);
  });
  it("parses without optional reasoning", () => {
    const r = SeedsSchema.safeParse({ seeds: ["x"] });
    expect(r.success).toBe(true);
  });
});

describe("WikiPageSchema", () => {
  it("accepts page with all fields", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md", content: "# B", annotation: "desc" });
    expect(result.success).toBe(true);
  });
  it("accepts page without annotation", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md", content: "# B" });
    expect(result.success).toBe(true);
  });
  it("rejects page missing content", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md" });
    expect(result.success).toBe(false);
  });
  it("accepts path-style links in wiki_sources frontmatter field", () => {
    const content = '---\nwiki_sources:\n  - "[[ИЛЬЯ/Здоровье/source.md]]"\nwiki_outgoing_links: []\n---\n# Page\n\nText with [[OtherPage]].';
    const result = WikiPageSchema.safeParse({ path: "!Wiki/d/e/Page.md", content });
    expect(result.success).toBe(true);
  });
  it("rejects path-style wikilinks in body", () => {
    const content = '---\nwiki_sources:\n  - "[[source.md]]"\n---\n# Page\n\nSee [[folder/OtherPage]].';
    const result = WikiPageSchema.safeParse({ path: "!Wiki/d/e/Page.md", content });
    expect(result.success).toBe(false);
  });
  it("rejects alias wikilinks in body", () => {
    const content = "# Page\n\nSee [[OtherPage|alias]].";
    const result = WikiPageSchema.safeParse({ path: "!Wiki/d/e/Page.md", content });
    expect(result.success).toBe(false);
  });
});

describe("WikiPagesOutputSchema", () => {
  it("accepts valid output", () => {
    const result = WikiPagesOutputSchema.safeParse({
      reasoning: "Extracted 2 entities.",
      pages: [{ path: "!Wiki/d/e/A.md", content: "# A" }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts empty pages array", () => {
    const result = WikiPagesOutputSchema.safeParse({ reasoning: "nothing to extract", pages: [] });
    expect(result.success).toBe(true);
  });
  it("rejects missing reasoning", () => {
    const result = WikiPagesOutputSchema.safeParse({ pages: [] });
    expect(result.success).toBe(false);
  });
});

describe("LintOutputSchema", () => {
  it("accepts valid output", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "Found 1 dead link.",
      report: "## Lint Report\n- dead link in A.md",
      fixes: [{ path: "!Wiki/d/e/A.md", content: "# A\nFixed." }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts empty fixes", () => {
    const result = LintOutputSchema.safeParse({ reasoning: "ok", report: "All good.", fixes: [] });
    expect(result.success).toBe(true);
  });
  it("rejects missing report", () => {
    const result = LintOutputSchema.safeParse({ reasoning: "ok", fixes: [] });
    expect(result.success).toBe(false);
  });
});

describe("FormatOutputSchema", () => {
  it("accepts valid output", () => {
    const result = FormatOutputSchema.safeParse({ report: "## Changes\n- added tags", formatted: "---\ntags: []\n---\n# Page" });
    expect(result.success).toBe(true);
  });
  it("rejects missing formatted", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok" });
    expect(result.success).toBe(false);
  });
});

describe("EntitiesOutputSchema", () => {
  // @lat: [[tests#Entity Extraction#Entities schema accepts minimal entity]]
  it("accepts minimal entity", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "Foo" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts entity with type and context_snippet", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "Foo", type: "Concept", context_snippet: "Foo is a concept." }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "" }],
    });
    expect(r.success).toBe(false);
  });

  // @lat: [[tests#Entity Extraction#Entities schema rejects oversize lists]]
  it("rejects entities array longer than 50", () => {
    const entities = Array.from({ length: 51 }, (_, i) => ({ name: `E${i}` }));
    const r = EntitiesOutputSchema.safeParse({ reasoning: "ok", entities });
    expect(r.success).toBe(false);
  });

  it("rejects missing reasoning", () => {
    const r = EntitiesOutputSchema.safeParse({ entities: [{ name: "Foo" }] });
    expect(r.success).toBe(false);
  });
});

describe("WikiPagesOutputSchema — deletes", () => {
  it("accepts optional deletes[]", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "merge",
      pages: [{ path: "!Wiki/d/e/New.md", content: "# New" }],
      deletes: [{ path: "!Wiki/d/e/Old.md" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.deletes).toHaveLength(1);
  });

  it("accepts response without deletes (backward compat)", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "ok",
      pages: [{ path: "!Wiki/d/e/A.md", content: "# A" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.deletes).toBeUndefined();
  });

  it("rejects deletes entry without path", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "merge",
      pages: [],
      deletes: [{}],
    });
    expect(r.success).toBe(false);
  });
});
